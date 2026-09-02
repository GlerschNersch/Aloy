// Ambient Physical Observer Service
// Connects Logitech C930e webcam frames, Face Recognition presence, and Local VLM
// to generate real-time physical observations and Kokoro TTS spoken commentary.

import { speakKokoroAudio } from './kokorotts.js';
import { fetchWithTimeout } from './fetchWithTimeout.js';

// These three calls use stream: false, so Ollama withholds response headers
// until the whole generation is done — the timeout has to cover full inference
// on a vision model, not just connect. 180s matches TIMEOUTS.LOCAL_LLM on the
// server side.
const VLM_TIMEOUT_MS = 180000;
import { captureSharedWebcamFrame } from './webcamManager.js';

const OLLAMA_BASE_URL = typeof window !== 'undefined' && window.__VITE_OLLAMA_URL__
  ? window.__VITE_OLLAMA_URL__
  : 'http://localhost:11434';

export const AMBIENT_STORAGE_KEY = 'ollama_pro_ambient_observations';
const MAX_OBSERVATION_HISTORY = 20;

// Phone-activity day tracking, separate from the observation-history feed
// above (which is display/UI history and gets trimmed short) — this is a
// small dedicated log purpose-built for spotting a multi-day pattern.
const PHONE_ACTIVITY_DATES_KEY = 'ollama_pro_phone_activity_dates';
const LAST_PHONE_NUDGE_KEY = 'ollama_pro_last_phone_nudge_date';
const PHONE_NUDGE_LOOKBACK_DAYS = 7;
const PHONE_NUDGE_THRESHOLD = 3;
const PHONE_NUDGE_COOLDOWN_DAYS = 3;

function todayDateKey() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Records today as a phone-activity day (deduped) and, if phone activity
 * has now shown up on PHONE_NUDGE_THRESHOLD+ of the last
 * PHONE_NUDGE_LOOKBACK_DAYS calendar days, returns that count so the
 * caller can append a nudge — unless one was already shown within the
 * last PHONE_NUDGE_COOLDOWN_DAYS (avoids nagging on every single catch
 * once the pattern is already established).
 */
function recordPhoneActivityAndMaybeNudge() {
  if (typeof localStorage === 'undefined') return null;
  const today = todayDateKey();

  let dates = [];
  try {
    dates = JSON.parse(localStorage.getItem(PHONE_ACTIVITY_DATES_KEY) || '[]');
  } catch {
    dates = [];
  }
  if (!dates.includes(today)) dates.push(today);
  dates = dates.slice(-30);
  localStorage.setItem(PHONE_ACTIVITY_DATES_KEY, JSON.stringify(dates));

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - (PHONE_NUDGE_LOOKBACK_DAYS - 1));
  const cutoffKey = cutoff.toISOString().slice(0, 10);
  const recentCount = dates.filter((d) => d >= cutoffKey).length;

  if (recentCount < PHONE_NUDGE_THRESHOLD) return null;

  const lastNudge = localStorage.getItem(LAST_PHONE_NUDGE_KEY);
  if (lastNudge) {
    const daysSinceNudge = (new Date(today) - new Date(lastNudge)) / (1000 * 60 * 60 * 24);
    if (daysSinceNudge < PHONE_NUDGE_COOLDOWN_DAYS) return null;
  }

  localStorage.setItem(LAST_PHONE_NUDGE_KEY, today);
  return recentCount;
}

