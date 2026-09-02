// Skills dashboard aggregation — groups claudeEscalations (gaps: questions
// that needed Claude's help) and learnedKnowledge (confirmed: topics
// actively researched and saved) by topic category, so the user can see
// where Aloy is weak vs. where it's been deliberately reinforced.
//
// Proficiency scoring left exactly as originally built (confirmedCount /
// (confirmedCount + gapCount), untouched categories default to 100%) — the
// user was asked whether to fix the "untested = 100% Mastered" quirk and
// explicitly said to leave it as-is 2026-08-04. Don't change this without
// being asked again.
const store = require('./store.cjs');
const { MODELS, geminiUrl } = require('./models.cjs');
const { stripContextBoilerplate } = require('./confidenceEscalation.cjs');

// Order matters: first match wins, so put more specific categories before
// the General Knowledge catch-all.
const CATEGORIES = [
  { name: 'Smart Home & Automations', keywords: ['light', 'switch', 'lock', 'thermostat', 'automation', 'sensor', 'device', 'turn on', 'turn off', 'climate', 'garage', 'motion', 'smart home', 'entity'] },
  { name: 'Dashboards & Lovelace', keywords: ['dashboard', 'card', 'lovelace', 'button-card', 'template', 'sections view', 'masonry'] },
  { name: 'Vision & Cameras', keywords: ['doorbell', 'camera', 'driveway', 'gaming detection', 'vision', 'person detected', 'backyard', 'behind garage'] },
  { name: 'Finances', keywords: ['budget', 'spending', 'transaction', 'expense', 'income', 'finance'] },
  { name: 'Calendar & Reminders', keywords: ['calendar', 'schedule', 'reminder', 'event', 'appointment', 'chore'] },
  { name: 'Projects', keywords: ['autorip', 'handbrake', 'nvenc', 'encode', 'ripping', 'project', 'build'] },
  // Real-world dev skills (developer work) — kept separate from General
  // Knowledge so pure trivia questions (hallucination-bait test prompts,
  // "what's the boiling point of X") don't dilute the signal on whether
  // Aloy is actually reliable for coding help specifically.
  { name: 'Programming & Web Development', keywords: ['html', 'css', 'javascript', 'typescript', 'react', 'python', 'node', 'npm', 'git ', 'regex', 'sql', 'database', 'api', 'json', 'function', 'variable', 'algorithm', 'syntax', 'flexbox', 'grid layout', 'dom', 'webpack', 'vite', 'debug', 'compile', 'refactor'] },
  { name: 'General Knowledge', keywords: [] } // catch-all, always matches
];

// Category "profile" embeddings (one per category's joined keyword list),
// computed once lazily and cached in-memory for the life of the process —
// cheap (7 calls, ever), reused by the embedding fallback below.
let categoryEmbeddingsCache = null;
async function getCategoryEmbeddings() {
  if (categoryEmbeddingsCache) return categoryEmbeddingsCache;
  const { getEmbedding } = require('./confidenceEscalation.cjs');
  const map = new Map();
  for (const cat of CATEGORIES) {
    if (cat.keywords.length === 0) continue;
    map.set(cat.name, await getEmbedding(cat.keywords.join(', ')));
  }
  categoryEmbeddingsCache = map;
  return map;
}

// Keyword substring matching stays the fast path (instant, no API call) for
// the common case where a question clearly names its domain. Only when NO
// keyword matches at all does this fall back to a hybrid embedding
// comparison against each category's keyword-list profile — added
// 2026-08-04 (harvested from KiroCrew's blended vector+keyword scoring)
// specifically to bound the cost: before this, every non-keyword-matching
// entry went straight to General Knowledge; now paraphrased questions get
// one real chance at their actual category instead, without adding an
// embedding call to the (already-working) keyword-matched majority.
async function categorize(text) {
  const lower = (text || '').toLowerCase();
  for (const cat of CATEGORIES) {
    if (cat.keywords.length === 0) continue; // catch-all handled last, after the embedding fallback
    if (cat.keywords.some((k) => lower.includes(k))) return cat.name;
  }
  try {
    const { getEmbedding, cosineSimilarity } = require('./confidenceEscalation.cjs');
    const qEmbedding = await getEmbedding(text);
    if (qEmbedding) {
      const profiles = await getCategoryEmbeddings();
      let bestName = null;
      let bestScore = 0;
      for (const [name, profile] of profiles) {
        if (!profile) continue;
        const score = cosineSimilarity(qEmbedding, profile);
        if (score > bestScore) { bestScore = score; bestName = name; }
      }
      // Require real similarity before overriding the catch-all — a weak
      // match is worse than an honest "General Knowledge".
      if (bestName && bestScore >= 0.55) return bestName;
    }
  } catch {
    // Embedding lookup failed (e.g. Ollama down) — fall through to the
    // catch-all, same behavior as before this upgrade existed.
  }
  return 'General Knowledge';
}

