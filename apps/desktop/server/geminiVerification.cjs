// Independent second-opinion check for Claude's researched summaries, using
// Gemini's own web search rather than trusting Claude's citations blindly —
// this is what actually would have caught the earlier "unverified general
// knowledge" Roku entry (Claude's search budget ran out mid-research but the
// draft still got saved). Uses the current (2026-08) Interactions API
// surface (`ai.interactions.create`), not the older `generateContent` —
// confirmed live against ai.google.dev docs, not assumed from training data.
// Was hardcoded to 'gemini-3.6-flash' while six other call sites used
// 'gemini-2.5-flash'. Both IDs were then checked live against ai.google.dev
// (2026-08-24) and both are valid — so 3.6 was never a broken ID, and
// collapsing this onto MODELS.GEMINI removed the drift but also downgraded the
// model guarding the knowledge store. MODELS.GEMINI_VERIFIER restores 3.6 as
// an explicit, separately-overridable choice: this path uses the Interactions
// API with google_search grounding rather than generateContent, so it should
// not silently follow whatever the general fallback happens to be.
const { MODELS, geminiUrl } = require('./models.cjs');
const GEMINI_MODEL = MODELS.GEMINI_VERIFIER;

const VERIFY_PROMPT = (topic, summary) => `Independently verify the accuracy of this research summary using your own real web search — do not just trust it at face value.

Topic: ${topic}

Summary to verify:
${summary}

Search for this topic yourself, then compare what you find against the summary above. End your response with EXACTLY one line, verbatim: "VERDICT: CONFIRMED" if your own research substantially confirms the summary as accurate, or "VERDICT: UNCERTAIN" if you find contradictions, can't verify the key claims, or the summary itself is hedged/ungrounded (e.g. explicitly says it couldn't complete real research).`;

const MAX_ATTEMPTS = 3;

async function verifyWithGemini({ topic, summary }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set in .env — Gemini verification is disabled.');

  const { GoogleGenAI } = require('@google/genai');
  const ai = new GoogleGenAI({ apiKey });
  const input = VERIFY_PROMPT(topic, summary);

  // Root-caused 2026-08-04 via isolated testing (not assumed): the generic
  // "400 Request contains an invalid argument" traced to a SECOND, more
  // specific error on retry — "Model generated invalid JSON syntax and the
  // output could not be parsed. Please retry the request." The Interactions
  // API is internally JSON-structured, and Gemini occasionally produces
  // malformed output for this longer, instruction-heavy verify prompt. This
  // is a transient generation failure the error message itself says to
  // retry — NOT a permanent rejection of the input content (confirmed: the
  // exact same real Claude-generated text succeeded standalone with a
  // shorter prompt, and failed only with the full verify wrapper). Retrying
  // the identical request is therefore the correct fix, not falling back to
  // a different/simplified shape.
  let lastErr;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const interaction = await ai.interactions.create({ model: GEMINI_MODEL, input, tools: [{ type: 'google_search' }] });
      const text = interaction.output_text || '';
      const confident = /VERDICT:\s*CONFIRMED/i.test(text);
      const notes = text.replace(/VERDICT:\s*(CONFIRMED|UNCERTAIN)\s*$/i, '').trim();
      return { confident, notes: notes.slice(0, 1000) };
    } catch (err) {
      lastErr = err;
      if (err?.status !== 400 || attempt === MAX_ATTEMPTS) break;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  throw lastErr;
}

module.exports = { verifyWithGemini, GEMINI_MODEL };
