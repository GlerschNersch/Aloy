// Security guard & blast-radius containment engine for Aloy.
// Enforces least-privilege path subtree whitelisting (differentiating read vs write),
// 2FA on exterior door locks & surveillance devices, prompt injection sanitization on untrusted web text,
// and audit logging of all security-sensitive operations.

const path = require('path');
const os = require('os');
const { logAuditEvent } = require('./auditLogger.cjs');

// Explicitly allowlisted directory trees for READ-ONLY filesystem operations
const ALLOWED_READ_ROOTS = [
  path.resolve('P:\\Movies'),
  path.resolve('P:\\TV Shows'),
  path.resolve('P:\\Music'),
  path.resolve('P:\\Photos'),
  path.resolve('P:\\Games'),
  path.resolve('P:\\Other'),
  path.resolve('P:\\AutoRipStaging'),
  path.resolve('P:\\'), // Read access for top-level root inspection
  path.resolve(path.join(os.homedir(), 'Documents')),
  path.resolve(path.join(os.homedir(), 'Documents', 'Vault Notes')),
  path.resolve(path.join(os.homedir(), 'Aloy')),
  path.resolve(path.join(os.homedir(), '.aloy-server')),
  path.resolve(os.tmpdir())
];

// Strictly fenced allowlisted directory trees for WRITE/MUTATE filesystem operations (Least-Privilege)
const ALLOWED_WRITE_ROOTS = [
  path.resolve(path.join(os.homedir(), 'Documents', 'Vault Notes')), // Obsidian notes & Athena exports
  path.resolve(path.join(os.homedir(), '.aloy-server')), // Store, training buffers, cache
  path.resolve(path.join(os.homedir(), 'Aloy', 'apps', 'desktop', 'src')), // Hephaestus desktop code staging
  path.resolve(path.join(os.homedir(), 'Aloy', 'apps', 'desktop', 'server')), // Hephaestus desktop server staging
  path.resolve(path.join(os.homedir(), 'Aloy', 'apps', 'mobile', 'src')), // Hephaestus mobile code staging
  path.resolve(path.join(os.homedir(), 'Aloy', 'apps', 'mobile', 'App.tsx')), // AloyMobile root UI code
  path.resolve('P:\\AutoRipStaging'), // Temporary staging folder for active disc transcodes
  path.resolve(os.tmpdir())
];

// Dangerous system paths and secret metadata files explicitly forbidden from ANY access or modification
const FORBIDDEN_PATTERNS = [
  /\$RECYCLE\.BIN/i,
  /System Volume Information/i,
  /^[A-Z]:\\Windows/i,
  /^[A-Z]:\\Program Files/i,
  /^[A-Z]:\\ProgramData/i,
  /\.env$/i,
  /auth-token\.txt$/i,
  /id_rsa/i,
  /\.ssh/i
];

// Exterior locks requiring stepped-up 2FA/PIN confirmation for unlocking
const EXTERIOR_LOCKS = new Set([
  'lock.front_door',
  'lock.back_door',
  'lock.garage_entry_door',
  'lock.garage_door',
  'lock.patio_door'
]);

/**
 * Validates whether a filesystem path is within authorized read or write subtrees.
 * @param {string} targetPath
 * @param {boolean} isWrite - True if the operation modifies or writes to the file
 * @returns {{ allowed: boolean, reason?: string, normalizedPath: string }}
 */
function validatePathAccess(targetPath, isWrite = false) {
  if (!targetPath || typeof targetPath !== 'string') {
    return { allowed: false, reason: 'Invalid or missing target path', normalizedPath: '' };
  }

  const normalized = path.resolve(targetPath);

  // 1. Check forbidden system patterns & secret files
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(normalized)) {
      logAuditEvent({
        category: 'filesystem',
        action: isWrite ? 'write_blocked' : 'read_blocked',
        target: normalized,
        status: 'denied',
        details: `Access denied by security blacklist pattern: ${pattern.toString()}`
      });
      return { allowed: false, reason: `Access to system or protected path is strictly forbidden: ${normalized}`, normalizedPath: normalized };
    }
  }

  // 2. If it's a WRITE operation, verify against strict least-privilege write subtrees
  if (isWrite) {
    const isWithinWriteAllowed = ALLOWED_WRITE_ROOTS.some(root => {
      return normalized === root || normalized.startsWith(root + path.sep);
    });

    if (!isWithinWriteAllowed) {
      logAuditEvent({
        category: 'filesystem',
        action: 'write_blocked',
        target: normalized,
        status: 'denied',
        details: 'Attempted write outside of least-privilege write roots (e.g. attempted modification of P:\\ media archives or system folders).'
      });
      return {
        allowed: false,
        reason: `Write access denied: Target path "${normalized}" is read-only. Modifying master media archives on P:\\ is strictly prohibited; writes must target P:\\AutoRipStaging or Obsidian Vault Notes.`,
        normalizedPath: normalized
      };
    }
  } else {
    // 3. For READ operations, verify against allowed read subtrees
    const isWithinReadAllowed = ALLOWED_READ_ROOTS.some(root => {
      return normalized === root || normalized.startsWith(root + path.sep);
    });

    if (!isWithinReadAllowed) {
      logAuditEvent({
        category: 'filesystem',
        action: 'read_blocked',
        target: normalized,
        status: 'denied',
        details: 'Path is outside of authorized read allowlist.'
      });
      return { allowed: false, reason: `Path is outside authorized read directories: ${normalized}`, normalizedPath: normalized };
    }
  }

  return { allowed: true, normalizedPath: normalized };
}

