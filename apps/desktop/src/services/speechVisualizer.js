// Real audio-amplitude tap for a "when Aloy speaks" visual — not a scripted
// pulse animation, an actual read of the Kokoro TTS audio as it plays.
//
// Both TTS playback paths in kokorotts.js (speakKokoroAudio's single-shot
// currentAudio, and createSpeechStream's per-sentence activeAudio) create a
// plain HTMLAudioElement per utterance. connectAudioElement() taps each one
// into a single shared AnalyserNode via createMediaElementSource — audio
// still plays through the normal element→destination path unchanged, the
// analyser just listens in. getAmplitude() gives any UI a 0–1 read of
// current loudness; when nothing is playing it naturally reads ~0, so
// there's no separate "isSpeaking" flag to keep in sync — silence IS the
// at-rest state.

let audioCtx = null;
let analyser = null;
let dataArray = null;
// createMediaElementSource throws if called twice on the same element —
// track which elements are already wired so a caller can safely call
// connectAudioElement on an element it isn't sure was already connected.
const connectedElements = new WeakSet();

function ensureContext() {
  if (audioCtx) return;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return; // no Web Audio support — amplitude reads stay 0, visual stays at rest
  audioCtx = new Ctx();
  analyser = audioCtx.createAnalyser();
  // Small FFT: this drives a glow/scale, not a spectrum display — coarse
  // amplitude is all that's needed, and it's cheaper per frame.
  analyser.fftSize = 64;
  analyser.smoothingTimeConstant = 0.6;
  dataArray = new Uint8Array(analyser.frequencyBinCount);
}

/**
 * Wires a freshly-created <audio> element into the shared analyser. Safe to
 * call on every new Audio() instance kokorotts.js creates — connecting the
 * same element twice is a no-op, and a browser without Web Audio support
 * just silently skips this (amplitude stays 0, no visual, no error).
 */
export function connectAudioElement(audioEl) {
  if (!audioEl || connectedElements.has(audioEl)) return;
  try {
    ensureContext();
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    const source = audioCtx.createMediaElementSource(audioEl);
    source.connect(analyser);
    analyser.connect(audioCtx.destination);
    connectedElements.add(audioEl);
  } catch {
    // Any failure here (e.g. element already routed elsewhere) just means
    // no visual for this utterance — never let it affect actual playback.
  }
}

/**
 * Current loudness, 0 (silence) to 1 (loud). Cheap enough to call from a
 * requestAnimationFrame loop.
 */
export function getAmplitude() {
  if (!analyser || !dataArray) return 0;
  analyser.getByteTimeDomainData(dataArray);
  let sumSquares = 0;
  for (let i = 0; i < dataArray.length; i++) {
    const centered = (dataArray[i] - 128) / 128; // -1..1
    sumSquares += centered * centered;
  }
  const rms = Math.sqrt(sumSquares / dataArray.length); // 0..~1
  return Math.min(1, rms * 4); // typical speech RMS is well under 1 — scale up so it's actually visible
}