export function getStoredObservations() {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(AMBIENT_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveObservations(observations) {
  if (typeof localStorage === 'undefined') return;
  try {
    const trimmed = observations.slice(0, MAX_OBSERVATION_HISTORY);
    localStorage.setItem(AMBIENT_STORAGE_KEY, JSON.stringify(trimmed));
  } catch (err) {
    console.warn('Could not save ambient observations:', err);
  }
}

export function captureWebcamFrame(videoElement) {
  if (!videoElement || typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = videoElement.videoWidth || 640;
    canvas.height = videoElement.videoHeight || 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } catch (err) {
    console.warn('Could not capture webcam frame:', err);
    return null;
  }
}

/**
 * On-demand high-res snapshot capture from Logitech C930e webcam.
 * Opens the camera, lets auto-exposure adjust for 300ms, grabs frame, and closes stream.
 */
export async function captureLiveWebcamSnapshot() {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return null;
  let stream = null;
  try {
    let videoDeviceId = undefined;
    if (navigator.mediaDevices.enumerateDevices) {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = devices.filter((d) => d.kind === 'videoinput');
      const webcam = videoInputs.find((d) => /\b(webcam|c930|logitech|camera)\b/i.test(d.label || ''));
      if (webcam && webcam.deviceId) videoDeviceId = { exact: webcam.deviceId };
    }

    stream = await navigator.mediaDevices.getUserMedia({
      video: videoDeviceId
        ? { deviceId: videoDeviceId, width: { ideal: 1280 }, height: { ideal: 720 } }
        : { width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    });

    const video = document.createElement('video');
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play();

    // Allow auto-exposure & auto-focus to settle
    await new Promise((r) => setTimeout(r, 300));

    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 480;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, 640, 480);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return dataUrl;
  } catch (err) {
    console.warn('Live webcam capture error:', err);
    return null;
  } finally {
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
    }
  }
}

export async function generateAmbientObservation({
  videoElement,
  imageDataUrl = null,
  userName = 'User',
  presenceLabel = 'User',
  triggerReason = 'manual_observation',
  extraContext = ''
}) {
  let frameDataUrl = imageDataUrl || captureWebcamFrame(videoElement);
  if (!frameDataUrl) {
    frameDataUrl = await captureSharedWebcamFrame({ width: 640, height: 480, quality: 0.85 });
  }
  if (!frameDataUrl) {
    frameDataUrl = await captureLiveWebcamSnapshot();
  }

  if (!frameDataUrl) {
    return {
      id: `obs-${Date.now()}`,
      text: `Logitech Webcam is currently in use by another app (e.g. your Chrome/Edge webapp tab). Close the browser tab so the desktop app can access the camera.`,
      badge: '⚠️ Camera In Use',
      timestamp: new Date().toISOString(),
      imageDataUrl: null,
      triggerReason
    };
  }

  const base64Image = frameDataUrl.replace(/^data:image\/[a-z]+;base64,/, '');

  const now = new Date();
  const hour = now.getHours();
  const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : hour < 22 ? 'evening' : 'late night';
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const prompt = `You are Aloy, ${userName}'s ultra-competent, sharp, and proactive AI companion (inspired by JARVIS from Iron Man).
You are observing ${userName} at his workstation through his Logitech C930e webcam at ${timeStr} (${timeOfDay}).
${extraContext ? `LIVE WORKSPACE CONTEXT: ${extraContext}` : ''}

MISSION:
Engage with ${userName} directly in 1-2 conversational, natural, witty, and observant spoken sentences (under 25 words total).
Observe physical cues:
- Posture & ergonomics (upright, hunched over keyboard, slouching, stretching)
- Hydration & drinks (water bottle, coffee mug, energy drink, tea)
- Focus & engagement (locked in on code/monitors, glancing at phone/device, fatigue, eye strain)
- Environment (office lighting, late night session, clean desk)

GUIDELINES:
1. Proactive & Contextual: React to his state within his ${timeOfDay} workflow.
2. Direct & Companionable: Address him as "${userName}" or "you". Speak with wit, warmth, and effortless competence.
3. Actionable Help: When appropriate, offer a fast assist (adjusting lighting, hydrating, stretching, or initiating focus mode).
4. No filler boilerplate: Start speaking immediately without preamble.`;

  let observationText = '';

  try {
    const res = await fetchWithTimeout(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: base64Image ? 'minicpm-v' : 'aloy-assistant',
        messages: [
          {
            role: 'user',
            content: prompt,
            ...(base64Image ? { images: [base64Image] } : {})
          }
        ],
        stream: false,
        keep_alive: '10m',
        options: {
          temperature: 0.4,
          num_predict: 80
        }
      })
    }, VLM_TIMEOUT_MS);

    if (res.ok) {
      const data = await res.json();
      observationText = (data?.message?.content || '').trim();
    }
  } catch (err) {
    console.warn('Ollama observation generation error:', err);
  }

  // Fallback if model is offline or timed out
  if (!observationText) {
    if (triggerReason === 'desk_arrival') {
      observationText = hour < 12
        ? `Morning ${userName}. Workstation and system services are primed and standing by.`
        : hour >= 22
        ? `Back at the helm late tonight, ${userName}? I'll keep the workspace streamlined.`
        : `Welcome back to the desk, ${userName}. All systems are nominal and ready.`;
    } else if (triggerReason === 'long_focus') {
      observationText = `You've been locked in for a marathon stretch, ${userName}. Excellent progress—make sure to grab some water.`;
    } else if (triggerReason === 'phone_nudge') {
      observationText = `Spotting some phone drift, ${userName}. Want me to mute notifications so we can finish this sprint?`;
    } else {
      observationText = hour >= 22
        ? `Burning the midnight oil on the workstation, ${userName}? Let me know if you need focus lighting or a build run.`
        : `Keeping an eye on the workstation, ${userName}. Everything is green and standing by.`;
    }
  }

  // Dynamic affective & activity badge classification
  const lower = observationText.toLowerCase();
  let badge = '👁️ Workspace Observation';
  let suggestedAction = null;

  if (lower.includes('posture') || lower.includes('slouch') || lower.includes('hunch') || lower.includes('stretch') || lower.includes('ergonomic') || lower.includes('spine') || lower.includes('lean')) {
    badge = '🧘 Posture Check';
    suggestedAction = { type: 'reminder', label: 'Stretch & Reset Posture', icon: 'Activity' };
  } else if (lower.includes('water') || lower.includes('hydrate') || lower.includes('drink') || lower.includes('coffee') || lower.includes('mug') || lower.includes('sip') || lower.includes('cup')) {
    badge = '💧 Hydration Check';
    suggestedAction = { type: 'reminder', label: 'Hydration Logged', icon: 'Droplets' };
  } else if (lower.includes('phone') || lower.includes('screen') || lower.includes('scrolling') || lower.includes('device') || lower.includes('drift')) {
    badge = '📱 Phone Activity';
    suggestedAction = { type: 'focus', label: 'Focus Sprint', icon: 'Zap' };
  } else if (lower.includes('tired') || lower.includes('fatigue') || lower.includes('exhaust') || lower.includes('sleep') || lower.includes('yawn') || lower.includes('rest') || lower.includes('break')) {
    badge = '☕ Fatigue Detected';
    suggestedAction = { type: 'break', label: 'Take 5m Break', icon: 'Coffee' };
  } else if (lower.includes('light') || lower.includes('dim') || lower.includes('dark') || lower.includes('bright') || lower.includes('shadow')) {
    badge = '💡 Lighting Assist';
    suggestedAction = { type: 'light', label: 'Adjust Office Light', entity_id: 'light.office_light_strip', icon: 'Lightbulb' };
  } else if (lower.includes('sad') || lower.includes('down') || lower.includes('stress') || lower.includes('rough') || lower.includes('heavy') || lower.includes('tough')) {
    badge = '💙 Mood Check-In';
  } else if (lower.includes('focus') || lower.includes('locked in') || lower.includes('momentum') || lower.includes('code') || lower.includes('grind') || lower.includes('marathon')) {
    badge = '⚡ Deep Focus';
  } else if (triggerReason === 'desk_arrival') {
    badge = '👤 Desk Arrival';
  }

  if (badge === '📱 Phone Activity') {
    const recentDayCount = recordPhoneActivityAndMaybeNudge();
    if (recentDayCount) {
      observationText += ` That's ${recentDayCount} of the last ${PHONE_NUDGE_LOOKBACK_DAYS} days I've caught you on it — might be worth a break.`;
    }
  }

  const observation = {
    id: `obs-${Date.now()}`,
    text: observationText,
    badge,
    timestamp: new Date().toISOString(),
    imageDataUrl: frameDataUrl,
    triggerReason,
    suggestedAction
  };

  return observation;
}

