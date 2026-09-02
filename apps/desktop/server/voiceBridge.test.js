import { describe, it, expect, vi } from 'vitest';
const { VoiceBridge, DEFAULT_VOICES } = require('./voiceBridge.cjs');

describe('VoiceBridge Service (Kokoro-TTS + Faster-Whisper)', () => {
  it('instantiates with default voices and config', () => {
    const bridge = new VoiceBridge({
      kokoroUrl: 'http://127.0.0.1:8888',
      whisperUrl: 'http://127.0.0.1:8890'
    });

    expect(bridge.kokoroUrl).toBe('http://127.0.0.1:8888');
    expect(bridge.whisperUrl).toBe('http://127.0.0.1:8890');
    expect(DEFAULT_VOICES.length).toBeGreaterThan(0);
    expect(DEFAULT_VOICES[0].id).toBe('af_sarah');
  });

  it('handles offline status gracefully without throwing', async () => {
    const bridge = new VoiceBridge({
      kokoroUrl: 'http://127.0.0.1:9999', // Non-existent port
      whisperUrl: 'http://127.0.0.1:9998'
    });

    const status = await bridge.getStatus();
    expect(status.kokoro.online).toBe(false);
    expect(status.whisper.online).toBe(false);
    expect(status.allReady).toBe(false);
    expect(status.kokoro.voices.length).toBeGreaterThan(0); // Fallback voices preserved
  });

  it('validates empty inputs on speech synthesis and transcription', async () => {
    const bridge = new VoiceBridge();
    const ttsRes = await bridge.synthesizeSpeech('');
    expect(ttsRes.success).toBe(false);
    expect(ttsRes.error).toContain('Text prompt is required');

    const sttRes = await bridge.transcribeAudio(null);
    expect(sttRes.success).toBe(false);
    expect(sttRes.error).toContain('Audio data is empty');
  });
});
