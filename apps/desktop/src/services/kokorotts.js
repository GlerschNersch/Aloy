// 100% Local Kokoro-82M Studio Neural Voice Service
import { fetchWithTimeout } from './fetchWithTimeout.js';
import { sidecarAuthHeaders } from './sidecarAuth.js';
import { connectAudioElement } from './speechVisualizer.js';

const KOKORO_SERVER_URL = 'http://localhost:8888';

export async function checkKokoroStatus() {
  try {
    const r = await fetchWithTimeout(`${KOKORO_SERVER_URL}/voices`, { method: 'GET', headers: await sidecarAuthHeaders() }, 5000);
    if (r.ok) {
      const voices = await r.json();
      return { isOnline: true, voices };
    }
  } catch {
    // Offline
  }
  return { isOnline: false, voices: [] };
}

let currentAudio = null;

export async function speakKokoroAudio(text, voice = 'af_sarah', speed = 1.0) {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }

  try {
    const res = await fetchWithTimeout(`${KOKORO_SERVER_URL}/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await sidecarAuthHeaders()) },
      body: JSON.stringify({ text, voice, speed })
    }, 30000);

    if (!res.ok) throw new Error(`Kokoro HTTP status ${res.status}`);

    const blob = await res.blob();
    const audioUrl = URL.createObjectURL(blob);
    currentAudio = new Audio(audioUrl);
    connectAudioElement(currentAudio);

    return new Promise((resolve) => {
      currentAudio.onended = () => {
        currentAudio = null;
        resolve();
      };
      currentAudio.onerror = () => {
        currentAudio = null;
        resolve();
      };
      currentAudio.play();
    });
  } catch (err) {
    console.error('Kokoro TTS Speech error:', err);
  }
}

export function stopKokoroAudio() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STREAMING SPEECH
//
// The latency problem this solves: speakKokoroAudio() above waits for the model
// to finish writing the ENTIRE response, then synthesizes the ENTIRE response,
// then starts playing. For a 200-word answer that is ~8 seconds of silence
// before the first sound — which is the single biggest reason a local
// assistant feels like a terminal instead of a presence.
//
// createSpeechStream() overlaps the three stages instead. Tokens arrive → the
// moment a full sentence exists it is sent to Kokoro → playback of sentence 1
// starts while the model is still writing sentence 2, and sentence 2 is
// synthesized while sentence 1 is still playing. Perceived latency collapses
// from "generate everything + synthesize everything" to "first sentence +
// its synthesis", roughly 8s → 1.5s, with no model or hardware change.
//
// Usage:
//   const speech = createSpeechStream({ voice: 'af_sarah' });
//   streamChat({ ... onChunk: (t) => speech.push(t), onComplete: () => speech.end() });
//   speech.cancel();   // barge-in: stop immediately, drop the queue

// Flush on a sentence ending, or on a clause break once the buffer is long
// enough that waiting for a period would be a noticeable pause. The first
// flush uses a shorter threshold — getting ANY audio out fast matters far more
// than the phrasing of the opening clause.
const FIRST_FLUSH_MIN_CHARS = 12;
const CLAUSE_FLUSH_MIN_CHARS = 140;
// No sentence end and no clause break by this length means a run-on; flush at a
// word boundary rather than letting the listener wait indefinitely.
const HARD_FLUSH_MAX_CHARS = 220;

function findFlushPoint(buffer, isFirst) {
  const minChars = isFirst ? FIRST_FLUSH_MIN_CHARS : 0;

  // Take the FIRST sentence end past the minimum, not the last — the whole
  // point is to start speaking as early as possible. (Taking the last match
  // batched several sentences into one chunk and reintroduced the delay this
  // is meant to remove.) The trailing \s requirement avoids splitting inside
  // "3.5" or "Dr. Who".
  const sentenceEnd = /[.!?]["')\]]?\s/g;
  let match;
  while ((match = sentenceEnd.exec(buffer)) !== null) {
    const cut = match.index + match[0].length;
    if (cut >= minChars) return cut;
  }

  // No sentence end yet — break on a clause boundary once long enough that
  // waiting for a period would be an audible stall.
  if (buffer.length >= CLAUSE_FLUSH_MIN_CHARS) {
    const clause = Math.max(buffer.lastIndexOf(', '), buffer.lastIndexOf('; '), buffer.lastIndexOf(' — '));
    if (clause > CLAUSE_FLUSH_MIN_CHARS / 2) return clause + 2;
  }

  // Still nothing (a long run-on with no punctuation) — cut at a word boundary.
  if (buffer.length >= HARD_FLUSH_MAX_CHARS) {
    const space = buffer.lastIndexOf(' ', HARD_FLUSH_MAX_CHARS);
    if (space > 0) return space + 1;
  }

  return -1;
}

// Strip things that should never be read aloud. The model emits markdown for
// the on-screen transcript; spoken output should not say "asterisk asterisk".
function cleanForSpeech(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' — code block omitted — ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function synthesize(text, voice, speed, signal) {
  const res = await fetchWithTimeout(`${KOKORO_SERVER_URL}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await sidecarAuthHeaders()) },
    body: JSON.stringify({ text, voice, speed }),
    signal
  }, 30000);
  if (!res.ok) throw new Error(`Kokoro HTTP ${res.status}`);
  return URL.createObjectURL(await res.blob());
}

