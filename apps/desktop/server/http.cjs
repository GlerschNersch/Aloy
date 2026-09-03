// The ONLY sanctioned way this codebase talks to the network.
//
// Why this module exists: on 2026-08-19 seven Athena research tasks were found
// wedged at 25% — some for two days. Root cause was a raw https.get whose
// `timeout:` option armed the socket's idle timer but had no 'timeout' handler,
// so Node never aborted the request. Neither 'end' nor 'error' fired, the
// promise never settled, and the task awaited forever. A scan then found 18
// more fetch() calls across the server with no timeout or abort signal at all —
// every one a two-day outage waiting to happen, including in the confidence
// escalation pipeline and the Hephaestus code-review gate.
//
// Two deliberate design choices:
//
//  1. The timeout is a DEFAULT PARAMETER, not an option someone remembers to
//     pass. You cannot call these helpers without a deadline; you can only
//     change how long it is.
//
//  2. These functions RETURN errors, they do not throw. Nearly every existing
//     call site wraps network calls in try/catch that logs to console.warn and
//     continues — which is precisely how a two-day outage stayed invisible.
//     A returned { ok:false, error } forces the caller to look at the result.
//
// Enforced by scripts/smoke.cjs, which fails the build on any bare fetch(),
// https.get(, or http.get( outside this file.

const DEFAULT_TIMEOUT_MS = 10000;

// Home Assistant (and similar LAN-only appliances) commonly run behind a
// self-signed or private-CA certificate — there's no public CA to validate
// against, and the alternative is walking the user through importing a
// private root cert into Node's trust store. This dispatcher is opt-in per
// call site (pass it as `dispatcher` — never the default) and named for
// exactly what it is: a deliberate trust reduction. Only pass it to a
// user-configured LAN host you already hold a bearer token for, never to an
// arbitrary/external URL.
let insecureLanDispatcher = null;
function getInsecureLanDispatcher() {
  if (!insecureLanDispatcher) {
    const { Agent } = require('undici');
    insecureLanDispatcher = new Agent({ connect: { rejectUnauthorized: false } });
  }
  return insecureLanDispatcher;
}

// Named timeouts, so call sites declare intent instead of a magic number.
// These differ by an order of magnitude and getting them wrong is its own
// outage: a 10s deadline on a local LLM generation would abort every long
// answer, while a 120s deadline on a health probe would stall a health sweep.
const TIMEOUTS = {
  PROBE: 3000,        // liveness checks — must not stall a health sweep
  WEBHOOK: 10000,     // fire-and-forget notifications
  API: 60000,         // hosted model APIs (Anthropic, Gemini)
  LOCAL_LLM: 180000,  // local Ollama generation; genuinely slow, but not infinite
  EMBEDDING: 30000    // local embeddings; fast, but not instant under load
};

/**
 * Drop-in replacement for global fetch() with a mandatory deadline.
 *
 * Returns the real Response and throws on abort exactly like fetch does, so
 * migrating a call site is a one-word change — every existing `if (!res.ok)`
 * and `await res.json()` downstream keeps working, and existing catch blocks
 * that already handle network errors now also handle timeouts.
 *
 * An explicitly supplied `signal` wins, so callers that already manage their
 * own AbortController are unaffected.
 */
async function httpFetch(url, { timeoutMs = DEFAULT_TIMEOUT_MS, ...opts } = {}) {
  if (opts.signal) return fetch(url, opts);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Core fetch wrapper with a mandatory deadline.
 * @returns {Promise<{ok:boolean,status:number,res?:Response,error?:string,timedOut?:boolean}>}
 */
async function httpRequest(url, { timeoutMs = DEFAULT_TIMEOUT_MS, ...opts } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  // unref so a pending request never keeps the process alive at shutdown.
  timer.unref?.();
  const startedAt = Date.now();
  try {
    const res = await fetch(url, { ...opts, signal: controller.signal });
    return { ok: res.ok, status: res.status, res, durationMs: Date.now() - startedAt };
  } catch (err) {
    const timedOut = err?.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      timedOut,
      error: timedOut ? `timeout after ${timeoutMs}ms` : (err?.message || String(err)),
      durationMs: Date.now() - startedAt
    };
  } finally {
    clearTimeout(timer);
  }
}

/** GET/POST returning parsed JSON. `data` is null unless the call succeeded. */
async function httpJson(url, opts = {}) {
  const r = await httpRequest(url, opts);
  if (!r.ok) return { ok: false, status: r.status, error: r.error, timedOut: r.timedOut, data: null };
  try {
    return { ok: true, status: r.status, data: await r.res.json(), durationMs: r.durationMs };
  } catch (err) {
    return { ok: false, status: r.status, error: `invalid JSON: ${err.message}`, data: null };
  }
}

/** Returns response body as text, capped so a huge page can't exhaust memory. */
async function httpText(url, { maxBytes = 200000, ...opts } = {}) {
  const r = await httpRequest(url, opts);
  if (!r.ok) return { ok: false, status: r.status, error: r.error, timedOut: r.timedOut, text: '' };
  try {
    const text = await r.res.text();
    return { ok: true, status: r.status, text: text.slice(0, maxBytes), truncated: text.length > maxBytes };
  } catch (err) {
    return { ok: false, status: r.status, error: err.message, text: '' };
  }
}

/** Convenience: JSON POST. */
function postJson(url, body, opts = {}) {
  return httpJson(url, {
    ...opts,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    body: JSON.stringify(body)
  });
}

/**
 * Liveness probe — is something answering at this URL? Never throws, short
 * default deadline. For health scans, where a slow probe shouldn't stall the
 * whole sweep.
 */
async function probe(url, { timeoutMs = 2500, ...opts } = {}) {
  const r = await httpRequest(url, { timeoutMs, ...opts });
  return {
    status: r.ok ? 'online' : (r.timedOut ? 'offline' : (r.status ? 'degraded' : 'offline')),
    code: r.status || null,
    error: r.error || null,
    durationMs: r.durationMs
  };
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  TIMEOUTS,
  httpFetch,
  httpRequest,
  httpJson,
  httpText,
  postJson,
  probe,
  getInsecureLanDispatcher
};