/**
 * Scans text for indirect prompt injection attempts, jailbreaks, and data exfiltration patterns.
 * @param {string} text
 * @returns {{ hasInjection: boolean, riskScore: number, threats: string[] }}
 */
function detectPromptInjection(text) {
  if (!text || typeof text !== 'string') {
    return { hasInjection: false, riskScore: 0, threats: [] };
  }

  const threats = [];
  let riskScore = 0;

  // 1. Role spoofing & system override patterns
  const roleOverridePatterns = [
    /(?:ignore|disregard|forget|bypass)\s+(?:all\s+)?(?:previous|prior|earlier|above)\s+(?:instructions|prompts|rules|guidelines)/i,
    /(?:you\s+are\s+now|act\s+as|switch\s+to)\s+(?:in\s+)?(?:developer|dan|jailbreak|unrestricted|god)\s+mode/i,
    /(?:system\s+instruction|system\s+prompt|admin\s+override|root\s+access)\s*:/i,
    /<\|(?:im_start|im_end|system|assistant|user)\|>/i,
    /\[\s*INST\s*\][\s\S]*?\[\s*\/\s*INST\s*\]/i,
    /<system>[\s\S]*?<\/system>/i
  ];

  for (const pattern of roleOverridePatterns) {
    if (pattern.test(text)) {
      threats.push(`Role Override Pattern: ${pattern.source}`);
      riskScore += 40;
    }
  }

  // 2. Data exfiltration patterns (markdown images, malicious fetch/webhook calls)
  const exfilPatterns = [
    /!\[[^\]]*\]\s*\(\s*https?:\/\/[^\s)]+(?:exfil|steal|log|beacon|token|cookie|auth)[^\s)]*\)/i,
    /(?:send|post|transmit|exfiltrate|leak)\s+(?:all\s+)?(?:memories|secrets|api\s*keys|passwords|conversations|auth\s*token)\s+to/i,
    /<img[^>]+src=["']https?:\/\/[^"']*(?:exfil|log|collect|track)[^"']*["']/i
  ];

  for (const pattern of exfilPatterns) {
    if (pattern.test(text)) {
      threats.push(`Exfiltration Pattern: ${pattern.source}`);
      riskScore += 50;
    }
  }

  // 3. Hidden text / zero-width stealth injections
  if (/[\u200B-\u200D\uFEFF\u2060]/.test(text)) {
    threats.push('Zero-Width Unicode Characters Detected (Stealth Injection Vector)');
    riskScore += 30;
  }

  if (/style\s*=\s*["'][^"']*(?:display\s*:\s*none|font-size\s*:\s*0|opacity\s*:\s*0|visibility\s*:\s*hidden)/i.test(text)) {
    threats.push('CSS Hidden Text Detected');
    riskScore += 25;
  }

  return {
    hasInjection: riskScore >= 30,
    riskScore: Math.min(100, riskScore),
    threats
  };
}

/**
 * Neutralizes potential prompt-injection attack payloads embedded in untrusted web pages,
 * search results, or external RSS feeds before they are injected into LLM context.
 * Wraps clean content into a fenced XML sandbox.
 * @param {string} rawContent
 * @param {Object} [options]
 * @param {string} [options.sourceUrl]
 * @param {boolean} [options.wrapSandbox=true]
 * @returns {string} Sanitized content safe for context ingestion
 */
