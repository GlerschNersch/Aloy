// QLoRA Training Dataset Builder for Aloy Ecosystem.
// Separates training corpora strictly:
// 1. aloy-ai: Conversational assistant model (lessons, verified knowledge, escalations, skills)
// 2. hephaestus-code: Dedicated software engineering model (approved diffs, code review critiques)

const fs = require('fs');
const path = require('path');
const os = require('os');
const store = require('../store.cjs');
const { stripContextBoilerplate } = require('../confidenceEscalation.cjs');

const TRAINING_DIR = path.join(os.homedir(), '.aloy-server', 'training');
const ALOY_AI_TRAIN_FILE = path.join(TRAINING_DIR, 'aloy_ai_train.jsonl');
const ALOY_AI_HOLDOUT_FILE = path.join(TRAINING_DIR, 'aloy_ai_eval_holdout.jsonl');
const HEPH_CODE_TRAIN_FILE = path.join(TRAINING_DIR, 'hephaestus_code_train.jsonl');
const ESCALATION_ARCHIVE_FILE = path.join(TRAINING_DIR, 'escalation_archive.jsonl');

const GO_NO_GO_THRESHOLD = 100;
const HOLDOUT_RATIO = 0.15;

// Deterministic PRNG (mulberry32). The split must be REPRODUCIBLE — rebuilding
// the dataset shouldn't silently move samples between train and holdout, or a
// "regression" is really just reshuffled data. It must ALSO be genuinely
// random, which a sort is not: the previous implementation sorted by
// instruction text and sliced the tail, which put every
// "What is the accurate fact regarding: X?" lesson in the holdout and nothing
// else, because they sort last. A seeded shuffle gives both properties.
function makeRng(seed = 1337) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(arr, seed = 1337) {
  const out = [...arr];
  const rng = makeRng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// Stratified split: shuffle WITHIN each sample type, then take HOLDOUT_RATIO
// from each. Guarantees the holdout holds a proportional mix of lessons /
// knowledge / skills / escalations rather than being dominated by whichever
// category clusters together alphabetically.
function stratifiedSplit(samples, ratio = HOLDOUT_RATIO, seed = 1337) {
  const byType = new Map();
  for (const s of samples) {
    if (!byType.has(s.type)) byType.set(s.type, []);
    byType.get(s.type).push(s);
  }
  const train = [];
  const holdout = [];
  for (const type of [...byType.keys()].sort()) {
    const group = seededShuffle(byType.get(type), seed);
    // Never hold out a lone sample — that removes the type from training
    // entirely for no measurement benefit.
    const n = group.length <= 1 ? 0 : Math.max(1, Math.floor(group.length * ratio));
    holdout.push(...group.slice(0, n));
    train.push(...group.slice(n));
  }
  return {
    train: seededShuffle(train, seed + 1),
    holdout: seededShuffle(holdout, seed + 2)
  };
}

function ensureTrainingDir() {
  if (!fs.existsSync(TRAINING_DIR)) {
    fs.mkdirSync(TRAINING_DIR, { recursive: true });
  }
}

/**
 * Formats a single instruction pair into Alpaca format for the local model.
 */
function formatAlpacaSample(instruction, input = '', output = '', systemPrompt = "You are Aloy, a personalized 100% local AI assistant.") {
  return {
    instruction: stripContextBoilerplate(instruction).trim(),
    input: input.trim(),
    output: output.trim(),
    system: systemPrompt
  };
}

/**
 * Normalizes prompt text for deduplication.
 */
function normalizePrompt(prompt) {
  return stripContextBoilerplate(prompt)
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Loads all escalations from both the store and the permanent archive.
 */
function loadAllEscalations() {
  const escalations = [];
  const seenSignatures = new Set();

  // 1. Load from permanent archive if available
  if (fs.existsSync(ESCALATION_ARCHIVE_FILE)) {
    try {
      const lines = fs.readFileSync(ESCALATION_ARCHIVE_FILE, 'utf8').trim().split('\n').filter(Boolean);
      for (const line of lines) {
        try {
          const item = JSON.parse(line);
          const sig = normalizePrompt(item.cleanQuestion || item.question || '');
          if (sig && !seenSignatures.has(sig) && item.claudeAnswer) {
            seenSignatures.add(sig);
            escalations.push({
              question: item.cleanQuestion || item.question,
              answer: item.claudeAnswer,
              provider: item.provider || 'claude',
              timestamp: item.timestamp
            });
          }
        } catch {}
      }
    } catch (e) {
      console.warn('[DatasetBuilder] Warning reading escalation archive:', e.message);
    }
  }

  // 2. Load from live store (and backfill into archive if missing)
  const d = store.load();
  const liveEscalations = d.claudeEscalations || [];
  for (const item of liveEscalations) {
    // Quality gate: only escalations the nightly teaching pass actually
    // verified (skillsDashboard.cjs's runNightlyAutoTeaching tags these
    // 'confirmed' after BOTH Claude answered and Gemini independently
    // agreed). 'needs_review' / 'error' entries are exactly the ones we
    // should NOT be teaching the model as ground truth. Untagged entries
    // are allowed through because they predate the tagging pipeline —
    // tighten to strict 'confirmed' once the backlog is tagged.
    if (item.teachingStatus && item.teachingStatus !== 'confirmed') continue;
    const cleanQ = stripContextBoilerplate(item.question || '');
    const sig = normalizePrompt(cleanQ);
    if (sig && !seenSignatures.has(sig) && item.claudeAnswer) {
      seenSignatures.add(sig);
      escalations.push({
        question: cleanQ,
        answer: item.claudeAnswer,
        provider: item.provider || 'claude',
        timestamp: item.timestamp
      });

      // Archive backfill
      try {
        ensureTrainingDir();
        fs.appendFileSync(ESCALATION_ARCHIVE_FILE, JSON.stringify({
          timestamp: item.timestamp,
          question: item.question,
          cleanQuestion: cleanQ,
          localAnswer: item.localAnswer,
          claudeAnswer: item.claudeAnswer,
          provider: item.provider
        }) + '\n', 'utf8');
      } catch {}
    }
  }

  return escalations;
}

/**
 * Phase 0: Audit the current aloy-ai sample pool and compute go/no-go status.
 */
function auditAloyAiDataset() {
  ensureTrainingDir();
  const d = store.load();

  const lessons = (d.lessons || []).filter(l => l.topic && l.correction);
  const knowledge = (d.learnedKnowledge || []).filter(k => k.topic && k.summary && k.geminiVerification?.status === 'verified');
  const skills = (d.skills || []).filter(s => s.exampleQuestion && s.toolSequence);
  const escalations = loadAllEscalations();

  // Deduplicate combined dataset
  const promptMap = new Map();

  for (const l of lessons) {
    const p = `What is the accurate fact regarding: ${l.topic}?`;
    promptMap.set(normalizePrompt(p), { type: 'lesson', instruction: p, output: l.correction });
  }

  for (const k of knowledge) {
    const p = `Provide the verified facts on: ${k.topic}`;
    promptMap.set(normalizePrompt(p), { type: 'knowledge', instruction: p, output: k.summary });
  }

  for (const s of skills) {
    const p = s.exampleQuestion;
    promptMap.set(normalizePrompt(p), {
      type: 'skill',
      instruction: p,
      output: `To handle this request accurately, call the following sequence: ${s.toolSequence.join(' -> ')}`
    });
  }

  for (const e of escalations) {
    const p = e.question;
    const sig = normalizePrompt(p);
    if (!promptMap.has(sig)) {
      promptMap.set(sig, { type: 'escalation', instruction: p, output: e.answer });
    }
  }

  const dedupedCount = promptMap.size;
  const isGo = dedupedCount >= GO_NO_GO_THRESHOLD;

  return {
    gatePassed: isGo,
    decision: isGo ? 'GO' : 'NO-GO (INSUFFICIENT DISTINCT SAMPLES)',
    thresholdRequired: GO_NO_GO_THRESHOLD,
    totalUsableSamples: dedupedCount,
    breakdown: {
      userLessons: lessons.length,
      verifiedKnowledge: knowledge.length,
      skillsTrajectories: skills.length,
      archivedEscalations: escalations.length
    },
    recommendation: isGo
      ? `Proceed to Phase 1 eval and Phase 2 QLoRA fine-tuning for aloy-ai-v2.`
      : `Continue gathering escalations in escalation_archive.jsonl. Need ${GO_NO_GO_THRESHOLD - dedupedCount} more distinct verified samples before training.`
  };
}

/**
 * Builds the isolated aloy-ai fine-tuning dataset with an 85/15 train/holdout split.
 */
function buildAloyAiDataset() {
  ensureTrainingDir();
  const d = store.load();
  const rawSamples = [];
  const seenSignatures = new Set();

  function addSample(instruction, output, type = 'general') {
    if (!instruction || !output) return;
    const cleanOutput = stripContextBoilerplate(output);
    if (!cleanOutput) return;

    const sig = normalizePrompt(instruction);
    if (seenSignatures.has(sig)) return;
    seenSignatures.add(sig);

    rawSamples.push({
      instruction: instruction.trim(),
      input: '',
      output: cleanOutput,
      type
    });
  }

  // 1. User Corrections & Lessons Learned
  for (const l of (d.lessons || [])) {
    if (l.topic && l.correction) {
      addSample(`What is the accurate fact regarding: ${l.topic}?`, l.correction, 'lesson');
    }
  }

  // 2. Verified Knowledge Nuggets
  for (const k of (d.learnedKnowledge || [])) {
    if (k.topic && k.summary && k.geminiVerification?.status === 'verified') {
      addSample(`Provide the verified facts on: ${k.topic}`, k.summary, 'knowledge');
    }
  }

  // 3. Learned Skills — EXCLUDED from the training corpus by default.
  //
  // These were being emitted as prose ("call the following sequence: A -> B").
  // At inference aloy-ai must emit real tool-call tokens, not a description of
  // tool calls, so training on prose actively teaches the wrong output format
  // and risks degrading tool calling — the opposite of the intent. Skills
  // already reach the model the correct way: skillSynthesis.getRelevantSkills()
  // injects them into the system prompt at runtime.
  //
  // To train tool use properly, emit samples in the SAME tool-call format the
  // model produces at inference (assistant message with a tool_calls array),
  // not English describing it. Flip INCLUDE_SKILL_SAMPLES once that format is
  // implemented and verified against the base model's chat template.
  const INCLUDE_SKILL_SAMPLES = false;
  for (const s of (INCLUDE_SKILL_SAMPLES ? (d.skills || []) : [])) {
    if (s.exampleQuestion && s.toolSequence) {
      addSample(
        s.exampleQuestion,
        `To handle this request accurately, call the following sequence: ${s.toolSequence.join(' -> ')}`,
        'skill'
      );
    }
  }

  // 4. Escalation Archive (Past verified Claude solutions)
  for (const e of loadAllEscalations()) {
    if (e.question && e.answer) {
      addSample(e.question, e.answer, 'escalation');
    }
  }

  // Seeded reproducible shuffle
  const rng = makeRng(1337);
  for (let i = rawSamples.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [rawSamples[i], rawSamples[j]] = [rawSamples[j], rawSamples[i]];
  }

  // Train / Holdout Split
  const holdoutCount = Math.max(1, Math.round(rawSamples.length * HOLDOUT_RATIO));
  const trainCount = rawSamples.length - holdoutCount;

  const trainSamples = rawSamples.slice(0, trainCount);
  const holdoutSamples = rawSamples.slice(trainCount);

  // Write datasets atomically
  fs.writeFileSync(ALOY_AI_TRAIN_FILE, trainSamples.map(s => JSON.stringify(s)).join('\n') + '\n');
  fs.writeFileSync(ALOY_AI_HOLDOUT_FILE, holdoutSamples.map(s => JSON.stringify(s)).join('\n') + '\n');

  return {
    corpus: 'aloy-ai',
    totalSamples: rawSamples.length,
    trainCount: trainSamples.length,
    holdoutCount: holdoutSamples.length,
    trainFile: ALOY_AI_TRAIN_FILE,
    holdoutFile: ALOY_AI_HOLDOUT_FILE,
    trainFilePath: ALOY_AI_TRAIN_FILE,
    holdoutFilePath: ALOY_AI_HOLDOUT_FILE
  };
}

/**
 * Builds the Hephaestus software engineering dataset from verified code diffs and critiques.
 */
function buildHephaestusDataset() {
  ensureTrainingDir();
  let codeCount = 0;
  if (fs.existsSync(HEPH_CODE_TRAIN_FILE)) {
    try {
      const lines = fs.readFileSync(HEPH_CODE_TRAIN_FILE, 'utf8').trim().split('\n').filter(Boolean);
      codeCount = lines.length;
    } catch {}
  }

  return {
    corpus: 'hephaestus-code',
    totalSamples: codeCount,
    filePath: HEPH_CODE_TRAIN_FILE,
    description: 'Isolated coding model dataset (approved diffs & review critiques).'
  };
}

module.exports = {
  TRAINING_DIR,
  MATT_AI_TRAIN_FILE: ALOY_AI_TRAIN_FILE,
  MATT_AI_HOLDOUT_FILE: ALOY_AI_HOLDOUT_FILE,
  ALOY_AI_TRAIN_FILE,
  ALOY_AI_HOLDOUT_FILE,
  HEPH_CODE_TRAIN_FILE,
  ESCALATION_ARCHIVE_FILE,
  auditMattAiDataset: auditAloyAiDataset,
  buildMattAiDataset: buildAloyAiDataset,
  auditAloyAiDataset,
  buildAloyAiDataset,
  buildDistillationDataset: buildAloyAiDataset,
  buildHephaestusDataset
};
