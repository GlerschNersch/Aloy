// Lightweight, no-dependency guard against auto-learning (researching +
// permanently saving into learnedKnowledge, which gets injected into every
// future prompt) content that contains real secrets or PII. This is NOT a
// general DLP tool — a coarse pre-check specifically for the automated
// nightly teaching pipeline (server/skillsDashboard.cjs's
// runNightlyAutoTeaching), harvested from KiroCrew's "skip sensitive paths
// before skill/lesson extraction" pattern. False positives just cause an
// entry to be skipped from auto-learning (safe failure mode) rather than
// silently letting something sensitive through, so patterns here are
// deliberately broad rather than precise.
const SENSITIVE_PATTERNS = [
  /AKIA[0-9A-Z]{16}/, // AWS access key id
  /-----BEGIN (RSA |EC |OPENSSH |DSA |)PRIVATE KEY-----/,
  /ssh-(rsa|ed25519|dss) AAAA[0-9A-Za-z+/]{20,}/,
  /\b(api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b\s*[:=]\s*['"]?[A-Za-z0-9_\-.]{12,}/i,
  /\b(password|passwd|pwd)\b\s*[:=]\s*\S{4,}/i,
  /^[A-Z][A-Z0-9_]{2,}=\S+$/m, // .env-shaped KEY=VALUE line
  /\b\d{3}-\d{2}-\d{4}\b/, // SSN-shaped
  /\b(?:\d[ -]?){13,16}\b/ // credit-card-shaped digit run
];

function isSensitiveContent(text) {
  const s = String(text || '');
  return SENSITIVE_PATTERNS.some((re) => re.test(s));
}

module.exports = { isSensitiveContent };
