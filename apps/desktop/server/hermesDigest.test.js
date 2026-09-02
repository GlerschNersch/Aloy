import { describe, it, expect } from 'vitest';
import { scoreHeadline, HermesDigestEngine } from './hermesDigest.cjs';

describe('HERMES DIGEST — Morning Intelligence Hub & Quality Scoring', () => {
  it('1. scores headlines accurately according to high-signal keywords and sources', () => {
    const highArticle = {
      title: 'New local model released for agentic coding on Nvidia GPUs',
      sourceName: 'GitHub Release',
      publishedAt: new Date().toISOString()
    };
    const scoreHigh = scoreHeadline(highArticle);
    expect(scoreHigh).toBeGreaterThanOrEqual(80);

    const lowArticle = {
      title: 'Celebrity wears strange hat at grocery store',
      sourceName: 'Gossip Blog',
      publishedAt: new Date(Date.now() - 72 * 3600 * 1000).toISOString()
    };
    const scoreLow = scoreHeadline(lowArticle);
    expect(scoreLow).toBeLessThan(50);
  });

  it('2. generates structured morning intelligence digest with health, media, and tech sections', async () => {
    const mockStore = {
      load: () => ({
        newsArticles: [
          { title: 'Ollama adds support for local tool calling', sourceName: 'GitHub', publishedAt: new Date().toISOString() }
        ],
        reminders: [
          { title: 'Audit media library on drive P:', completed: false }
        ]
      })
    };

    const mockArr = {
      getQueue: async () => ({
        queue: [
          { title: 'The Matrix Resurrections (2021)', service: 'Radarr', progress: 85, timeleft: '00:04:12' }
        ]
      })
    };

    const mockHealth = {
      getHealthSummary: () => ({
        sleepDurationHours: 8.0,
        sleepScore: 92,
        readinessScore: 95,
        restingHeartRate: 54
      })
    };

    const mockMinerva = {
      runHealthScan: async () => ({ status: 'healthy', offlineCount: 0 }),
      getSelfHealEvents: () => []
    };

    const engine = new HermesDigestEngine({
      storeInstance: mockStore,
      healthBridge: mockHealth,
      minervaInstance: mockMinerva,
      arrService: mockArr
    });

    const digest = await engine.generateDigest({ userName: 'User' });

    expect(digest).toBeDefined();
    expect(digest.summaryMarkdown).toContain('Hermes Morning Intelligence');
    expect(digest.summaryMarkdown).toContain('Physical Readiness & Vitals');
    expect(digest.summaryMarkdown).toContain('The Matrix Resurrections');
    expect(digest.metrics.mediaQueue.totalActive).toBe(1);
    expect(digest.metrics.topHeadlines).toHaveLength(1);
  });
});