/**
 * Captures a live webcam frame and answers the user's own question about
 * it (vs. generateAmbientObservation's fixed generic-commentary prompt) —
 * e.g. "what am I holding", "does this look right". Returns null (not a
 * fallback string) when no frame could be captured at all, so callers can
 * distinguish "camera unavailable" from "VLM gave an answer".
 */
export async function answerVisualQuestion(question, { videoElement = null, userName = 'User' } = {}) {
  let frameDataUrl = videoElement ? captureWebcamFrame(videoElement) : null;
  if (!frameDataUrl) {
    frameDataUrl = await captureSharedWebcamFrame({ width: 640, height: 480, quality: 0.85 });
  }
  if (!frameDataUrl) {
    frameDataUrl = await captureLiveWebcamSnapshot();
  }
  if (!frameDataUrl) return null;

  const base64Image = frameDataUrl.replace(/^data:image\/[a-z]+;base64,/, '');
  const prompt = `You are Aloy, ${userName}'s AI assistant, looking through his live webcam. Answer his question directly and specifically about what you actually see, in 1-3 natural spoken sentences. If you can't tell, say so honestly rather than guessing.\n\nQuestion: ${question}`;

  try {
    const res = await fetchWithTimeout(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'minicpm-v',
        messages: [{ role: 'user', content: prompt, images: [base64Image] }],
        stream: false,
        keep_alive: '10m',
        options: { temperature: 0.2 }
      })
    }, VLM_TIMEOUT_MS);
    if (!res.ok) return null;
    const data = await res.json();
    return { text: (data?.message?.content || '').trim(), imageDataUrl: frameDataUrl };
  } catch (err) {
    console.warn('answerVisualQuestion error:', err);
    return null;
  }
}

