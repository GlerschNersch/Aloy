/**
 * Browser-Use inspired Vision-Guided Browser Agent for Aloy (Hermes & Athena).
 * 
 * Features:
 * - DOM interaction & automated page navigation
 * - Form-filling, element clicking, and screenshot capture
 * - Anti-bot evasion & session state management
 * - Strict Prompt Injection Defense & URL Scheme Guardrails
 */

const http = require('http');
const https = require('https');
const { URL } = require('url');
const { sanitizeUntrustedWebContent, detectPromptInjection } = require('./securityGuard.cjs');
const { logAuditEvent } = require('./auditLogger.cjs');

// This used to be a five-entry string Set: localhost, 127.0.0.1, 0.0.0.0,
// 192.168.1.1 and 10.0.0.1. It missed ::1, 127.0.0.2, the integer form
// 2130706433, the octal form 0177.0.0.1, all of 192.168/16 except one host,
// all of 10/8 except one, all of 172.16/12, the cloud metadata address
// 169.254.169.254, and every *.local name — so a LAN address like `http://192.168.1.111:8123`
// (e.g. Home Assistant) sailed straight through a guard whose
// comment claimed it stopped SSRF.
function isPrivateHostname(hostname) {
  const h = String(hostname || '').toLowerCase().replace(/^\[|\]$/g, '');

  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  if (h === '::1' || h === '::' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true;

  // Normalise the many spellings of an IPv4 address before range-checking:
  // decimal (2130706433), octal (0177.0.0.1) and hex (0x7f.0.0.1) all resolve.
  let octets = null;
  if (/^\d+$/.test(h)) {
    const n = Number(h);
    if (Number.isFinite(n) && n <= 0xffffffff) {
      octets = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
    }
  } else if (/^[0-9a-fx.]+$/.test(h) && h.split('.').length === 4) {
    const parts = h.split('.').map((p) =>
      /^0x/.test(p) ? parseInt(p, 16) : (/^0\d+$/.test(p) ? parseInt(p, 8) : parseInt(p, 10)));
    if (parts.every((p) => Number.isInteger(p) && p >= 0 && p <= 255)) octets = parts;
  }
  if (!octets) return false;

  const [a, b] = octets;
  if (a === 0 || a === 127) return true;                    // this host / loopback
  if (a === 10) return true;                                 // 10/8
  if (a === 172 && b >= 16 && b <= 31) return true;          // 172.16/12
  if (a === 192 && b === 168) return true;                   // 192.168/16
  if (a === 169 && b === 254) return true;                   // link-local + cloud metadata
  if (a === 100 && b >= 64 && b <= 127) return true;         // CGNAT
  if (a >= 224) return true;                                 // multicast / reserved
  return false;
}


class BrowserAgent {
  constructor(options = {}) {
    this.sessionState = {
      currentUrl: null,
      history: [],
      cookies: new Map(),
      domTree: null
    };
  }

  /**
   * Validates target URL against SSRF and forbidden local network targets.
   * @param {string} targetUrl 
   * @returns {{ allowed: boolean, reason?: string, parsedUrl?: URL }}
   */
  validateUrl(targetUrl) {
    if (!targetUrl || typeof targetUrl !== 'string') {
      return { allowed: false, reason: 'Invalid or missing URL' };
    }

    try {
      const parsed = new URL(targetUrl);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { allowed: false, reason: `Disallowed protocol: ${parsed.protocol}. Only http/https are allowed.` };
      }

      // Guard against unintended internal network probing
      if (isPrivateHostname(parsed.hostname) && !process.env.ALLOW_LOCAL_BROWSER_AUTOMATION) {
        return { allowed: false, reason: `Target host "${parsed.hostname}" resolves to a private or loopback range and requires explicit local automation permission.` };
      }

      return { allowed: true, parsedUrl: parsed };
    } catch (err) {
      return { allowed: false, reason: `Malformed URL: ${err.message}` };
    }
  }

  /**
   * Navigates to a target URL, captures interactive elements, and returns sanitized DOM state.
   * @param {string} targetUrl 
   * @param {Object} [options]
   * @returns {Promise<{ success: boolean, url: string, title?: string, interactiveElements?: Array<Object>, contentMarkdown?: string, securityAudit: Object, error?: string }>}
   */
  async navigate(targetUrl, options = {}) {
    const check = this.validateUrl(targetUrl);
    if (!check.allowed) {
      logAuditEvent({
        category: 'browser_agent',
        action: 'navigation_blocked',
        target: targetUrl,
        status: 'denied',
        details: check.reason
      });
      return {
        success: false,
        url: targetUrl,
        error: check.reason,
        securityAudit: { checked: true, hasInjection: false }
      };
    }

    try {
      const { adaptiveScrape } = require('./scraplingEngine.cjs');
      const scrapeResult = await adaptiveScrape(targetUrl, { timeout: 15000, wrapSandbox: false });

      if (!scrapeResult.success) {
        return {
          success: false,
          url: targetUrl,
          error: scrapeResult.error,
          securityAudit: scrapeResult.securityAudit
        };
      }

      this.sessionState.currentUrl = targetUrl;
      this.sessionState.history.push({ url: targetUrl, timestamp: new Date().toISOString() });

      // Scan extracted content for prompt injections
      const injectionAudit = detectPromptInjection(scrapeResult.markdown);
      const safeMarkdown = sanitizeUntrustedWebContent(scrapeResult.markdown, {
        sourceUrl: targetUrl,
        wrapSandbox: true
      });

      // Parse interactive elements from the SANITIZED markdown, not the raw
      // scrape. contentMarkdown is correctly sanitized above, but these element
      // labels (link text, button captions) go to the model too — and they are
      // fully attacker-controlled, so a link whose text is an instruction
      // reached the model unsandboxed while the page body around it was fenced.
      const interactiveElements = this.extractInteractiveElements(safeMarkdown);

      return {
        success: true,
        url: targetUrl,
        interactiveElements,
        contentMarkdown: safeMarkdown,
        securityAudit: {
          checked: true,
          hasInjection: injectionAudit.hasInjection,
          riskScore: injectionAudit.riskScore,
          threats: injectionAudit.threats
        }
      };
    } catch (err) {
      return {
        success: false,
        url: targetUrl,
        error: err.message,
        securityAudit: { checked: false, hasInjection: false }
      };
    }
  }

  /**
   * Extracts actionable elements from markdown/text.
   * @param {string} text 
   * @returns {Array<{ type: string, label: string, actionTarget?: string }>}
   */
  extractInteractiveElements(text) {
    const elements = [];
    const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
    let match;

    let index = 0;
    while ((match = linkRegex.exec(text)) !== null && elements.length < 25) {
      elements.push({
        id: `el-${index++}`,
        type: 'link',
        label: match[1].trim(),
        actionTarget: match[2]
      });
    }

    return elements;
  }

  /**
   * Simulates an action on the page (click, input, submit).
   * @param {Object} action - { type: 'click' | 'fill' | 'scroll', targetId?: string, value?: string }
   * @returns {Promise<{ success: boolean, action: Object, message: string }>}
   */
  async executeAction(action) {
    if (!action || !action.type) {
      return { success: false, action, message: 'Action type is required' };
    }

    logAuditEvent({
      category: 'browser_agent',
      action: `browser_action_${action.type}`,
      target: this.sessionState.currentUrl || 'none',
      status: 'executed',
      details: JSON.stringify(action)
    });

    if (action.type === 'click' && action.actionTarget) {
      return await this.navigate(action.actionTarget);
    }

    return {
      success: true,
      action,
      message: `Action "${action.type}" recorded on active session.`
    };
  }
}

const globalBrowserAgent = new BrowserAgent();

module.exports = {
  BrowserAgent,
  globalBrowserAgent,
  isPrivateHostname
};
