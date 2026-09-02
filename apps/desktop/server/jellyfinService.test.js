import { describe, it, expect, vi } from 'vitest';
import { JellyfinService } from './jellyfinService.cjs';

describe('Jellyfin Service', () => {
  it('initializes with default URL and handles public status query', async () => {
    const service = new JellyfinService('http://127.0.0.1:8096');
    const status = await service.getStatus();

    expect(status).toBeDefined();
    expect(status.url).toBe('http://127.0.0.1:8096');
    if (status.online) {
      expect(status.serverName).toBeDefined();
      expect(status.version).toBeDefined();
    }
  });

  it('validates supported session commands and rejects invalid commands', async () => {
    const service = new JellyfinService('http://127.0.0.1:8096');

    await expect(service.sendSessionCommand('', 'Play')).rejects.toThrow('sessionId is required');
    await expect(service.sendSessionCommand('sess-123', 'InvalidCommand')).rejects.toThrow(
      'Unsupported command'
    );
  });

  it('safely handles empty sessions when unauthenticated', async () => {
    const service = new JellyfinService('http://127.0.0.1:8096', '');
    const sessions = await service.getSessions(true);
    expect(Array.isArray(sessions)).toBe(true);
  });

  it('generates diagnostic health report for the server', async () => {
    const service = new JellyfinService('http://127.0.0.1:8096');
    const report = await service.diagnose();
    expect(report).toBeDefined();
    expect(typeof report.healthy).toBe('boolean');
    expect(report.summary).toBeDefined();
  });

  it('correctly normalizes rich playback session objects', () => {
    const service = new JellyfinService('http://127.0.0.1:8096');
    const rawSession = {
      Id: 'sess-abc-123',
      UserName: 'testuser',
      Client: 'Jellyfin Android TV',
      DeviceName: 'Living Room TV',
      DeviceId: 'tv-device-1',
      SupportsRemoteControl: true,
      PlayState: {
        PositionTicks: 1200000000,
        CanSeek: true,
        IsPaused: false,
      },
      NowPlayingItem: {
        Id: 'item-999',
        Name: 'The Battle of the Pelennor Fields',
        Type: 'Episode',
        SeriesName: 'Lord of the Rings',
        SeasonName: 'Season 3',
        IndexNumber: 4,
        RunTimeTicks: 3600000000,
        ProductionYear: 2026,
        Overview: 'An epic clash of armies.',
        Genres: ['Fantasy', 'Action'],
        Path: 'P:\\Media\\TV\\LOTR\\S03E04.mkv',
      },
    };

    const normalized = service._normalizeSession(rawSession);
    expect(normalized).toBeDefined();
    expect(normalized.id).toBe('sess-abc-123');
    expect(normalized.userName).toBe('testuser');
    expect(normalized.deviceName).toBe('Living Room TV');
    expect(normalized.supportsRemoteControl).toBe(true);
    expect(normalized.nowPlaying).toBeDefined();
    expect(normalized.nowPlaying.name).toBe('The Battle of the Pelennor Fields');
    expect(normalized.nowPlaying.seriesName).toBe('The Lord of the Rings');
    expect(normalized.nowPlaying.playbackPercent).toBe(50);
    expect(normalized.nowPlaying.isPaused).toBe(false);
  });

  it('emits sessions and playback events to registered event listeners', () => {
    const service = new JellyfinService('http://127.0.0.1:8096');
    const mockListener = vi.fn();
    service.on('sessions', mockListener);

    service._handleWsMessage({
      MessageType: 'Sessions',
      Data: [
        {
          Id: 'sess-1',
          UserName: 'Kids',
          DeviceName: 'Roku Ultra',
          NowPlayingItem: { Name: 'Bluey', Type: 'Episode', RunTimeTicks: 100 },
          PlayState: { PositionTicks: 50, IsPaused: true },
        },
      ],
    });

    expect(mockListener).toHaveBeenCalledTimes(1);
    const emitted = mockListener.mock.calls[0][0];
    expect(emitted.length).toBe(1);
    expect(emitted[0].userName).toBe('Kids');
    expect(emitted[0].nowPlaying.name).toBe('Bluey');
    expect(emitted[0].nowPlaying.playbackPercent).toBe(50);
    expect(emitted[0].nowPlaying.isPaused).toBe(true);
  });
});