const GESTURE_LABELS = ['thumbsup', 'wave', 'none'];

/**
 * Captures a live frame and classifies it as a thumbs-up, a waving/dismiss
 * hand gesture, or neither — reuses the same local VLM already used for
 * ambient commentary rather than a dedicated gesture-recognition model.
 * This is a coarse, best-effort classifier (single frame, forced-choice
 * prompt), not a trained gesture detector — expect real misses/false
 * positives, especially at odd angles or poor lighting.
 */
export async function detectGesture({ videoElement = null } = {}) {
  let frameDataUrl = videoElement ? captureWebcamFrame(videoElement) : null;
  if (!frameDataUrl) {
    frameDataUrl = await captureSharedWebcamFrame({ width: 480, height: 360, quality: 0.75 });
  }
  if (!frameDataUrl) return 'none';

  const base64Image = frameDataUrl.replace(/^data:image\/[a-z]+;base64,/, '');
  const prompt = 'Look at the person\'s hand(s) in this image. Are they showing a clear thumbs-up gesture, a waving/dismissing open-hand gesture, or neither (e.g. hands not visible, typing, holding something, resting)? Reply with EXACTLY one word: thumbsup, wave, or none. No other text.';

  try {
    const res = await fetchWithTimeout(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'minicpm-v',
        messages: [{ role: 'user', content: prompt, images: [base64Image] }],
        stream: false,
        keep_alive: '10m',
        options: { temperature: 0.1 }
      })
    }, VLM_TIMEOUT_MS);
    if (!res.ok) return 'none';
    const data = await res.json();
    const raw = (data?.message?.content || '').trim().toLowerCase().replace(/[^a-z]/g, '');
    return GESTURE_LABELS.includes(raw) ? raw : 'none';
  } catch (err) {
    console.warn('detectGesture error:', err);
    return 'none';
  }
}

