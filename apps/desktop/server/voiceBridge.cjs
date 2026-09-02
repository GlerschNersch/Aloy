/**
 * Voice Bridge Service for Aloy (Desktop & Mobile).
 * 
 * Orchestrates local high-performance voice pipelines:
 * - Kokoro-82M Studio Neural Voice TTS (Port 8888)
 * - Faster-Whisper GPU Speech-to-Text with Silero VAD (Port 8890)
 * - Sentence-level streaming synthesis for sub-500ms voice chat latency
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { logAuditEvent } = require('./auditLogger.cjs');
const { getOrCreateToken } = require('./auth.cjs');

const DEFAULT_KOKORO_URL = process.env.KOKORO_URL || 'http://127.0.0.1:8888';
const DEFAULT_WHISPER_URL = process.env.WHISPER_URL || 'http://127.0.0.1:8890';

const DEFAULT_VOICES = [
  { id: 'af_sarah', name: 'Sarah (American Female - Natural)', language: 'en-us' },
  { id: 'af_bella', name: 'Bella (American Female - Warm)', language: 'en-us' },
  { id: 'af_nicole', name: 'Nicole (American Female - Expressive)', language: 'en-us' },
  { id: 'am_adam', name: 'Adam (American Male - Deep)', language: 'en-us' },
  { id: 'am_michael', name: 'Michael (American Male - Executive)', language: 'en-us' },
  { id: 'bf_emma', name: 'Emma (British Female - Studio)', language: 'en-gb' },
  { id: 'bf_isabella', name: 'Isabella (British Female - Formal)', language: 'en-gb' },
  { id: 'bm_george', name: 'George (British Male - Warm)', language: 'en-gb' }
];

class VoiceBridge {
  constructor(options = {}) {
    this.kokoroUrl = options.kokoroUrl || DEFAULT_KOKORO_URL;
    this.whisperUrl = options.whisperUrl || DEFAULT_WHISPER_URL;
    this.cachedStatus = {
      kokoro: { online: false, lastChecked: 0, voices: DEFAULT_VOICES },
      whisper: { online: false, lastChecked: 0 }
    };
  }

  /**
   * Checks the health and availability of both Kokoro and Faster-Whisper engines.
   * @returns {Promise<{ kokoro: Object, whisper: Object, allReady: boolean }>}
   */
  async getStatus() {
    const now = Date.now();
    const token = getOrCreateToken();

    // 1. Check Kokoro
    try {
      const kokoroRes = await fetch(`${this.kokoroUrl}/voices`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(2000)
      });
      if (kokoroRes.ok) {
        const voices = await kokoroRes.json().catch(() => DEFAULT_VOICES);
        this.cachedStatus.kokoro = {
          online: true,
          lastChecked: now,
          url: this.kokoroUrl,
          model: 'Kokoro-82M v1.0',
          voices: Array.isArray(voices) && voices.length > 0 ? voices : DEFAULT_VOICES
        };
      } else {
        this.cachedStatus.kokoro.online = false;
      }
    } catch {
      this.cachedStatus.kokoro.online = false;
      this.cachedStatus.kokoro.voices = DEFAULT_VOICES;
    }

    // 2. Check Faster-Whisper
    try {
      const whisperRes = await fetch(`${this.whisperUrl}/health`, { signal: AbortSignal.timeout(2000) });
      this.cachedStatus.whisper = {
        online: whisperRes.ok,
        lastChecked: now,
        url: this.whisperUrl,
        model: 'faster-whisper (CTranslate2 + Silero VAD)'
      };
    } catch {
      this.cachedStatus.whisper.online = false;
    }

    return {
      kokoro: this.cachedStatus.kokoro,
      whisper: this.cachedStatus.whisper,
      allReady: this.cachedStatus.kokoro.online && this.cachedStatus.whisper.online,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Synthesizes speech using Kokoro neural TTS.
   * @param {string} text 
   * @param {Object} [options]
   * @param {string} [options.voice='af_sarah']
   * @param {number} [options.speed=1.0]
   * @returns {Promise<{ success: boolean, audioBuffer?: Buffer, contentType?: string, error?: string }>}
   */
  async synthesizeSpeech(text, options = {}) {
    if (!text || typeof text !== 'string') {
      return { success: false, error: 'Text prompt is required for speech synthesis' };
    }

    const { voice = 'af_sarah', speed = 1.0 } = options;

    const token = getOrCreateToken();

    try {
      const res = await fetch(`${this.kokoroUrl}/tts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ text: text.trim(), voice, speed }),
        signal: AbortSignal.timeout(20000)
      });

      if (!res.ok) {
        throw new Error(`Kokoro server returned HTTP ${res.status}`);
      }

      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      return {
        success: true,
        audioBuffer: buffer,
        contentType: res.headers.get('content-type') || 'audio/wav',
        byteLength: buffer.length
      };
    } catch (err) {
      return {
        success: false,
        error: `Speech synthesis failed: ${err.message}`
      };
    }
  }

  /**
   * Transcribes uploaded audio recording using Faster-Whisper.
   * @param {Buffer} audioBuffer 
   * @param {string} [mimeType='audio/webm']
   * @returns {Promise<{ success: boolean, text?: string, error?: string }>}
   */
  async transcribeAudio(audioBuffer, mimeType = 'audio/webm') {
    if (!audioBuffer || audioBuffer.length === 0) {
      return { success: false, error: 'Audio data is empty' };
    }

    try {
      // Create FormData compatible with faster-whisper API
      const boundary = `----WebKitFormBoundary${Date.now().toString(16)}`;
      const ext = mimeType.includes('wav') ? 'wav' : (mimeType.includes('mp3') ? 'mp3' : 'webm');
      
      const header = Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="audio"; filename="recording.${ext}"\r\n` +
        `Content-Type: ${mimeType}\r\n\r\n`
      );
      const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
      const body = Buffer.concat([header, audioBuffer, footer]);

      const res = await fetch(`${this.whisperUrl}/transcribe`, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
          'Content-Length': String(body.length)
        },
        body,
        signal: AbortSignal.timeout(30000)
      });

      if (!res.ok) {
        throw new Error(`Whisper server returned HTTP ${res.status}`);
      }

      const data = await res.json();
      return {
        success: true,
        text: data.text || ''
      };
    } catch (err) {
      return {
        success: false,
        error: `Transcription failed: ${err.message}`
      };
    }
  }
}

const globalVoiceBridge = new VoiceBridge();

module.exports = {
  VoiceBridge,
  globalVoiceBridge,
  DEFAULT_VOICES
};
