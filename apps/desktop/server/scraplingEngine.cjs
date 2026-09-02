/**
 * Scrapling & Crawl4AI-inspired Adaptive Web Scraping Engine for Aloy (Athena & Hermes).
 * 
 * Features:
 * - Self-healing element fingerprinting heuristic (locates content even if classes/layout shifted)
 * - Resilient anti-bot header rotation & stealth fetch simulation
 * - LLM-optimized Markdown extraction with semantic section chunking
 * - Mandatory Prompt Injection Defense & Sanitization via securityGuard.cjs
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { sanitizeUntrustedWebContent, detectPromptInjection } = require('./securityGuard.cjs');
const { logAuditEvent } = require('./auditLogger.cjs');

// Modern desktop user agents for stealth requests
const STEALTH_USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36'
];

/**
 * Executes a stealth HTTP GET request with anti-bot headers.
 * @param {string} targetUrl 
 * @param {Object} [options]
 * @returns {Promise<{ html: string, statusCode: number, headers: Object }>}
 */
function fetchStealth(targetUrl, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(targetUrl);
      const isHttps = parsedUrl.protocol === 'https:';
      const client = isHttps ? https : http;

      const ua = STEALTH_USER_AGENTS[Math.floor(Math.random() * STEALTH_USER_AGENTS.length)];
      const reqHeaders = {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'identity', // Simplify stream decoding
        'Sec-Ch-Ua': '"Not)A;Brand";v="99", "Google Chrome";v="127", "Chromium";v="127"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
        ...(options.headers || {})
      };

      const req = client.request(parsedUrl, {
        method: 'GET',
        headers: reqHeaders,
        timeout: options.timeout || 12000
      }, (res) => {
        // The comment here said "up to 5 times" and `redirectCount` was
        // incremented and then never read anywhere, so a server answering
        // 302 -> itself recursed until the stack blew. Worse, only the FIRST
        // url was ever validated: every subsequent hop skipped the SSRF check
        // entirely, so any page could redirect to 127.0.0.1:11434 or
        // 169.254.169.254 and have the contents fed into a model prompt.
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          const redirectCount = (options.redirectCount || 0) + 1;
          if (redirectCount > 5) {
            return resolve({ html: '', statusCode: res.statusCode, headers: res.headers,
              error: 'Too many redirects (limit 5).' });
          }
          const redirectUrl = new URL(res.headers.location, targetUrl).toString();

          // Re-validate EVERY hop, not just the first.
          try {
            const { isPrivateHostname } = require('./browserAgent.cjs');
            const hop = new URL(redirectUrl);
            if (!['http:', 'https:'].includes(hop.protocol) || isPrivateHostname(hop.hostname)) {
              return resolve({ html: '', statusCode: res.statusCode, headers: res.headers,
                error: `Redirect to a disallowed target was blocked: ${hop.protocol}//${hop.hostname}` });
            }
          } catch {
            return resolve({ html: '', statusCode: res.statusCode, headers: res.headers,
              error: 'Malformed redirect target.' });
          }

          return resolve(fetchStealth(redirectUrl, { ...options, redirectCount }));
        }

        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
          if (data.length > 5 * 1024 * 1024) { // Cap at 5MB
            req.destroy();
            resolve({ html: data, statusCode: res.statusCode, headers: res.headers });
          }
        });
        res.on('end', () => resolve({ html: data, statusCode: res.statusCode, headers: res.headers }));
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error(`Fetch timed out after ${options.timeout || 12000}ms for ${targetUrl}`));
      });
      req.on('error', (err) => reject(err));
      req.end();
    } catch (e) {
      reject(e);
    }
  });
}

/**
 * Scrapling-inspired Self-Healing Parser:
 * Extracts elements from HTML using fingerprints (tag, semantic role, text keywords)
 * if primary CSS selectors or class names have changed.
 * @param {string} html 
 * @param {Object} [fingerprint]
 * @returns {Array<{ tag: string, text: string, href?: string }>}
 */
