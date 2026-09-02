// Claude proofread pass for document analysis/rewrite turns — a stopgap
// added 2026-08-04 after a real bug: the local model corrupted a date
// (2024->2014) and fabricated a statistic ("3+ product lines" -> "over
// 30%") on a real resume rewrite, and its OWN confidence self-rating didn't
// catch either (it "felt" confident despite being wrong — self-rated
// confidence isn't a reliable signal for this specific failure mode).
// Deliberately unconditional for any turn that included an attached
// document, rather than gated on the model's own confidence check, and
// deliberately separate from confidenceEscalation.cjs — that one is about
// general factual uncertainty, this one is specifically about document
// fidelity (numbers/dates/claims matching the source). Meant to be a
// temporary safety net, not a permanent architecture — see the
// "Programming & Web Development"-style category this could eventually
// tie into on the skills dashboard once local-model reliability on this
// task is actually tracked and provably good enough to stop needing it.
const { MODELS, geminiUrl } = require('./models.cjs');
const CLAUDE_MODEL = MODELS.CLAUDE;

async function proofreadDocumentRewrite({ originalDocument, localResponse }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set in .env — document proofreading is disabled.');

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2500,
    messages: [{
      role: 'user',
      content: `A local AI assistant analyzed and/or rewrote a document. Proofread its response against the ORIGINAL document below. Specifically check for: any number, percentage, or date in the response that is fabricated or doesn't match the original; any factual claim not actually supported by the source; any date range that doesn't make chronological sense.

ORIGINAL DOCUMENT:
${originalDocument}

ASSISTANT'S RESPONSE TO PROOFREAD:
${localResponse}

If everything checks out (no fabricated numbers/dates, no unsupported claims, all dates correct), reply with EXACTLY: "PROOFREAD: CLEAN" and nothing else.
If you find any issues, start with "PROOFREAD: ISSUES FOUND" then list each specific issue concisely — what's wrong, and what the original actually says.`
    }]
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude declined to proofread this document.');
  }
  const textBlock = response.content.find((b) => b.type === 'text');
  if (!textBlock) throw new Error('Claude returned no text content.');

  const text = textBlock.text.trim();
  const clean = /^PROOFREAD:\s*CLEAN/i.test(text);
  const notes = text.replace(/^PROOFREAD:\s*(CLEAN|ISSUES FOUND)\s*/i, '').trim();
  return { clean, notes };
}

const { normalizeDocumentToMarkdown } = require('./mineruNormalizer.cjs');

const DOCUMENT_PATTERN = /\[Attached Document:.*?\]\nContent:\n([\s\S]*)\n\nUser Request:/;

function extractAttachedDocument(rawUserMessage) {
  const match = DOCUMENT_PATTERN.exec(rawUserMessage || '');
  if (!match) return null;
  return normalizeDocumentToMarkdown(match[1]);
}

module.exports = { proofreadDocumentRewrite, extractAttachedDocument, normalizeDocumentToMarkdown };
