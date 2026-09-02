// Confidence scoring + Claude escalation for low-confidence local (Ollama)
// answers. This is the ONE place either client path (desktop, via an
// electron.cjs IPC handler, and mobile/API, via aloyServer.cjs's Express
// routes) calls into — keeps the Anthropic API key server-side only (never
// bundled into the renderer) and avoids duplicating the logic per client.
const fs = require('fs');
const path = require('path');
const os = require('os');
const store = require('./store.cjs');
const { MODELS, geminiUrl } = require('./models.cjs');
const { httpFetch, TIMEOUTS } = require('./http.cjs');

const TRAINING_DIR = path.join(os.homedir(), '.aloy-server', 'training');
const ESCALATION_ARCHIVE_FILE = path.join(TRAINING_DIR, 'escalation_archive.jsonl');

const OLLAMA_URL = 'http://localhost:11434';
const CLAUDE_MODEL = MODELS.CLAUDE;
const MAX_ESCALATIONS_STORED = 200;
// Below this probability, a MEDIUM self-rating is still treated as low
// confidence — a LOW rating always escalates regardless of probability.
const CONFIDENCE_PROBABILITY_THRESHOLD = 0.6;
// Cosine similarity above which a past escalation is considered "the same
// question" and its cached Claude answer is reused instead of calling the
// API again — this is the actual self-improvement loop: repeated or
// near-duplicate low-confidence questions get progressively cheaper instead
// of hitting Claude every time.
const CACHE_SIMILARITY_THRESHOLD = 0.92;
// Beyond this age, a cached answer is never reused even for a near-identical
// question — forces a fresh escalation instead. Added 2026-08-04 (harvested
// from KiroCrew's memory-decay concept) as a hard cutoff rather than a
// continuous decay curve applied to the similarity score: a decayed score
// would also degrade genuinely still-correct EXACT repeats (e.g. "what year
// did I start at AWS," a fact that never changes), which defeats the whole
// point of caching literal/near-literal repeats. A bounded TTL instead
// targets the actual risk — the answer's underlying real-world state
// (project settings, automations, etc.) may have changed — without
// punishing time-invariant questions.
const CACHE_MAX_AGE_DAYS = 45;

// Strips the per-message context boilerplate (App.jsx's handleSendMessage /
// aloyServer.cjs's augmentLastUserMessage prepend this to the RAW message
// content itself, not a separate field) before embedding — found 2026-08-04
// via a live before/after test: the exact same question asked twice (once
// through desktop, once raw) scored only 0.83 cosine similarity, well below
// CACHE_SIMILARITY_THRESHOLD, because the timestamp and webcam-presence
// lines differ every call and were dominating the embedding. Without this,
// the cache essentially never hit, even on literal repeats — not just the
// already-known "doesn't generalize to rephrasings" limitation, but a
// stricter failure underneath it. Same regexes as aloyServer.cjs's
// cleanQuestionForDisplay (report display), which now reuses this function
// rather than duplicating them.
function stripContextBoilerplate(text) {
  let q = text;
  q = q.replace(/^\[CURRENT DATE\/TIME\]:.*?\n\n/s, '');
  q = q.replace(/^\[REAL-TIME WEBCAM PRESENCE\]:.*?\n\n/s, '');
  q = q.replace(/^User Request:\s*/im, '');
  return q.trim();
}

async function getEmbedding(text) {
  try {
    const res = await httpFetch(`${OLLAMA_URL}/api/embeddings`, {
      timeoutMs: TIMEOUTS.EMBEDDING,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODELS.EMBEDDING, prompt: text.slice(0, 1000) })
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.embedding || null;
  } catch {
    return null;
  }
}

