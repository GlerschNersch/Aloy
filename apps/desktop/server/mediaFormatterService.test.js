import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { MediaFormatterService } from './mediaFormatterService.cjs';

describe('MediaFormatterService', () => {
  it('initializes with default media paths', () => {
    const service = new MediaFormatterService();
    expect(service.defaultTvPath).toBe('P:\\TV Shows');
    expect(service.defaultMoviesPath).toBe('P:\\Movies');
  });

  it('audits a temporary mock media library accurately', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aloy-media-test-'));
    const mockTv = path.join(tempDir, 'TV Shows');
    const mockMovies = path.join(tempDir, 'Movies');

    fs.mkdirSync(path.join(mockTv, 'Gargoyles (1994)', 'Season 01'), { recursive: true });
    fs.writeFileSync(path.join(mockTv, 'Gargoyles (1994)', 'Season 01', 'Gargoyles - S01E01 - Awakening.mp4'), '');

    fs.mkdirSync(path.join(mockMovies, 'The Matrix (1999)'), { recursive: true });
    fs.writeFileSync(path.join(mockMovies, 'The Matrix (1999)', 'The Matrix (1999).mp4'), '');

    const service = new MediaFormatterService(mockTv, mockMovies);
    const report = await service.audit({ tvPath: mockTv, moviesPath: mockMovies });

    expect(report.tv.totalShows).toBe(1);
    expect(report.tv.totalEpisodes).toBe(1);
    expect(report.tv.issues.length).toBe(0);

    expect(report.movies.totalFolders).toBe(1);
    expect(report.movies.totalVideos).toBe(1);
    expect(report.movies.issues.length).toBe(0);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('detects non-standard episode names and missing movie years', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aloy-media-test-2-'));
    const mockTv = path.join(tempDir, 'TV Shows');
    const mockMovies = path.join(tempDir, 'Movies');

    fs.mkdirSync(path.join(mockTv, 'Unknown Show', 'Season 1 (1995)'), { recursive: true });
    fs.writeFileSync(path.join(mockTv, 'Unknown Show', 'Season 1 (1995)', 'Show - Episode 1.mp4'), '');

    fs.mkdirSync(path.join(mockMovies, 'Movie Without Year'), { recursive: true });
    fs.writeFileSync(path.join(mockMovies, 'Movie Without Year', 'Movie Without Year.mp4'), '');

    const service = new MediaFormatterService(mockTv, mockMovies);
    const report = await service.audit({ tvPath: mockTv, moviesPath: mockMovies });

    expect(report.tv.issues.length).toBeGreaterThan(0);
    expect(report.movies.issues.length).toBeGreaterThan(0);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('formats non-standard season folders and strips tracker junk files', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aloy-media-test-3-'));
    const mockTv = path.join(tempDir, 'TV Shows');
    const mockMovies = path.join(tempDir, 'Movies');

    fs.mkdirSync(path.join(mockTv, 'Show (2020)', 'Season 1'), { recursive: true });
    fs.writeFileSync(path.join(mockTv, 'Show (2020)', 'Downloaded from ETTV.txt'), 'junk');
    fs.writeFileSync(path.join(mockTv, 'Show (2020)', 'Season 1', 'Show - S01 E01 - Pilot (720p).mp4'), '');

    const service = new MediaFormatterService(mockTv, mockMovies);
    const result = await service.format({ tvPath: mockTv, moviesPath: mockMovies, dryRun: false });

    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(mockTv, 'Show (2020)', 'Downloaded from ETTV.txt'))).toBe(false);
    expect(fs.existsSync(path.join(mockTv, 'Show (2020)', 'Season 01', 'Show - S01E01 - Pilot.mp4'))).toBe(true);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
