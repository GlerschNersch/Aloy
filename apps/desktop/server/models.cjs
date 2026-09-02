// Single source of truth for every AI model this app talks to.
//
// Why this exists: model IDs were hardcoded across seven files — five copies of
// the Claude ID, and Gemini split between 'gemini-2.5-flash' (6 sites) and
// 'gemini-3.6-flash' (2 sites). That split is exactly the failure mode that bit
// this codebase before: a model ID nobody verified, in a path that fails
// silently. The Gemini *verification* pass is the second half of the
// "Claude and Gemini must independently agree" gate that promotes escalations
// into learned knowledge — if its model ID is wrong, verification silently
// fails and the gate degrades to "Claude said so", with no error anywhere.
//
// Follow-up (2026-08-24): both Gemini IDs were checked live against
// ai.google.dev and BOTH are valid and current — 3.6-flash was never a bad ID,
// just an undocumented one. Collapsing the verifier onto MODELS.GEMINI
// therefore fixed the drift but also silently downgraded the model guarding
// the knowledge store. GEMINI_VERIFIER below restores that choice and makes it
// explicit, so the two can move independently instead of by accident.
//
// Every ID is overridable by env var so a bad default can be corrected without
// a code change, and upgrading is a one-line edit instead of a seven-file hunt.

const MODELS = {
  // ── Cloud: the "teacher" tier ──────────────────────────────────────────
  // Used for confidence escalation, research, document proofreading, Athena
  // dossier synthesis, and the Hephaestus code-review gate. These are the two
  // places model quality matters most: what the local model learns from, and
  // what approves code that gets deployed automatically.
  CLAUDE: process.env.ALOY_CLAUDE_MODEL || 'claude-sonnet-5',

  // Second opinion / fallback when Claude is unavailable. Used with the
  // generateContent REST surface (see geminiUrl below).
  GEMINI: process.env.ALOY_GEMINI_MODEL || 'gemini-2.5-flash',

  // The independent verifier in the nightly auto-teaching gate. Deliberately
  // NOT the same constant as GEMINI: geminiVerification.cjs calls the
  // Interactions API (ai.interactions.create) with google_search grounding,
  // not generateContent, and wants a model with real search behind it. Keeping
  // it separate means changing the general fallback cannot quietly change what
  // decides which knowledge is true enough to write down permanently.
  GEMINI_VERIFIER: process.env.ALOY_GEMINI_VERIFIER_MODEL || 'gemini-3.6-flash',

  // ── Local: Ollama ──────────────────────────────────────────────────────
  GENERAL: process.env.ALOY_GENERAL_MODEL || 'aloy-assistant',
  // 7b, not 14b: llmfit scored 14b as only "Good" fit on this machine's 12GB
  // RTX 4070 SUPER (VRAM headroom shared with Whisper STT on the same card),
  // vs. "Perfect" fit for 7b — same model family, real speed/headroom win.
  // Switched 2026-08-23; see DECISIONS.md.
  CODER: process.env.ALOY_CODER_MODEL || 'qwen2.5-coder:7b',
  VISION: process.env.ALOY_VISION_MODEL || 'qwen2.5-vl:7b',
  MULTIMODAL: process.env.ALOY_MULTIMODAL_MODEL || 'gemma4:12b',
  EMBEDDING: process.env.ALOY_EMBEDDING_MODEL || 'nomic-embed-text'
};

// Convenience for building Gemini REST URLs, so the model ID can't drift
// between the constant and a hand-built URL string (which is how the
// 2.5 / 3.6 split happened in the first place).
function geminiUrl(apiKey, model = MODELS.GEMINI, method = 'generateContent') {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:${method}?key=${apiKey}`;
}

/**
 * Verifies each configured cloud model actually exists on the account.
 *
 * A wrong model ID surfaces as a 404 buried inside a catch block, so the
 * feature just quietly stops working — precisely what happened with an earlier
 * `claude-opus-5` typo in the escalation path. Call this from a health check to
 * make it loud instead.
 *
 * Checks all three cloud IDs. GEMINI and GEMINI_VERIFIER can legitimately
 * differ, and the verifier is the one whose failure is completely silent, so
 * it needs its own check rather than being assumed to match.
 */
async function verifyCloudModels({ fetchImpl = globalThis.fetch } = {}) {
  const result = { claude: null, gemini: null, geminiVerifier: null };

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const res = await fetchImpl(`https://api.anthropic.com/v1/models/${MODELS.CLAUDE}`, {
        headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
        signal: AbortSignal.timeout(5000)
      });
      result.claude = { model: MODELS.CLAUDE, ok: res.ok, status: res.status,
        error: res.ok ? null : (res.status === 404 ? 'model does not exist on this account' : `HTTP ${res.status}`) };
    } catch (err) {
      result.claude = { model: MODELS.CLAUDE, ok: false, error: err.message };
    }
  } else {
    result.claude = { model: MODELS.CLAUDE, ok: false, error: 'ANTHROPIC_API_KEY not set' };
  }

  const checkGemini = async (modelId) => {
    if (!process.env.GEMINI_API_KEY) {
      return { model: modelId, ok: false, error: 'GEMINI_API_KEY not set' };
    }
    try {
      const res = await fetchImpl(
        `https://generativelanguage.googleapis.com/v1beta/models/${modelId}?key=${process.env.GEMINI_API_KEY}`,
        { signal: AbortSignal.timeout(5000) }
      );
      return { model: modelId, ok: res.ok, status: res.status,
        error: res.ok ? null : (res.status === 404 ? 'model does not exist on this account' : `HTTP ${res.status}`) };
    } catch (err) {
      return { model: modelId, ok: false, error: err.message };
    }
  };

  result.gemini = await checkGemini(MODELS.GEMINI);
  result.geminiVerifier = MODELS.GEMINI_VERIFIER === MODELS.GEMINI
    ? { ...result.gemini }
    : await checkGemini(MODELS.GEMINI_VERIFIER);

  result.allValid = Boolean(result.claude?.ok && result.gemini?.ok && result.geminiVerifier?.ok);
  return result;
}

module.exports = { MODELS, geminiUrl, verifyCloudModels };