export async function maybeExecuteProactiveAmbientAction(observation) {
  if (!observation || !observation.badge) return null;
  if (typeof localStorage === 'undefined') return null;

  // Check if proactive ambient actions are enabled (defaults to true)
  const isEnabled = localStorage.getItem('aloy_proactive_ambient_actions') !== 'false';
  if (!isEnabled) return null;

  const now = Date.now();
  const COOLDOWN_MS = 30 * 60 * 1000; // 30 minute cooldown per category
  const cooldownKey = `aloy_proactive_cooldown_${observation.badge.replace(/\s+/g, '_')}`;
  const lastFired = parseInt(localStorage.getItem(cooldownKey) || '0', 10);
  if (now - lastFired < COOLDOWN_MS) return null;

  // Proactive Action 1: Lighting Assist
  if (observation.badge === '💡 Lighting Assist') {
    try {
      const { callHAService } = await import('./homeassistant.js');
      await callHAService('light', 'turn_on', 'light.office_light_strip', {
        brightness_pct: 85,
        color_temp: 350
      });
      localStorage.setItem(cooldownKey, String(now));
      return {
        action: 'lighting_adjusted',
        message: '💡 Proactively adjusted office light to 85% brightness for optimal visibility.'
      };
    } catch (err) {
      console.warn('[AmbientObserver] Proactive lighting assist failed:', err);
    }
  }

  // Proactive Action 2: Fatigue / Posture Alert
  if (observation.badge === '☕ Fatigue Detected' || observation.badge === '🧘 Posture Check') {
    localStorage.setItem(cooldownKey, String(now));
    return {
      action: 'wellness_nudge',
      message: observation.badge === '☕ Fatigue Detected'
        ? '☕ Fatigue detected: suggested 5m recovery break.'
        : '🧘 Posture check: remember to reset spine alignment.'
    };
  }

  return null;
}

export async function dispatchAmbientObservation(observation, { speak = true, voiceId = 'af_sarah', onSpeakingFinished = null } = {}) {
  if (!observation || !observation.text) return;

  // 1. Persist to local observation history
  const current = getStoredObservations();
  const updated = [observation, ...current];
  saveObservations(updated);

  // 2. Execute proactive ambient action (Lighting / Wellness)
  try {
    const proactiveResult = await maybeExecuteProactiveAmbientAction(observation);
    if (proactiveResult && typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('aloy:proactive-ambient-action', { detail: proactiveResult }));
    }
  } catch (err) {
    console.warn('Proactive ambient action error:', err);
  }

  // 3. Speak aloud via Kokoro TTS if enabled
  if (speak) {
    try {
      await speakKokoroAudio(observation.text, voiceId);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('aloy:ambient-observation-spoken', { detail: { observation } }));
      }
      if (onSpeakingFinished) {
        onSpeakingFinished(observation);
      }
    } catch (err) {
      console.warn('Could not speak ambient observation:', err);
    }
  }

  // 4. Persist to ~/.aloy-server/observations.log.jsonl on disk
  if (typeof window !== 'undefined' && window.electronAPI?.logObservation) {
    try {
      window.electronAPI.logObservation({
        id: observation.id,
        badge: observation.badge,
        text: observation.text,
        timestamp: observation.timestamp,
        triggerReason: observation.triggerReason
      });
    } catch (err) {
      console.warn('Disk observation log error:', err);
    }
  }

  // 5. Sync to Obsidian Vault if running inside Electron
  if (typeof window !== 'undefined' && window.electronAPI?.createObsidianNote) {
    try {
      const dateStr = new Date().toISOString().slice(0, 10);
      const noteContent = `\n- **[${new Date().toLocaleTimeString()}]** (${observation.badge}): ${observation.text}`;
      window.electronAPI.createObsidianNote(null, `Ambient Observations - ${dateStr}.md`, noteContent);
    } catch (err) {
      console.warn('Obsidian observation sync error:', err);
    }
  }

  // 6. Sync to Aloy Server for real-time mobile parity
  try {
    const serverUrl = typeof window !== 'undefined' && window.__VITE_ALOY_SERVER_URL__
      ? window.__VITE_ALOY_SERVER_URL__
      : 'http://127.0.0.1:7890';
    fetchWithTimeout(`${serverUrl}/api/observer/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(observation)
    }, 4000).catch(() => {});
  } catch {}

  return observation;
}
