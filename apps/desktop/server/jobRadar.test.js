import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JobRadarEngine } from './jobRadar.cjs';

describe('JobRadarEngine LinkedIn Ingestion & Filtering', () => {
  let mockStore;
  let storeData;
  let engine;

  const sampleLinkedInHtml = `
    <ul class="jobs-search__results-list">
      <li>
        <div class="base-card relative w-full hover:no-underline focus:no-underline base-card--link base-search-card base-search-card--link job-search-card" data-entity-urn="urn:li:jobPosting:4152637482">
          <a class="base-card__full-link absolute top-0 right-0 bottom-0 left-0 p-0 z-[2]" href="https://www.linkedin.com/jobs/view/senior-technical-writer-developer-docs-4152637482?position=1&amp;pageNum=0">
            <span class="sr-only">Senior Technical Writer - Developer Docs</span>
          </a>
          <div class="base-search-card__info">
            <h3 class="base-search-card__title">Senior Technical Writer - Developer Docs</h3>
            <h4 class="base-search-card__subtitle">
              <a class="hidden-nested-link" href="https://www.linkedin.com/company/stripe">Stripe</a>
            </h4>
            <div class="base-search-card__metadata">
              <span class="job-search-card__location">United States (Remote)</span>
              <time class="job-search-card__listdate" datetime="2026-08-19">3 hours ago</time>
            </div>
          </div>
        </div>
      </li>
      <li>
        <div class="base-card base-search-card job-search-card" data-entity-urn="urn:li:jobPosting:4152639999">
          <a class="base-card__full-link" href="https://www.linkedin.com/jobs/view/content-developer-technical-curriculum-4152639999">
            <span class="sr-only">Content Developer - Technical Curriculum</span>
          </a>
          <div class="base-search-card__info">
            <h3 class="base-search-card__title">Content Developer - Technical Curriculum</h3>
            <h4 class="base-search-card__subtitle">Microsoft</h4>
            <div class="base-search-card__metadata">
              <span class="job-search-card__location">Redmond, WA (Hybrid)</span>
              <time class="job-search-card__listdate" datetime="2026-08-19">5 hours ago</time>
            </div>
          </div>
        </div>
      </li>
    </ul>
  `;

  beforeEach(() => {
    storeData = {
      jobRadarConfig: {
        enabled: true,
        queries: ['Technical Writer', 'Content Developer'],
        location: 'Remote',
        timeFilter: 'r86400',
        lastScannedAt: null
      },
      jobListings: []
    };

    mockStore = {
      load: vi.fn(() => storeData),
      save: vi.fn((d) => { storeData = d; })
    };

    engine = new JobRadarEngine(mockStore);
  });

  it('correctly parses LinkedIn public job cards and extracts metadata', () => {
    const jobs = engine.parseLinkedInHtml(sampleLinkedInHtml, 'Technical Writer');
    expect(jobs).toHaveLength(2);

    expect(jobs[0].jobId).toBe('4152637482');
    expect(jobs[0].title).toBe('Senior Technical Writer - Developer Docs');
    expect(jobs[0].company).toBe('Stripe');
    expect(jobs[0].companyUrl).toBe('https://www.linkedin.com/company/stripe');
    expect(jobs[0].location).toBe('United States (Remote)');
    expect(jobs[0].postedTimeStr).toBe('3 hours ago');
    expect(jobs[0].url).toBe('https://www.linkedin.com/jobs/view/senior-technical-writer-developer-docs-4152637482');
    expect(jobs[0].query).toBe('Technical Writer');
    expect(jobs[0].status).toBe('new');

    expect(jobs[1].jobId).toBe('4152639999');
    expect(jobs[1].title).toBe('Content Developer - Technical Curriculum');
    expect(jobs[1].company).toBe('Microsoft');
    expect(jobs[1].location).toBe('Redmond, WA (Hybrid)');
  });

  it('deduplicates listings across multiple scan passes', async () => {
    vi.spyOn(engine, 'fetchLinkedInJobs').mockResolvedValue([
      {
        id: 'li-101',
        jobId: '101',
        title: 'Technical Writer',
        company: 'GitLab',
        location: 'Remote',
        postedTimeStr: '1 hour ago',
        url: 'https://www.linkedin.com/jobs/view/101',
        query: 'Technical Writer',
        status: 'new',
        firstSeenAt: new Date().toISOString()
      }
    ]);

    // Pass 1
    const res1 = await engine.runJobScan();
    expect(res1.newJobsCount).toBe(1);
    expect(storeData.jobListings).toHaveLength(1);

    // Pass 2 (same job should be deduplicated)
    const res2 = await engine.runJobScan();
    expect(res2.newJobsCount).toBe(0);
    expect(storeData.jobListings).toHaveLength(1);
  });

  it('filters job listings by status, search keyword, and query category', () => {
    storeData.jobListings = [
      { id: '1', jobId: '1', title: 'Senior Technical Writer', company: 'Google', location: 'Remote', status: 'new', query: 'Technical Writer' },
      { id: '2', jobId: '2', title: 'Content Developer II', company: 'Amazon', location: 'Seattle', status: 'saved', query: 'Content Developer' },
      { id: '3', jobId: '3', title: 'API Documentation Lead', company: 'Stripe', location: 'Remote', status: 'applied', query: 'Technical Writer' }
    ];

    // Status filter
    const saved = engine.getListings({ status: 'saved' });
    expect(saved.listings).toHaveLength(1);
    expect(saved.listings[0].company).toBe('Amazon');

    // Keyword search
    const searchStripe = engine.getListings({ search: 'Stripe' });
    expect(searchStripe.listings).toHaveLength(1);
    expect(searchStripe.listings[0].title).toBe('API Documentation Lead');

    // Query filter
    const contentDevs = engine.getListings({ query: 'Content Developer' });
    expect(contentDevs.listings).toHaveLength(1);
    expect(contentDevs.listings[0].title).toBe('Content Developer II');
  });

  it('updates listing status correctly (save, apply, dismiss)', () => {
    storeData.jobListings = [
      { id: '100', jobId: '100', title: 'Technical Writer', company: 'Meta', status: 'new' }
    ];

    const updated = engine.updateListingStatus('100', 'applied');
    expect(updated.status).toBe('applied');
    expect(storeData.jobListings[0].status).toBe('applied');
  });

  it('generates a fresh daily summary for Hermes briefing', () => {
    storeData.jobListings = [
      { id: '1', jobId: '1', title: 'Technical Writer - Cloud Docs', company: 'AWS', postedTimeStr: '2 hours ago', firstSeenAt: new Date().toISOString(), status: 'new' },
      { id: '2', jobId: '2', title: 'Technical Content Developer', company: 'Anthropic', postedTimeStr: '4 hours ago', firstSeenAt: new Date().toISOString(), status: 'saved' }
    ];

    const summary = engine.getDailySummary();
    expect(summary.totalFresh).toBe(2);
    expect(summary.topListings).toHaveLength(2);
  });
});