// An escalation still counts as an open "gap" unless the automated teaching
// pipeline already confirmed a resolution for it. 'needs_review' and 'error'
// stay open on purpose — they're not resolved, just not silently retried
// forever (see runNightlyAutoTeaching's once-per-entry gate below).
function isOpenGap(entry) {
  return entry.teachingStatus !== 'confirmed' && entry.teachingStatus !== 'skipped';
}

async function getSkillsDashboard() {
  const d = store.load();
  const escalations = d.claudeEscalations || [];
  const learned = d.learnedKnowledge || [];

  const byCategory = new Map(CATEGORIES.map((c) => [c.name, { name: c.name, gapCount: 0, confirmedCount: 0, needsReviewCount: 0, recentGaps: [], recentConfirmed: [] }]));

  for (const e of escalations) {
    if (!isOpenGap(e)) continue;
    const cleaned = stripContextBoilerplate(e.question || '');
    const cat = byCategory.get(await categorize(cleaned));
    cat.gapCount += 1;
    if (e.teachingStatus === 'needs_review') cat.needsReviewCount += 1;
    cat.recentGaps.push({ id: e.id || e.timestamp, question: cleaned.slice(0, 140), timestamp: e.timestamp, answer: e.claudeAnswer, teachingStatus: e.teachingStatus || 'pending' });
  }

  for (const k of learned) {
    const cat = byCategory.get(await categorize(k.topic || ''));
    cat.confirmedCount += 1;
    cat.recentConfirmed.push({ id: k.id, topic: k.topic, summary: k.summary, savedAt: k.savedAt, autoGenerated: !!k.autoGenerated });
  }

  let totalScoreSum = 0;
  let totalNeedsReview = 0;

  const categories = [...byCategory.values()].map((cat) => {
    const total = cat.confirmedCount + cat.gapCount;
    let proficiencyScore = 100;
    let proficiencyLabel = 'Mastered';

    if (total > 0) {
      if (cat.gapCount === 0) {
        proficiencyScore = 100;
        proficiencyLabel = cat.confirmedCount > 0 ? 'Mastered 🌟' : 'Optimal';
      } else {
        proficiencyScore = Math.round((cat.confirmedCount / total) * 100);
        if (proficiencyScore >= 90) proficiencyLabel = 'High Competency';
        else if (proficiencyScore >= 70) proficiencyLabel = 'Developing';
        else if (proficiencyScore >= 40) proficiencyLabel = 'Needs Training';
        else proficiencyLabel = 'Critical Gaps';
      }
    }

    totalScoreSum += proficiencyScore;
    totalNeedsReview += cat.needsReviewCount;
    return { ...cat, proficiencyScore, proficiencyLabel };
  }).sort((a, b) => b.proficiencyScore !== a.proficiencyScore ? a.proficiencyScore - b.proficiencyScore : (b.gapCount + b.confirmedCount) - (a.gapCount + a.confirmedCount));

  const overallProficiencyScore = categories.length > 0 ? Math.round(totalScoreSum / categories.length) : 100;

  return {
    categories,
    overallProficiencyScore,
    needsReviewCount: totalNeedsReview,
    skillsLearnedCount: (d.skills || []).length,
    lastAutoTeachingRun: d.lastAutoTeachingRun || null,
    documentProofreading: store.getDocumentProofreadStats()
  };
}

// Automated nightly teaching pass (added 2026-08-04, replacing the earlier
// autoResolveAllGaps which wiped ALL escalation history unconditionally and
// saved everything with zero verification — including once saving an answer
// Claude itself had flagged "unverified" after its search budget ran out).
// This version is deliberately safer on three axes:
//   1. Never deletes claudeEscalations — each entry is tagged with a
//      teachingStatus instead, so the history stays intact and auditable.
//   2. Only processes entries without an existing teachingStatus, so a
//      second run doesn't redo (and re-bill) work already done.
//   3. Requires Claude's research AND an independent Gemini verification
//      pass to agree before anything lands in learnedKnowledge — anything
//      Gemini can't confirm gets tagged 'needs_review' instead of saved,
//      surfaced via the dashboard's needsReviewCount rather than silently
//      written into a bank injected into every future prompt.
// Capped per run (MAX_PER_RUN) to bound cost/time on a single pass — a
// large backlog drains across multiple nights rather than one expensive run.
const MAX_PER_RUN = 15;

// Lessons (explicit user corrections, save_lesson tool) always outrank
// auto-researched knowledge on the same topic — added 2026-08-04. A crude
// word-overlap check is enough here: false positives just mean an
// auto-teaching entry gets skipped in favor of trusting the user's own
// correction, which is the safe direction to err in.
function topicConflictsWithLesson(topic, lessons) {
  if (!lessons || lessons.length === 0) return null;
  const words = (s) => new Set(String(s || '').toLowerCase().match(/[a-z0-9]{4,}/g) || []);
  const topicWords = words(topic);
  if (topicWords.size === 0) return null;
  for (const lesson of lessons) {
    const lessonWords = words(lesson.topic);
    if (lessonWords.size === 0) continue;
    let overlap = 0;
    for (const w of lessonWords) if (topicWords.has(w)) overlap++;
    if (overlap / lessonWords.size >= 0.5) return lesson;
  }
  return null;
}

