// Research pipeline for the research_topic/save_researched_knowledge tools
// (src/services/tools.js). Reuses the same Anthropic client setup as
// confidenceEscalation.cjs, but with Claude's web_search server tool enabled
// instead of answering from memory — the web search + citations ARE the
// verification step, so this is one API call, not a separate draft-then-
// fact-check pipeline.
const { httpFetch, TIMEOUTS } = require('./http.cjs');
const { MODELS, geminiUrl } = require('./models.cjs');
const CLAUDE_MODEL = MODELS.CLAUDE;

async function researchTopic({ topic }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set in .env — research is disabled.');

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    // Both budgets bumped 2026-08-10 after a live failure: this model runs
    // web_search through an implicit code_execution sandbox, where a single
    // code block can issue 3+ web_search() calls in a loop instead of one
    // top-level search per turn (the older, simpler tool-use pattern these
    // budgets were originally sized for). Reproduced directly against the
    // API: max_uses=5/max_tokens=2048 exhausted the search budget after
    // ~1.5 code_execution rounds and separately got cut off mid-answer with
    // stop_reason:'max_tokens' (adaptive thinking alone ran ~2000 tokens).
    // max_uses=10/max_tokens=8192 reliably reached stop_reason:'end_turn'
    // with a complete, well-cited answer on the same topic.
    max_tokens: 8192,
    messages: [{
      role: 'user',
      content: `Research this topic using web search and write a concise, accurate summary suitable for a permanent knowledge note — a few sentences to a short paragraph, not an essay. Ground it in what you actually find, not prior assumptions.\n\nTopic: ${topic}`
    }]
  });

  if (response.stop_reason === 'refusal') {
    throw new Error('Claude declined to research this topic.');
  }

  // Text blocks carry the summary; citations (when present) point at the
  // real sources behind specific claims. web_search_tool_result blocks list
  // what was actually searched — content is an array on success, an error
  // object on failure (e.g. max_uses_exceeded), so check before indexing.
  let summary = '';
  const sources = [];
  const addSource = (url, title) => {
    if (url && !sources.some((s) => s.url === url)) sources.push({ url, title: title || url });
  };

  for (const block of response.content) {
    if (block.type === 'text') {
      summary += block.text;
      if (Array.isArray(block.citations)) {
        for (const c of block.citations) addSource(c.url, c.title);
      }
    } else if (block.type === 'web_search_tool_result' && Array.isArray(block.content)) {
      for (const r of block.content) addSource(r.url, r.title);
    }
  }

  summary = summary.trim();
  if (!summary) throw new Error('Claude returned no summary text for this topic.');
  return { topic, summary, sources };
}

async function researchTopicWithGemini({ topic }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set in .env.');

  const prompt = `Research this topic using search and write a concise, accurate summary suitable for a permanent knowledge note — a few sentences to a short paragraph. Topic: ${topic}`;
  const res = await httpFetch(geminiUrl(apiKey), {
    timeoutMs: TIMEOUTS.API,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }]
    })
  });

  if (!res.ok) throw new Error(`Gemini API returned HTTP ${res.status}`);
  const data = await res.json();
  const candidate = data.candidates?.[0];
  const summary = candidate?.content?.parts?.[0]?.text || '';
  const sources = [];

  const chunks = candidate?.groundingMetadata?.groundingChunks || [];
  for (const chunk of chunks) {
    if (chunk.web?.uri) {
      if (!sources.some((s) => s.url === chunk.web.uri)) {
        sources.push({ url: chunk.web.uri, title: chunk.web.title || chunk.web.uri });
      }
    }
  }

  if (!summary.trim()) throw new Error('Gemini returned no summary text for this topic.');
  return { topic, summary: summary.trim(), sources };
}

async function researchTopicSafe({ topic }) {
  try {
    return await researchTopic({ topic });
  } catch (err) {
    console.warn('[research:topic] Claude research error/quota, falling back to Gemini:', err.message);
    try {
      return await researchTopicWithGemini({ topic });
    } catch (geminiErr) {
      throw new Error(`Research failed on both Claude (${err.message}) and Gemini (${geminiErr.message})`);
    }
  }
}

module.exports = { researchTopic: researchTopicSafe };