function cosineSimilarity(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

function decodeToken(t) {
  return Buffer.from(t.bytes).toString('utf-8');
}

// Asks the SAME local model to judge the answer it just gave as a forced
// binary YES/NO, then scores that judgment via its real per-token logprob
// (Ollama's OpenAI-compatible endpoint, confirmed to support `logprobs` even
// though the native /api/generate does not) rather than trusting the label
// text alone.
//
// Two things learned empirically that shape this function and are NOT
// obvious from the API docs:
// - `think: false` does NOT suppress this model's reasoning channel on the
//   OpenAI-compatible endpoint (it does on the native /api/chat endpoint,
//   which the main chat path uses) — the model still emits a `<|channel>
//   thought` preamble that can run 100-600+ tokens before the actual
//   YES/NO. A small max_tokens (the original version of this function used
//   5) just truncates mid-reasoning and never reaches an answer.
// - A 3-way HIGH/MEDIUM/LOW self-rating is nearly useless here — tested
//   against known-correct, known-wrong, and fully hallucinated answers, this
//   model picked "MEDIUM" every single time with >90% token probability
//   regardless of actual correctness (a "safe middle" degenerate response).
//   The binary YES/NO framing tested below actually discriminates: it
//   correctly flagged a wrong date and a hedged-but-correct answer, and
//   correctly passed a solid factual answer. It still isn't perfect (missed
//   one fully fabricated answer in testing) — this is a real but imperfect
//   filter, not fact-checking.
//
// Because reasoning length is prompt-dependent, this can run long: not
// awaited on the main response path (see the "background, not blocking"
// comment at each call site) — it always follows up asynchronously rather
// than holding up the turn the user is waiting on.
async function getConfidenceLabel({ model, question, answer }) {
  const prompt = `Question: ${question}\n\nProposed answer: ${answer}\n\nIs this proposed answer fully correct and complete? Reply with EXACTLY one word: YES or NO.`;
  const res = await httpFetch(`${OLLAMA_URL}/v1/chat/completions`, {
    timeoutMs: TIMEOUTS.LOCAL_LLM,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 400,
      logprobs: true,
      think: false
    })
  });
  if (!res.ok) throw new Error(`Confidence check failed: HTTP ${res.status}`);
  const data = await res.json();
  const choice = data.choices?.[0];
  const finalText = (choice?.message?.content || '').trim().toUpperCase();
  const tokens = choice?.logprobs?.content || [];

  // Reasoning ran past the token budget without reaching an answer — treat
  // as inconclusive rather than guessing. In practice this correlates with
  // genuinely hard/ambiguous questions, so escalating is the right default.
  if (!finalText || tokens.length === 0) {
    return { label: 'INCONCLUSIVE', probability: null, lowConfidence: true };
  }

  const label = finalText.includes('YES') ? 'YES' : finalText.includes('NO') ? 'NO' : 'INCONCLUSIVE';

  // Tail-align: walk backward from the end of the raw token stream,
  // decoding and concatenating until the accumulated text covers
  // `finalText` — isolates just the tokens that produced the actual
  // YES/NO answer, excluding the (often much longer) reasoning preamble
  // that precedes it, without depending on any specific channel-token
  // naming convention.
  let acc = '';
  const tailTokens = [];
  for (let i = tokens.length - 1; i >= 0; i--) {
    tailTokens.unshift(tokens[i]);
    acc = decodeToken(tokens[i]) + acc;
    if (acc.length >= finalText.length) break;
  }
  const avgLogprob = tailTokens.reduce((sum, t) => sum + t.logprob, 0) / tailTokens.length;
  const probability = Math.exp(avgLogprob);

  const lowConfidence = label !== 'YES' || probability < CONFIDENCE_PROBABILITY_THRESHOLD;
  return { label, probability, lowConfidence };
}

async function escalateToClaude({ question, localAnswer }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set in .env — Claude escalation is disabled.');

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });
  const prompt = localAnswer
    ? `A local AI assistant gave an answer that was flagged as low confidence. Review the user's question and the local assistant's proposed answer. If the proposed answer is incorrect, incomplete, or missing key context, provide the correct and complete response. If the proposed answer is accurate, refine it cleanly.\n\nUser Question: ${question}\n\nLocal Assistant's Proposed Answer:\n${localAnswer}`
    : `A local assistant wasn't confident in its answer to this question. Answer it directly and accurately, in a few sentences unless the question genuinely needs more.\n\nQuestion: ${question}`;

  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2500,
    messages: [{
      role: 'user',
      content: prompt
    }]
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude declined to answer this question.');
  }
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('Claude returned no text content.');
  return textBlock.text;
}

async function escalateToGemini({ question, localAnswer }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set in .env — Gemini fallback is disabled.');

  const prompt = localAnswer
    ? `A local AI assistant gave an answer that was flagged as low confidence. Review the user's question and the local assistant's proposed answer. If the proposed answer is incorrect, incomplete, or missing key context, provide the correct and complete response. If the proposed answer is accurate, refine it cleanly.\n\nUser Question: ${question}\n\nLocal Assistant's Proposed Answer:\n${localAnswer}`
    : `A local assistant wasn't confident in its answer to this question. Answer it directly and accurately, in a few sentences unless the question genuinely needs more.\n\nQuestion: ${question}`;

  const res = await httpFetch(geminiUrl(apiKey), {
    timeoutMs: TIMEOUTS.API,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }]
    })
  });

  if (!res.ok) {
    throw new Error(`Gemini API returned HTTP ${res.status}`);
  }
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini API returned empty response text.');
  return text;
}

