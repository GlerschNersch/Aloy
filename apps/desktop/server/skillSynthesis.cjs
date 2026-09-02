// Skill synthesis from repeated tool-call sequences — harvested from
// KiroCrew's "mine repeated multi-step patterns into reusable skills"
// design, combined with HKUDS/CLI-Anything's SKILL.md modular card format.
//
// Auto-activates the moment a pattern repeats, matching this codebase's
// established "automate the pipeline, dashboard is a glance not a workbench"
// philosophy.
//
// Deliberately excludes any sequence that touched a write/confirmation-
// required tool — that filtering happens at the CALL SITE (App.jsx /
// aloyServer.cjs already know whether a turn went through the write-tool
// confirmation flow), not here. A skill nudging the model toward
// automatically repeating a WRITE action is a much bigger risk than
// nudging it toward a known-good READ sequence, so read-only sequences are
// the only kind this module ever sees.
const fs = require('fs');
const path = require('path');
const os = require('os');
const store = require('./store.cjs');
const { categorize } = require('./skillsDashboard.cjs');
const { stripContextBoilerplate } = require('./confidenceEscalation.cjs');
const { isSensitiveContent } = require('./sensitiveContent.cjs');

const MAX_LOG_ENTRIES = 300;
const MIN_OCCURRENCES_TO_SYNTHESIZE = 3;
const DEFAULT_SKILLS_DIR = path.join(os.homedir(), 'AloyFiles', 'skills');

// Low-signal tools that alone do not constitute a standalone synthesized skill
const TRIVIAL_POLL_TOOLS = new Set([
  'get_smart_home_automations',
  'get_current_time'
]);

function sequenceKey(toolSequence) {
  return toolSequence.join('>');
}

/**
 * Validates whether a tool sequence represents a genuine high-signal composite workflow.
 */
function isHighSignalSequence(toolSequence) {
  if (!Array.isArray(toolSequence) || toolSequence.length < 2) {
    return false; // Reject single-tool memorization
  }

  // Reject sequences composed entirely of trivial screenshot/polling tools
  const nonTrivial = toolSequence.filter(t => !TRIVIAL_POLL_TOOLS.has(t));
  if (nonTrivial.length === 0) {
    return false;
  }

  return true;
}

/**
 * Format a synthesized skill into CLI-Anything / standard agent SKILL.md markdown
 */
function formatSkillAsSkillMd(skill) {
  if (!skill) return '';
  const tools = Array.isArray(skill.toolSequence) ? skill.toolSequence : [];
  const stepsMarkdown = tools.map((tool, idx) => {
    return `${idx + 1}. **\`${tool}\`**\n   - *Purpose*: Query intermediate data for category \`${skill.category}\`\n   - *Failure Recovery*: If unavailable, verify connection or check fallback tools.`;
  }).join('\n');

  return `---
name: Aloy Skill - ${skill.category}
category: ${skill.category}
synthesized_at: ${skill.createdAt || new Date().toISOString()}
last_seen_at: ${skill.lastSeenAt || new Date().toISOString()}
occurrences: ${skill.occurrences || 1}
---

# ${skill.category} Workflow

## 1. Intent & Trigger
- **Category**: \`${skill.category}\`
- **Example Prompt**: "${skill.exampleQuestion || 'N/A'}"
- **Pattern Confidence**: ${skill.occurrences || 1} verified repetitions in user interaction logs.

## 2. Deterministic Tool Execution Pipeline
Execute the following sequence in exact order to satisfy requests in this domain:

${stepsMarkdown}

## 3. Cognitive Guardrails & Error Recovery
- **Read-Only Scope**: This synthesized skill contains only non-destructive read actions.
- **Self-Correction**: If any step in the pipeline returns a \`status: "error"\` envelope or exception, review the \`[SYSTEM HINT]\` and attempt the next logical alternative.
- **Safety**: Do not substitute write/modification tools without explicit human confirmation.
`;
}

/**
 * Export all synthesized skills to disk in SKILL.md format (e.g. for Obsidian or agent consumption)
 */
