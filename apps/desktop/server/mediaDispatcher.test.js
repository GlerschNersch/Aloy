import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listPlaybackTargets,
  searchLocalMedia,
  dispatchMedia,
  stopMedia,
  handleMediaSessionControl,
  getActiveMediaSessions,
  discoverRokuDevices
} from './mediaDispatcher.cjs';

describe('Universal Media Dispatcher with Roku ECP & Home Assistant', () => {
  it('discovers playback targets including Broadcast, Local PC, Linux machines, and Roku devices', async () => {
    const haCategories = {
      media_players: [
        { entity_id: 'media_player.kitchen_display', name: 'Kitchen Display', state: 'idle' }
      ]
    };
    const targets = await listPlaybackTargets(haCategories);
    expect(Array.isArray(targets)).toBe(true);
    expect(targets.some(t => t.id === 'all')).toBe(true);
    expect(targets.some(t => t.id === 'local')).toBe(true);
    expect(targets.some(t => t.id.startsWith('machine:bazzite'))).toBe(true);
    expect(targets.some(t => t.type === 'roku')).toBe(true);
  });

  it('searches local media on P: drive', () => {
    const results = searchLocalMedia('', 10, 'all');
    expect(Array.isArray(results)).toBe(true);
    if (results.length > 0) {
      expect(results[0]).toHaveProperty('title');
      expect(results[0]).toHaveProperty('filePath');
    }
  });

  it('dispatches to Roku and tracks active session with playback controls', async () => {
    const dispatchRes = await dispatchMedia({
      targetId: 'roku:192.168.1.100',
      mediaTitle: 'Test Movie',
      mediaPath: 'P:\\Movies\\Test Movie (2024)\\Test Movie (2024).mp4'
    });

    expect(dispatchRes.success).toBe(true);
    expect(dispatchRes.target).toBe('roku:192.168.1.100');

    // Check active sessions
    const sessions = getActiveMediaSessions();
    const rokuSession = sessions.find(s => s.deviceId === 'roku:192.168.1.100');
    expect(rokuSession).toBeDefined();
    expect(rokuSession.nowPlaying.name).toBe('Test Movie');

    // Test PlayPause control
    const pauseRes = await handleMediaSessionControl('aloy:roku:192.168.1.100', 'PlayPause');
    expect(pauseRes.success).toBe(true);

    // Test Stop control
    const stopRes = await handleMediaSessionControl('aloy:roku:192.168.1.100', 'Stop');
    expect(stopRes.success).toBe(true);
  });

  it('handles VolumeUp and VolumeDown for Roku sessions', async () => {
    const vUp = await handleMediaSessionControl('aloy:roku:192.168.1.100', 'VolumeUp');
    expect(vUp.success).toBe(true);

    const vDown = await handleMediaSessionControl('aloy:roku:192.168.1.100', 'VolumeDown');
    expect(vDown.success).toBe(true);
  });
});