function extractWithFingerprint(html, fingerprint = {}) {
  const { targetKeywords = [], fallbackTags = ['article', 'main', 'section', 'div', 'p', 'h1', 'h2', 'h3', 'li'] } = fingerprint;
  const results = [];

  // Remove scripts, styles, noscript, svg
  const cleanedHtml = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '');

  // Extract text blocks
  const blockRegex = /<(h[1-6]|p|li|article|section|div|span|a)([^>]*)>([\s\S]*?)<\/\1>/gi;
  let match;

  while ((match = blockRegex.exec(cleanedHtml)) !== null) {
    const tag = match[1].toLowerCase();
    const attrs = match[2];
    let inner = match[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    if (!inner || inner.length < 3) continue;

    // Check for links
    let href = null;
    const hrefMatch = /href=["']([^"']+)["']/i.exec(attrs);
    if (hrefMatch) href = hrefMatch[1];

    // If keywords specified, prioritize matching elements (Self-healing fingerprint matching)
    if (targetKeywords.length > 0) {
      const matchesKeyword = targetKeywords.some(kw => inner.toLowerCase().includes(kw.toLowerCase()));
      if (matchesKeyword) {
        results.push({ tag, text: inner, href });
      }
    } else {
      // General extraction for main content tags
      if (['h1', 'h2', 'h3', 'p', 'article', 'section'].includes(tag) || (tag === 'li' && inner.length > 10)) {
        results.push({ tag, text: inner, href });
      }
    }
  }

  return results;
}

/**
 * Crawl4AI-inspired Clean Markdown Transformer:
 * Converts extracted web text into structured, LLM-ready Markdown.
 * @param {string} html 
 * @param {string} [sourceUrl]
 * @returns {string} Clean Markdown
 */
function htmlToLlmMarkdown(html, sourceUrl = '') {
  const elements = extractWithFingerprint(html);
  if (!elements || elements.length === 0) return '';

  const mdLines = [];
  const seenTexts = new Set();

  for (const el of elements) {
    const cleanText = el.text.trim();
    if (seenTexts.has(cleanText)) continue;
    seenTexts.add(cleanText);

    if (el.tag === 'h1') {
      mdLines.push(`\n# ${cleanText}\n`);
    } else if (el.tag === 'h2') {
      mdLines.push(`\n## ${cleanText}\n`);
    } else if (el.tag === 'h3') {
      mdLines.push(`\n### ${cleanText}\n`);
    } else if (el.tag === 'li') {
      mdLines.push(`- ${cleanText}`);
    } else {
      if (el.href && !el.href.startsWith('javascript:')) {
        mdLines.push(`[${cleanText}](${el.href})`);
      } else {
        mdLines.push(cleanText);
      }
    }
  }

  return mdLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * End-to-end Adaptive Web Scrape for Athena and Hermes.
 * Automatically scans and neutralizes prompt injections before returning.
 * @param {string} targetUrl 
 * @param {Object} [options]
 * @returns {Promise<{ success: boolean, url: string, markdown: string, sanitizedContent: string, securityAudit: Object }>}
 */
async function adaptiveScrape(targetUrl, options = {}) {
  try {
    const { html, statusCode } = await fetchStealth(targetUrl, options);
    
    if (statusCode >= 400) {
      return {
        success: false,
        url: targetUrl,
        error: `HTTP Error ${statusCode}`,
        markdown: '',
        sanitizedContent: '',
        securityAudit: { checked: true, hasInjection: false }
      };
    }

    // Convert to LLM-friendly Markdown
    const rawMarkdown = htmlToLlmMarkdown(html, targetUrl);

    // Prompt Injection Defense Scan
    const injectionCheck = detectPromptInjection(rawMarkdown);
    if (injectionCheck.hasInjection) {
      logAuditEvent({
        category: 'web_scraper',
        action: 'prompt_injection_detected',
        target: targetUrl,
        status: 'sanitized',
        details: `Detected threats: ${injectionCheck.threats.join(', ')} (Risk Score: ${injectionCheck.riskScore})`
      });
    }

    // Sanitize and sandbox
    const sanitized = sanitizeUntrustedWebContent(rawMarkdown, {
      sourceUrl: targetUrl,
      wrapSandbox: options.wrapSandbox !== false
    });

    return {
      success: true,
      url: targetUrl,
      markdown: rawMarkdown,
      sanitizedContent: sanitized,
      securityAudit: {
        checked: true,
        hasInjection: injectionCheck.hasInjection,
        riskScore: injectionCheck.riskScore,
        threats: injectionCheck.threats
      }
    };
  } catch (err) {
    return {
      success: false,
      url: targetUrl,
      error: err.message,
      markdown: '',
      sanitizedContent: '',
      securityAudit: { checked: false, hasInjection: false }
    };
  }
}

module.exports = {
  fetchStealth,
  extractWithFingerprint,
  htmlToLlmMarkdown,
  adaptiveScrape,
  STEALTH_USER_AGENTS
};