function exportSkillsToDisk(targetDir = DEFAULT_SKILLS_DIR) {
  try {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const d = store.load();
    const skills = (d.skills || []).filter(s => isHighSignalSequence(s.toolSequence));
    const exportedFiles = [];

    // Clean old files in targetDir
    try {
      const existingFiles = fs.readdirSync(targetDir);
      for (const f of existingFiles) {
        if (f.startsWith('skill_') && f.endsWith('.md')) {
          fs.unlinkSync(path.join(targetDir, f));
        }
      }
    } catch {}

    for (const skill of skills) {
      const safeCat = String(skill.category || 'general').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      const safeSeq = (skill.toolSequence || []).join('_').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
      const filename = `skill_${safeCat}_${safeSeq}.md`;
      const filePath = path.join(targetDir, filename);
      const content = formatSkillAsSkillMd(skill);
      fs.writeFileSync(filePath, content, 'utf-8');
      exportedFiles.push(filePath);
    }

    // Write index README.md
    const indexContent = `# Aloy Synthesized Skills Hub

Auto-generated from high-signal composite agent workflows (harvested from CLI-Anything & KiroCrew skill architectures).

Total High-Signal Synthesized Skills: ${skills.length}

${skills.map((s) => `- **[${s.category}]** (${(s.toolSequence || []).join(' → ')}) — *${s.occurrences} runs*`).join('\n')}
`;
    fs.writeFileSync(path.join(targetDir, 'README.md'), indexContent, 'utf-8');

    return { success: true, count: skills.length, exportedFiles, targetDir };
  } catch (err) {
    console.error('Failed to export skills to disk:', err.message);
    return { success: false, error: err.message };
  }
}

async function logToolCallSequence({ question, toolSequence }) {
  if (!isHighSignalSequence(toolSequence)) return null;
  const cleanQuestion = stripContextBoilerplate(question || '');
  if (!cleanQuestion || isSensitiveContent(cleanQuestion)) return null;

  const category = await categorize(cleanQuestion);
  const d = store.load();
  const log = d.toolCallLog || [];
  log.push({
    timestamp: new Date().toISOString(),
    question: cleanQuestion.slice(0, 200),
    toolSequence,
    category
  });
  d.toolCallLog = log.slice(-MAX_LOG_ENTRIES);

  // How many logged entries share this exact category + ordered tool
  // sequence, including the one just added.
  const key = sequenceKey(toolSequence);
  const matches = d.toolCallLog.filter((e) => e.category === category && sequenceKey(e.toolSequence) === key);

  let synthesized = null;
  if (matches.length >= MIN_OCCURRENCES_TO_SYNTHESIZE) {
    const skills = d.skills || [];
    const existing = skills.find((s) => s.category === category && sequenceKey(s.toolSequence) === key);
    if (existing) {
      existing.occurrences = matches.length;
      existing.lastSeenAt = new Date().toISOString();
      synthesized = existing;
    } else {
      synthesized = {
        id: `skill-${Date.now()}`,
        category,
        toolSequence,
        exampleQuestion: cleanQuestion.slice(0, 200),
        occurrences: matches.length,
        createdAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString()
      };
      d.skills = [...skills, synthesized];
    }
  }

  // Filter out any legacy low-signal single-tool skills
  d.skills = (d.skills || []).filter(s => isHighSignalSequence(s.toolSequence));

  store.save(d);

  if (synthesized) {
    // Automatically export / sync markdown SKILL.md files to disk
    try {
      exportSkillsToDisk();
    } catch (_) {}
  }

  return synthesized;
}

// Skills relevant to the CURRENT question's category — injected as a
// system-prompt hint so Aloy proactively follows a known-good tool
// sequence instead of rediscovering (or guessing wrong, as happened with
// the AutoRipManager MCP-path-guessing miss) it every time.
async function getRelevantSkills(question) {
  const cleanQuestion = stripContextBoilerplate(question || '');
  if (!cleanQuestion) return [];
  const category = await categorize(cleanQuestion);
  const d = store.load();
  return (d.skills || []).filter((s) => s.category === category);
}

module.exports = {
  logToolCallSequence,
  getRelevantSkills,
  formatSkillAsSkillMd,
  exportSkillsToDisk,
  DEFAULT_SKILLS_DIR
};