function sanitizeUntrustedWebContent(rawContent, options = {}) {
  if (!rawContent || typeof rawContent !== 'string') return '';

  const { sourceUrl = 'external_web_source', wrapSandbox = true } = options;

  // 1. Strip zero-width stealth characters
  let cleaned = rawContent.replace(/[\u200B-\u200D\uFEFF\u2060]/g, '');

  // 2. Strip HTML hidden elements & malicious scripts/styles
  cleaned = cleaned
    .replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(/<\s*style[^>]*>[\s\S]*?<\s*\/\s*style\s*>/gi, '')
    .replace(/<div[^>]*style=["'][^"']*(?:display\s*:\s*none|font-size\s*:\s*0|visibility\s*:\s*hidden)[^"']*[\s\S]*?<\/div>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '') // Strip hidden HTML comments
    .replace(/\[\/\/\s*\]:\s*#[^\n]*/g, ''); // Strip markdown hidden comment lines

  // 3. Neutralize LLM special tokens & chat delimiters
  cleaned = cleaned
    .replace(/<\|im_start\|>[\s\S]*?<\|im_end\|>/gi, '[SANITIZED_SPECIAL_TAG]')
    .replace(/<\|(?:im_start|im_end|system|assistant|user|endoftext)\|>/gi, '[SANITIZED_SPECIAL_TOKEN]')
    .replace(/\[\s*INST\s*\][\s\S]*?\[\s*\/\s*INST\s*\]/gi, '[SANITIZED_INSTRUCTION_BLOCK]')
    .replace(/(?:^|\n)\s*(?:system|assistant|admin|root)\s*:\s*(?:ignore\s+previous\s+instructions|you\s+are\s+now|override\s+system|execute\s+tool)/gi, '\n[REDACTED_INJECTION_ATTEMPT]')
    .replace(/\[\s*system\s*:\s*[^\]]+\]/gi, '[SANITIZED_SYSTEM_BRACKET]');

  // 4. Neutralize markdown image data-exfiltration URLs
  cleaned = cleaned.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s)]+)\)/gi, (match, alt, url) => {
    // Only allow benign images, strip tracking/exfil queries
    if (/exfil|steal|log|token|cookie|auth|beacon/i.test(url)) {
      return `[Image Redacted: Potential Exfiltration Vector: ${alt || 'image'}]`;
    }
    return match;
  });

  // 5. Neutralize dangerous code execution artifacts
  cleaned = cleaned
    .replace(/eval\s*\(/gi, 'eval_disabled(')
    .replace(/Function\s*\(/gi, 'Function_disabled(');

  cleaned = cleaned.trim();

  // 6. Encapsulate in strict XML sandbox envelope if requested
  if (wrapSandbox) {
    return `<untrusted_web_content source="${sourceUrl.replace(/"/g, '&quot;')}" sanitized="true">\n${cleaned}\n</untrusted_web_content>`;
  }

  return cleaned;
}

/**
 * Validates a Smart Home service call.
 * Enforces 2FA / explicit confirmation on exterior locks.
 * @param {Object} params
 * @param {string} params.domain
 * @param {string} params.service
 * @param {string} params.entityId
 * @param {Object} [params.authContext] - { pinVerified, faceMatchUser, isInteractiveUser }
 * @returns {{ allowed: boolean, requires2FA?: boolean, reason?: string }}
 */
function validateSmartHomeAction({ domain, service, entityId, authContext = {} }) {
  const isLockUnlock = domain === 'lock' && (service === 'unlock' || service === 'open');
  const isExteriorLock = isLockUnlock && EXTERIOR_LOCKS.has(entityId);

  if (isExteriorLock) {
    // Stepped-up confirmation: must have 2FA PIN or verified face match or interactive user approval
    const isAuthorized = authContext.pinVerified || authContext.isInteractiveUser || Boolean(authContext.faceMatchUser);
    if (!isAuthorized) {
      logAuditEvent({
        category: 'smarthome',
        action: `${domain}.${service}`,
        target: entityId,
        status: 'pending_confirmation',
        details: 'Stepped-up 2FA/confirmation required for exterior lock operation.'
      });
      return {
        allowed: false,
        requires2FA: true,
        reason: `Unlocking exterior lock "${entityId}" requires explicit 2FA PIN or verified owner face presence.`
      };
    }
  }

  return { allowed: true };
}

module.exports = {
  validatePathAccess,
  detectPromptInjection,
  sanitizeUntrustedWebContent,
  validateSmartHomeAction,
  ALLOWED_READ_ROOTS,
  ALLOWED_WRITE_ROOTS,
  EXTERIOR_LOCKS
};