async function runNightlyAutoTeaching() {
  const { researchTopic } = require('./research.cjs');
  const { verifyWithGemini } = require('./geminiVerification.cjs');
  const { isSensitiveContent } = require('./sensitiveContent.cjs');
  const d = store.load();
  const escalations = d.claudeEscalations || [];
  const unprocessed = escalations.filter((e) => !e.teachingStatus).slice(0, MAX_PER_RUN);

  let confirmedCount = 0, reviewCount = 0, errorCount = 0, skippedCount = 0;

  for (const item of unprocessed) {
    const question = stripContextBoilerplate(item.question || '');
    if (!question) {
      item.teachingStatus = 'skipped';
      skippedCount++;
      continue;
    }
    // Never auto-research/save content that looks like it contains real
    // secrets or PII (e.g. a pasted .env, an attached document with an SSN)
    // — see sensitiveContent.cjs. Root-caused 2026-08-04: the OLD
    // (since-removed) immediate auto-resolve path in confidenceEscalation.cjs
    // had no such guard and once saved a full resume PDF's content into
    // learnedKnowledge as "general knowledge."
    if (isSensitiveContent(question)) {
      item.teachingStatus = 'skipped';
      item.reviewNotes = 'Skipped auto-learning: question content matched a sensitive-data pattern (possible secret/PII).';
      skippedCount++;
      continue;
    }
    const conflictingLesson = topicConflictsWithLesson(question, d.lessons);
    if (conflictingLesson) {
      item.teachingStatus = 'skipped';
      item.reviewNotes = `Skipped auto-learning: overlaps with an existing user-corrected lesson ("${conflictingLesson.topic}") — lessons always take priority over auto-research.`;
      skippedCount++;
      continue;
    }
    try {
      const research = await researchTopic({ topic: question });

      // If Claude's own research concludes there's no real factual answer
      // (the common outcome for the hallucination-bait/fictional-topic test
      // questions that make up a chunk of escalation history), there's
      // nothing to verify or save — skip Gemini entirely rather than
      // attempting it. This isn't just an optimization: reproducibly
      // confirmed 2026-08-04 that exactly this shape of content — a
      // "there is no X" research summary, run through the verify-prompt
      // wrapper with search grounding enabled — triggers a real bug in
      // Gemini's Interactions API (a generic 400, sometimes surfaced as
      // "Model generated invalid JSON syntax"), even across retries. No
      // point spending an API call chasing a verdict on content that was
      // never going to become a saved knowledge entry either way.
      const noRealAnswer = /\b(there is no|there's no|no canonical|no real|doesn't exist|does not exist|would be fabricated|i can'?t (give|do|answer)|nothing to (verify|confirm))\b/i.test(research.summary.slice(0, 300));
      if (noRealAnswer) {
        item.teachingStatus = 'needs_review';
        item.reviewNotes = "Claude's research found no real factual answer to verify — nothing to save either way.";
        reviewCount++;
        continue;
      }

      const verification = await verifyWithGemini({ topic: research.topic, summary: research.summary });

      if (verification.confident) {
        const { embedKnowledgeEntry } = require('./knowledgeRetrieval.cjs');
        const entry = await embedKnowledgeEntry({
          id: `knowledge-${Date.now()}-${confirmedCount}`,
          topic: research.topic,
          summary: research.summary,
          sources: research.sources || [],
          savedAt: new Date().toISOString(),
          autoGenerated: true,
          verifiedBy: MODELS.GEMINI
        });
        d.learnedKnowledge = [...(d.learnedKnowledge || []), entry];
        item.teachingStatus = 'confirmed';
        confirmedCount++;
      } else {
        item.teachingStatus = 'needs_review';
        item.reviewNotes = verification.notes;
        reviewCount++;
      }
    } catch (err) {
      item.teachingStatus = 'error';
      item.reviewNotes = err.message;
      errorCount++;
      console.warn(`[auto-teaching] Error processing "${question.slice(0, 80)}":`, err.message);
    }
  }

  d.claudeEscalations = escalations; // items mutated in place above
  d.lastAutoTeachingRun = new Date().toISOString();
  store.save(d);

  try {
    const { syncToVault } = require('./vaultSync.cjs');
    syncToVault();
  } catch (err) {
    console.warn('[auto-teaching] Vault sync failed:', err.message);
  }

  return { processed: unprocessed.length, confirmedCount, reviewCount, errorCount, skippedCount };
}

module.exports = { getSkillsDashboard, categorize, runNightlyAutoTeaching, CATEGORIES, isOpenGap };
