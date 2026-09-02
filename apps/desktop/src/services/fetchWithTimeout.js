// Shared fetch wrapper so a slow/unreachable local server (Ollama, HA, the
// vision/TTS/monitor sidecar servers, etc.) can't hang a request — and by
// extension the UI waiting on it — forever. Aborts and throws a clear error
// once timeoutMs elapses instead of leaving the promise pending indefinitely.
// NOTE ON STREAMING: the timer is cleared in `finally`, which runs as soon as
// fetch() resolves — i.e. when response HEADERS arrive, not when the body
// finishes. So timeoutMs bounds connect + time-to-first-byte, and a streaming
// body may then run as long as it likes. That is deliberate: a token stream
// has no meaningful total duration, but a server that never answers at all
// still needs to fail.
export async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  // Compose with any caller-supplied signal rather than replacing it. Streaming
  // turns pass their own signal for barge-in / stop-generation, and overwriting
  // it here would silently disable cancellation — the request would keep
  // running with the user's stop button wired to nothing.
  let signal = controller.signal;
  if (options.signal) {
    signal = typeof AbortSignal.any === 'function'
      ? AbortSignal.any([options.signal, controller.signal])
      : options.signal;
  }

  try {
    return await fetch(url, { ...options, signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      // Distinguish "the user cancelled" from "the server never answered";
      // callers treat these very differently.
      if (options.signal?.aborted) throw err;
      throw new Error(`Request to ${url} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
