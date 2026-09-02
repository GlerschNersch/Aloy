// 100% Local faster-whisper Speech-to-Text Service
import { sidecarAuthHeaders } from './sidecarAuth.js';

const WHISPER_SERVER_URL = 'http://127.0.0.1:8890';

export async function checkWhisperStatus() {
  try {
    const r = await fetch(`${WHISPER_SERVER_URL}/health`, {
      method: 'GET',
      headers: await sidecarAuthHeaders(),
      signal: AbortSignal.timeout(3000)
    });
    return r.ok;
  } catch {
    return false;
  }
}

export async function transcribeAudio(audioBlob) {
  const formData = new FormData();
  formData.append('audio', audioBlob, 'recording.webm');

  // Without this, a hang here is invisible and permanent — the mic button
  // spins forever with no error, no way to recover except reloading the
  // app. Confirmed live 2026-08-03: whisper_server.py loads its model on
  // CUDA and runs actual GPU inference in /transcribe (unlike /health,
  // which does no GPU work and always responds instantly) — if Ollama is
  // also actively using the GPU at the same time, real transcription can
  // hang under that contention even though the server itself is healthy.
  // 45s is generous for CPU-contended transcription of a short clip; a
  // genuine hang should trip this well before the user assumes it's just
  // slow.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);

  let res;
  try {
    res = await fetch(`${WHISPER_SERVER_URL}/transcribe`, {
      method: 'POST',
      body: formData,
      headers: await sidecarAuthHeaders(),
      signal: controller.signal
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Whisper transcription timed out after 45s — it may be GPU-contended with Ollama, or the server needs a restart.');
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) throw new Error(`Whisper HTTP status ${res.status}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.text || '';
}

/**
 * Requests an audio media stream, prioritizing an active webcam/Logitech microphone
 * if present, or falling back to the system default input.
 */
export async function getPreferredAudioStream() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Media devices API is unavailable in this environment.');
  }

  // 1. Initial request to ensure browser/Electron unmasks device labels
  let initialStream = null;
  try {
    initialStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    console.warn('Initial microphone permission request failed:', err);
  }

  try {
    if (navigator.mediaDevices.enumerateDevices) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const audioInputs = devices.filter((d) => d.kind === 'audioinput');
      console.log('[voice-devices] Available audio inputs:', audioInputs.map(d => ({ id: d.deviceId, label: d.label })));

      // Find webcam or dedicated room microphone if present
      const webcamMic = audioInputs.find((d) =>
        /\b(webcam|c930|logitech|camera|conference|desk)\b/i.test(d.label || '')
      );

      if (webcamMic && webcamMic.deviceId) {
        console.log('[voice-devices] Binding directly to webcam mic:', webcamMic.label);
        // Release initial stream before opening specific webcam mic stream
        if (initialStream) {
          initialStream.getTracks().forEach((t) => t.stop());
        }
        return await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: webcamMic.deviceId },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: true
          }
        });
      }
    }
  } catch (err) {
    console.warn('Device enumeration failed, falling back to standard audio capture:', err);
  }

  // If initial stream is valid and no webcam was specifically found, reuse it
  if (initialStream && initialStream.active) {
    return initialStream;
  }

  // Fallback to default system microphone
  return await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true
    }
  });
}

/**
 * Monitors an active audio stream for speech followed by natural silence,
 * automatically triggering onSilenceDetected when speech completes.
 */
// silenceTimeoutMs was 2200 — a flat 2.2 second wait on EVERY turn before we
// even begin transcribing, which is dead air the user experiences as the
// assistant being slow to think. 800ms is comfortably past a natural
// mid-sentence pause while cutting 1.4s from every single exchange, and the
// minSpeechMs guard below still prevents a cough or a door closing from
// triggering a cutoff. initialGraceMs likewise drops from 3000 to 1500: it
// only needs to cover the moment between the mic opening and the user starting
// to speak, not three full seconds.
export function attachSilenceDetector(stream, onSilenceDetected, { silenceTimeoutMs = 800, minSpeechMs = 700, initialGraceMs = 1500, maxRecordMs = 30000 } = {}) {
  if (typeof window === 'undefined') return () => {};
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return () => {};

  try {
    const audioContext = new AudioCtx();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.2;
    source.connect(analyser);

    const buffer = new Uint8Array(analyser.frequencyBinCount);
    const startTimestamp = Date.now();
    let totalSpeechDurationMs = 0;
    let lastSpokeTime = null;
    let isStopped = false;
    let intervalId = null;

    const checkVolume = () => {
      if (isStopped) return;
      analyser.getByteFrequencyData(buffer);

      let sum = 0;
      for (let i = 0; i < buffer.length; i++) {
        sum += buffer[i];
      }
      const average = sum / buffer.length;

      // Threshold for active human voice above ambient room noise
      const isSpeaking = average > 14;
      const now = Date.now();

      if (isSpeaking) {
        totalSpeechDurationMs += 100;
        lastSpokeTime = now;
      } else {
        // Enforce initial grace period before allowing silence cutoff
        const elapsedSinceStart = now - startTimestamp;
        if (elapsedSinceStart > initialGraceMs && lastSpokeTime) {
          const silenceDuration = now - lastSpokeTime;
          // Trigger stop only if the user actually spoke for minSpeechMs and then stayed silent for silenceTimeoutMs
          if (totalSpeechDurationMs >= minSpeechMs && silenceDuration >= silenceTimeoutMs) {
            isStopped = true;
            clearInterval(intervalId);
            try { audioContext.close(); } catch {}
            console.log(`[voice-vad] Natural silence detected after ${totalSpeechDurationMs}ms speech. Stopping recording.`);
            onSilenceDetected();
            return;
          }
        }
      }

      // Safety timeout: auto-stop if recording reaches maxRecordMs
      if (now - startTimestamp >= maxRecordMs) {
        isStopped = true;
        clearInterval(intervalId);
        try { audioContext.close(); } catch {}
        console.log('[voice-vad] Max recording duration reached.');
        onSilenceDetected();
      }
    };

    intervalId = setInterval(checkVolume, 100);

    return () => {
      isStopped = true;
      clearInterval(intervalId);
      try { audioContext.close(); } catch {}
    };
  } catch (err) {
    console.warn('Could not attach silence detector:', err);
    return () => {};
  }
}

/**
 * Monitors an audio stream and fires onSpeechStart the moment SUSTAINED
 * voice-level audio is detected (as opposed to attachSilenceDetector, which
 * fires on a full speech-then-silence cycle) — used for barge-in: cutting
 * off TTS playback the instant the user starts talking over it, not waiting
 * for them to finish. Requires sustainedMs of continuous above-threshold
 * audio before firing (avoids single-word/click/cough false positives), and
 * fires at most once per attach (caller re-attaches for the next utterance).
 */
export function attachSpeechStartDetector(stream, onSpeechStart, { threshold = 16, sustainedMs = 250, checkIntervalMs = 100 } = {}) {
  if (typeof window === 'undefined') return () => {};
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return () => {};

  try {
    const audioContext = new AudioCtx();
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.2;
    source.connect(analyser);

    const buffer = new Uint8Array(analyser.frequencyBinCount);
    let aboveThresholdMs = 0;
    let isStopped = false;
    let intervalId = null;

    const checkVolume = () => {
      if (isStopped) return;
      analyser.getByteFrequencyData(buffer);

      let sum = 0;
      for (let i = 0; i < buffer.length; i++) sum += buffer[i];
      const average = sum / buffer.length;

      if (average > threshold) {
        aboveThresholdMs += checkIntervalMs;
        if (aboveThresholdMs >= sustainedMs) {
          isStopped = true;
          clearInterval(intervalId);
          try { audioContext.close(); } catch {}
          onSpeechStart();
        }
      } else {
        aboveThresholdMs = 0;
      }
    };

    intervalId = setInterval(checkVolume, checkIntervalMs);

    return () => {
      isStopped = true;
      clearInterval(intervalId);
      try { audioContext.close(); } catch {}
    };
  } catch (err) {
    console.warn('Could not attach speech-start detector:', err);
    return () => {};
  }
}
