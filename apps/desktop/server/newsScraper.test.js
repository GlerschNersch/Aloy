import { describe, it, expect } from 'vitest';
import {
  parseStandardRssFeed,
  normalizeNewsSources,
  scoreRelevance
} from './newsScraper.cjs';

describe('News Scraper Native RSS & Feed Engine', () => {
  it('parses standard RSS 2.0 XML feeds with CDATA and unescapes entities', () => {
    const mockRssXml = `
      <?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Tech News Feed</title>
          <item>
            <title><![CDATA[New Vulnerability Found in OpenSSL &amp; Linux]]></title>
            <link>https://example.com/security/openssl-vuln</link>
            <description>Security researchers identified a memory flaw.</description>
          </item>
          <item>
            <title>React 19 Server Components Explained</title>
            <link>https://example.com/react-19-actions</link>
          </item>
        </channel>
      </rss>
    `;

    const source = { id: 'test-rss', name: 'Test Feed', url: 'https://example.com/rss' };
    const articles = parseStandardRssFeed(mockRssXml, source);

    expect(articles.length).toBe(2);
    expect(articles[0].title).toBe('New Vulnerability Found in OpenSSL & Linux');
    expect(articles[0].url).toBe('https://example.com/security/openssl-vuln');
    expect(articles[0].sourceName).toBe('Test Feed');

    expect(articles[1].title).toBe('React 19 Server Components Explained');
    expect(articles[1].url).toBe('https://example.com/react-19-actions');
  });

  it('parses Atom XML feeds with entry and link href attributes', () => {
    const mockAtomXml = `
      <?xml version="1.0" encoding="utf-8"?>
      <feed xmlns="http://www.w3.org/2005/Atom">
        <title>Atom Feed</title>
        <entry>
          <title>Exploring Linux Kernel 6.14 Schedulers</title>
          <link href="https://lwn.net/Articles/123456/" rel="alternate"/>
        </entry>
      </feed>
    `;

    const source = { id: 'test-atom', name: 'LWN', url: 'https://lwn.net/headlines/rss' };
    const articles = parseStandardRssFeed(mockAtomXml, source);

    expect(articles.length).toBe(1);
    expect(articles[0].title).toBe('Exploring Linux Kernel 6.14 Schedulers');
    expect(articles[0].url).toBe('https://lwn.net/Articles/123456/');
  });

  it('correctly normalizes and auto-detects source types', () => {
    const rawSources = [
      { id: '1', name: 'Ars', url: 'https://feeds.arstechnica.com/arstechnica/index' },
      { id: '2', name: 'Hackaday', url: 'https://hackaday.com/feed/' },
      { id: '3', name: 'Fireship', url: 'https://youtube.com/@fireship' },
      { id: '4', name: 'Generic Site', url: 'https://example.com/blog' }
    ];

    const normalized = normalizeNewsSources(rawSources);
    expect(normalized[0].type).toBe('rss');
    expect(normalized[1].type).toBe('rss');
    expect(normalized[2].type).toBe('youtube');
    expect(normalized[3].type).toBe('web');
  });

  it('falls back cleanly in scoreRelevance when no interests are configured', async () => {
    const article = { title: 'New Linux Kernel Released' };
    const res = await scoreRelevance(article, []);
    expect(res.relevant).toBe(true);
    expect(res.reason).toContain('No interest profile configured');
  });
});
