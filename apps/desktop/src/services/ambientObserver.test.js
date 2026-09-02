import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getStoredObservations,
  saveObservations,
  captureWebcamFrame,
  generateAmbientObservation,
  dispatchAmbientObservation,
  AMBIENT_STORAGE_KEY
} from './ambientObserver.js';

describe('ambientObserver Service', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('saves and retrieves observations from storage', () => {
    const mockObs = [
      { id: '1', text: 'User is seated at desk.', badge: '👤 Desk Arrival', timestamp: new Date().toISOString() }
    ];
    saveObservations(mockObs);
    const loaded = getStoredObservations();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].text).toBe('User is seated at desk.');
  });

  it('caps observations history to 20 entries', () => {
    const list = Array.from({ length: 30 }, (_, i) => ({ id: `obs-${i}`, text: `Observation ${i}` }));
    saveObservations(list);
    const loaded = getStoredObservations();
    expect(loaded).toHaveLength(20);
  });

  it('generates fallback observation if Ollama fetch fails', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValueOnce(new Error('Network error'));
    const obs = await generateAmbientObservation({
      videoElement: { videoWidth: 640, height: 480 },
      userName: 'User',
      triggerReason: 'desk_arrival'
    });

    expect(obs).toBeDefined();
    expect(obs.text).toBeDefined();
  });

  it('parses Ollama vision model response correctly', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        message: { content: 'User is seated with headset on, working attentively.' }
      })
    });

    const obs = await generateAmbientObservation({
      imageDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      userName: 'User',
      triggerReason: 'desk_arrival'
    });

    expect(obs.text).toBe('User is seated with headset on, working attentively.');
  });

  it('dispatches observation to storage and dispatches TTS', async () => {
    const obs = {
      id: 'test-1',
      text: 'Good afternoon User, all systems normal.',
      badge: '👤 Desk Arrival',
      timestamp: new Date().toISOString()
    };

    const res = await dispatchAmbientObservation(obs, { speak: false });
    expect(res).toBeDefined();
    const stored = getStoredObservations();
    expect(stored[0].id).toBe('test-1');
  });
});