// Checks the escalation cache for a near-duplicate question before calling
// Claude/Gemini; either way, persists the result so future similar questions get
// progressively cheaper.
async function getCachedOrEscalate({ question, localAnswer }) {
  const d = store.load();
  const escalations = d.claudeEscalations || [];
  const queryEmbedding = await getEmbedding(stripContextBoilerplate(question));

  if (queryEmbedding) {
    for (const entry of escalations) {
      if (!entry.embedding) continue;
      const ageDays = (Date.now() - new Date(entry.timestamp).getTime()) / 86400000;
      if (ageDays > CACHE_MAX_AGE_DAYS) continue;
      if (cosineSimilarity(queryEmbedding, entry.embedding) >= CACHE_SIMILARITY_THRESHOLD) {
        return { answer: entry.claudeAnswer, fromCache: true, provider: entry.provider || 'claude' };
      }
    }
  }

  let answer;
  let provider = 'claude';
  try {
    answer = await escalateToClaude({ question, localAnswer });
  } catch (err) {
    console.warn('[confidence:escalate] Claude API error/exhausted, falling back to Gemini:', err.message);
    try {
      answer = await escalateToGemini({ question, localAnswer });
      provider = 'gemini';
    } catch (geminiErr) {
      throw new Error(`Escalation failed on both Claude (${err.message}) and Gemini (${geminiErr.message})`);
    }
  }

  const entry = {
    timestamp: new Date().toISOString(),
    question,
    localAnswer: localAnswer || null,
    claudeAnswer: answer,
    provider,
    embedding: queryEmbedding || null
  };

  // Permanently archive to append-only JSONL training file before ring-buffer truncation
  try {
    if (!fs.existsSync(TRAINING_DIR)) fs.mkdirSync(TRAINING_DIR, { recursive: true });
    const archiveRecord = {
      timestamp: entry.timestamp,
      question: entry.question,
      cleanQuestion: stripContextBoilerplate(entry.question),
      localAnswer: entry.localAnswer,
      claudeAnswer: entry.claudeAnswer,
      provider: entry.provider
    };
    fs.appendFileSync(ESCALATION_ARCHIVE_FILE, JSON.stringify(archiveRecord) + '\n', 'utf8');
  } catch (err) {
    console.warn('[confidence:archive] Warning logging to escalation archive:', err.message);
  }

  const dd = store.load();
  dd.claudeEscalations = [...(dd.claudeEscalations || []), entry].slice(-MAX_ESCALATIONS_STORED);
  store.save(dd);

  return { answer, fromCache: false, provider };
}

// Combined entry point for callers that don't need to render a UI state
// between the confidence check and the escalation (the mobile/API server —
// desktop calls getConfidenceLabel and getCachedOrEscalate separately so it
// can show a "checking with Claude..." message only when actually escalating).
async function checkConfidenceAndMaybeEscalate({ model, question, localAnswer }) {
  const confidence = await getConfidenceLabel({ model, question, answer: localAnswer });
  if (!confidence.lowConfidence) {
    return { escalated: false, answer: localAnswer, confidence };
  }
  const { answer, fromCache } = await getCachedOrEscalate({ question, localAnswer });
  return { escalated: true, fromCache, answer, confidence };
}

function getEscalationStats() {
  const d = store.load();
  const escalations = d.claudeEscalations || [];
  const claudeCount = escalations.filter((e) => (e.provider || 'claude') === 'claude').length;
  const geminiCount = escalations.filter((e) => e.provider === 'gemini').length;
  return {
    count: escalations.length,
    claudeCount,
    geminiCount,
    lastAt: escalations.length ? escalations[escalations.length - 1].timestamp : null
  };
}

function evictEscalation(identifier) {
  const d = store.load();
  const before = (d.claudeEscalations || []).length;
  d.claudeEscalations = (d.claudeEscalations || []).filter((e) => {
    return e.id !== identifier && e.timestamp !== identifier && e.question !== identifier;
  });
  store.save(d);
  return { success: true, evicted: before - d.claudeEscalations.length };
}

module.exports = {
  getConfidenceLabel,
  escalateToClaude,
  getCachedOrEscalate,
  checkConfidenceAndMaybeEscalate,
  getEscalationStats,
  evictEscalation,
  stripContextBoilerplate,
  getEmbedding,
  cosineSimilarity
};