export function createSpeechStream({ voice = 'af_sarah', speed = 1.0, onFirstAudio = null } = {}) {
  let buffer = '';
  let isFirst = true;
  let cancelled = false;
  let ended = false;
  let firstAudioAt = null;
  const startedAt = Date.now();

  // Synthesis runs ahead of playback: chunk N+1 is being generated while
  // chunk N is still audible, so there is no gap between sentences.
  const pending = [];      // in-flight synthesis promises, in order
  let playChain = Promise.resolve();
  let activeAudio = null;
  const controller = new AbortController();

  function enqueue(rawText) {
    const text = cleanForSpeech(rawText);
    if (!text || cancelled) return;
    const job = synthesize(text, voice, speed, controller.signal).catch(() => null);
    pending.push(job);
    playChain = playChain.then(async () => {
      if (cancelled) return;
      const url = await job;
      if (!url || cancelled) return;
      await new Promise((resolve) => {
        const audio = new Audio(url);
        connectAudioElement(audio);
        activeAudio = audio;
        const done = () => { URL.revokeObjectURL(url); activeAudio = null; resolve(); };
        audio.onended = done;
        audio.onerror = done;
        if (!firstAudioAt) {
          firstAudioAt = Date.now();
          if (onFirstAudio) { try { onFirstAudio(firstAudioAt - startedAt); } catch {} }
        }
        audio.play().catch(done);
      });
    });
  }

  return {
    /** Feed streamed model tokens in as they arrive. */
    push(token) {
      if (cancelled || ended) return;
      buffer += token;
      let cut;
      while ((cut = findFlushPoint(buffer, isFirst)) > 0) {
        enqueue(buffer.slice(0, cut));
        buffer = buffer.slice(cut);
        isFirst = false;
      }
    },
    /** Model finished — speak whatever is left, then resolve when audio ends. */
    async end() {
      if (cancelled) return;
      ended = true;
      if (buffer.trim()) { enqueue(buffer); buffer = ''; }
      await playChain;
    },
    /** Barge-in: stop instantly and abandon everything queued. */
    cancel() {
      cancelled = true;
      try { controller.abort(); } catch {}
      if (activeAudio) { activeAudio.pause(); activeAudio = null; }
      buffer = '';
    },
    get msToFirstAudio() { return firstAudioAt ? firstAudioAt - startedAt : null; },
    get isCancelled() { return cancelled; }
  };
}
