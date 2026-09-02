/**
 * Mem0-inspired Adaptive Memory & Fact Gardening Engine for Apollo.
 * 
 * Features:
 * - Semantic categorization (Smart Home, Preferences, Media Rip, Environment, General)
 * - Contradiction & supersession resolution (e.g. newer specific version facts supersede older conflicting facts)
 * - Deduplication and temporal decay management
 * - Multi-level memory scoping (User profile vs session facts vs system knowledge)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { logAuditEvent } = require('./auditLogger.cjs');

/**
 * Categorizes a fact string into a semantic domain.
 * @param {string} fact 
 * @returns {{ category: string, color: string, badgeBg: string }}
 */
function categorizeFact(fact) {
  if (!fact || typeof fact !== 'string') {
    return { category: 'General', color: '#94a3b8', badgeBg: 'rgba(148, 163, 184, 0.12)' };
  }

  const lower = fact.toLowerCase();

  if (lower.includes('home assistant') || lower.includes('homeassistant') || lower.includes('hass') || lower.includes('light') || lower.includes('lock') || lower.includes('calendar') || lower.includes('climate') || lower.includes('thermostat')) {
    return { category: 'Smart Home', color: '#38bdf8', badgeBg: 'rgba(56, 189, 248, 0.15)' };
  }
  if (lower.includes('autorip') || lower.includes('nvenc') || lower.includes('h.264') || lower.includes('h.265') || lower.includes('movie') || lower.includes('disc') || lower.includes('transcode') || lower.includes('jellyfin')) {
    return { category: 'Media Rip', color: '#a855f7', badgeBg: 'rgba(168, 85, 247, 0.15)' };
  }
  if (lower.includes('windows') || lower.includes('vs code') || lower.includes('python') || lower.includes('docker') || lower.includes('subagents') || lower.includes('desktop') || lower.includes('node') || lower.includes('react')) {
    return { category: 'Environment', color: '#10b981', badgeBg: 'rgba(16, 185, 129, 0.15)' };
  }
  if (lower.includes('prefer') || lower.includes('privacy') || lower.includes('noise') || lower.includes('solution') || lower.includes('engineered') || lower.includes('aesthetic') || lower.includes('concise')) {
    return { category: 'Preferences', color: '#f59e0b', badgeBg: 'rgba(245, 158, 11, 0.15)' };
  }

  return { category: 'General', color: '#94a3b8', badgeBg: 'rgba(148, 163, 184, 0.12)' };
}

/**
 * Computes simple word-level Jaccard similarity between two fact strings.
 * @param {string} a 
 * @param {string} b 
 * @returns {number} 0.0 to 1.0
 */
/** Numeric dotted-version compare. Returns >0 if a is newer than b. */
function compareVersions(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

function computeSemanticOverlap(a, b) {
  if (!a || !b) return 0;
  const setA = new Set(a.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2));
  const setB = new Set(b.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2));

  if (setA.size === 0 || setB.size === 0) return 0;

  let intersection = 0;
  for (const word of setA) {
    if (setB.has(word)) intersection++;
  }

  const union = new Set([...setA, ...setB]).size;
  return union > 0 ? intersection / union : 0;
}

/**
 * Detects whether a new fact supersedes or contradicts an existing fact.
 * @param {string} existingFact 
 * @param {string} newFact 
 * @returns {{ supersedes: boolean, reason?: string }}
 */
function checkFactContradiction(existingFact, newFact) {
  if (!existingFact || !newFact) return { supersedes: false };
  if (existingFact.toLowerCase().trim() === newFact.toLowerCase().trim()) {
    return { supersedes: true, reason: 'Duplicate' };
  }

  const overlap = computeSemanticOverlap(existingFact, newFact);

  // If high subject overlap (>0.6) with differing specific values (e.g. versions, counts)
  if (overlap >= 0.6) {
    // Check version update (e.g. Python 3.10 vs 3.11)
    const versionMatchA = existingFact.match(/(?:v|version\s*|python\s*|node\s*)(\d+(?:\.\d+)*)/i);
    const versionMatchB = newFact.match(/(?:v|version\s*|python\s*|node\s*)(\d+(?:\.\d+)*)/i);
    if (versionMatchA && versionMatchB && versionMatchA[1] !== versionMatchB[1]) {
      // Direction matters. This used to supersede on ANY difference, so an
      // incoming STALE fact ("Python 3.11") overwrote a fresher stored one
      // ("Python 3.12") and archived the correct fact with the reason
      // "Version updated from 3.12 to 3.11" — memory silently regressing,
      // with an audit trail claiming it advanced.
      const cmp = compareVersions(versionMatchB[1], versionMatchA[1]);
      if (cmp <= 0) {
        return { supersedes: false, reason: `Incoming version ${versionMatchB[1]} is not newer than stored ${versionMatchA[1]}` };
      }
      return { supersedes: true, reason: `Version updated from ${versionMatchA[1]} to ${versionMatchB[1]}` };
    }

    // Check entity count / state update
    const countMatchA = existingFact.match(/(\d+)\s*(?:entities|devices|items|directories)/i);
    const countMatchB = newFact.match(/(\d+)\s*(?:entities|devices|items|directories)/i);
    if (countMatchA && countMatchB && countMatchA[1] !== countMatchB[1]) {
      return { supersedes: true, reason: `Count updated from ${countMatchA[1]} to ${countMatchB[1]}` };
    }
  }

  return { supersedes: false };
}

/**
 * Mem0 Fact Gardening & Reconciliation:
 * Reconciles an incoming fact list against existing memory, resolving contradictions,
 * deduplicating (case-insensitively), and tagging domains.
 * @param {Array<string>} existingFacts 
 * @param {Array<string>} incomingFacts 
 * @returns {{ activeFacts: Array<string>, archivedFacts: Array<{ fact: string, reason: string }>, prunedCount: number, changesCount: number }}
 */
function gardenAndReconcileFacts(existingFacts = [], incomingFacts = []) {
  const active = [];
  const seenLower = new Set();
  const archived = [];
  let prunedCount = 0;
  let changesCount = 0;

  // Process all combined candidate facts
  const allCandidates = [...existingFacts, ...incomingFacts];

  for (const raw of allCandidates) {
    const text = typeof raw === 'string' ? raw : (raw?.fact || raw?.text || raw?.content || '');
    const trimmed = text.trim();
    const key = trimmed.toLowerCase();

    if (!trimmed) {
      prunedCount++;
      continue;
    }

    if (seenLower.has(key)) {
      prunedCount++;
      continue;
    }

    // Check for contradiction/supersession with previously kept active facts
    let replacedIdx = -1;
    for (let i = 0; i < active.length; i++) {
      const { supersedes, reason } = checkFactContradiction(active[i], trimmed);
      if (supersedes && reason !== 'Duplicate') {
        archived.push({ fact: active[i], reason });
        replacedIdx = i;
        break;
      }
    }

    if (replacedIdx >= 0) {
      seenLower.delete(active[replacedIdx].toLowerCase());
      active[replacedIdx] = trimmed;
      seenLower.add(key);
      changesCount++;
    } else {
      active.push(trimmed);
      seenLower.add(key);
    }
  }

  return {
    activeFacts: active,
    archivedFacts: archived,
    prunedCount,
    changesCount
  };
}

module.exports = {
  categorizeFact,
  computeSemanticOverlap,
  checkFactContradiction,
  gardenAndReconcileFacts
};
