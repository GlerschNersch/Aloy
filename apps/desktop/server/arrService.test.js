import { describe, it, expect, vi } from 'vitest';
import { ArrService } from './arrService.cjs';

describe('ArrService (*Arr Orchestration)', () => {
  it('initializes with default URLs and handles status gracefully when offline', async () => {
    const service = new ArrService({
      radarrUrl: 'http://127.0.0.1:7878',
      sonarrUrl: 'http://127.0.0.1:8989',
      radarrApiKey: 'test-radarr-key',
      sonarrApiKey: 'test-sonarr-key',
    });

    const status = await service.getStatus();
    expect(status).toBeDefined();
    expect(status.radarr).toBeDefined();
    expect(status.sonarr).toBeDefined();
    expect(status.radarr.url).toBe('http://127.0.0.1:7878');
    expect(status.sonarr.url).toBe('http://127.0.0.1:8989');
  });

  it('handles search query parameter validations', async () => {
    const service = new ArrService();
    const emptyResult = await service.searchMedia('');
    expect(emptyResult).toEqual({ movies: [], series: [], music: [] });
  });

  it('processes webhook payload and emits event correctly', async () => {
    const service = new ArrService();
    const listener = vi.fn();
    service.on('webhook', listener);

    const webhookPayload = {
      eventType: 'Download',
      movie: {
        title: 'Dune: Part Two',
        year: 2024,
      },
      downloadClient: 'qBittorrent',
      release: {
        releaseTitle: 'Dune.Part.Two.2024.2160p.UHD.BluRay.x265',
      },
    };

    const res = await service.handleWebhook(webhookPayload);
    expect(res.success).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(res.processed.title).toBe('Dune: Part Two');
    expect(res.processed.source).toBe('Radarr');
  });

  it('validates required fields when adding movie or series', async () => {
    const service = new ArrService();
    await expect(service.addMovie({})).rejects.toThrow('tmdbId or title is required');
    await expect(service.addSeries({})).rejects.toThrow('tvdbId or title is required');
  });

  it('getStatus reports all six Media Stack services, not just the four with a system/status API', async () => {
    const service = new ArrService();
    const status = await service.getStatus();
    expect(Object.keys(status).sort()).toEqual(
      ['lidarr', 'prowlarr', 'radarr', 'retroarr', 'sabnzbd', 'sonarr'].sort()
    );
    // sabnzbd/retroarr don't expose /system/status — they're reachability-only
    expect(status.sabnzbd).toHaveProperty('online');
    expect(status.retroarr).toHaveProperty('online');
  });

  it('startService/stopService/restartService reject an unknown service name', async () => {
    const service = new ArrService();
    const startRes = await service.startService('notaservice');
    expect(startRes.success).toBe(false);
    expect(startRes.error).toMatch(/Unknown service/);

    const stopRes = await service.stopService('notaservice');
    expect(stopRes.success).toBe(false);
    expect(stopRes.error).toMatch(/Unknown service/);
  });

  it('startService fails gracefully when the executable is missing, without throwing', async () => {
    const service = new ArrService();
    // MEDIA_STACK_DIR defaults to a path under the current user's home; on a
    // machine without the real Media Stack installed (e.g. CI) this exe
    // won't exist, and the method should report that rather than throw.
    const res = await service.startService('sonarr');
    expect(res).toHaveProperty('success');
    if (!res.success) {
      expect(res.error).toBeTruthy();
    }
  });

  it('stopService resolves success even when the target process is not running', async () => {
    const service = new ArrService();
    const res = await service.stopService('sonarr');
    expect(res.success).toBe(true);
  }, 10000);

  it('_serviceDefs covers every process launch_stack.bat starts, including RetroArr (previously missing from startStack/stopStack)', () => {
    const service = new ArrService();
    const keys = Object.keys(service._serviceDefs).sort();
    expect(keys).toEqual(['lidarr', 'prowlarr', 'radarr', 'retroarr', 'sabnzbd', 'sonarr'].sort());
    expect(service._serviceDefs.retroarr.imageNames).toContain('RetroArr.Host.exe');
  });
});
