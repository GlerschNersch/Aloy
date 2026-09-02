// Centralized, safe Markdown rendering.
// - Restores syntax highlighting (marked v18 removed the `highlight` option).
// - Sanitizes the resulting HTML with DOMPurify to prevent XSS from model
//   output or injected web-search / RAG / calendar content.
import { marked } from 'marked';
import hljs from 'highlight.js';
import DOMPurify from 'dompurify';
import 'highlight.js/styles/tokyo-night-dark.css';

const renderer = new marked.Renderer();

// marked v9+ passes a token object to renderer methods.
renderer.code = function ({ text, lang }) {
  const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
  const highlighted = hljs.highlight(text, { language }).value;
  return `<pre><code class="hljs language-${language}">${highlighted}</code></pre>`;
};

marked.setOptions({ breaks: true });
marked.use({ renderer });

// Rendering a message costs a marked parse, a highlight.js pass over every code
// block, and a DOMPurify sanitize. ChatArea calls this for EVERY message in the
// history on EVERY render, and a streaming reply re-renders on every token — so
// a 40-message conversation re-highlights 40 messages a few dozen times a
// second while the assistant is talking, to produce byte-identical output each
// time.
//
// renderMarkdown is pure (same text in, same HTML out), so the result is safe
// to cache on the text itself. Only the streaming message actually changes
// between renders; everything above it now hits the cache.
//
// Bounded so a long session can't grow it without limit. Insertion-ordered Map
// = cheapest possible LRU: delete-then-set moves a key to the newest position,
// and the oldest key is always the first one the iterator yields.
const CACHE_LIMIT = 300;
const cache = new Map();

export function renderMarkdown(text) {
  const key = text || '';

  const hit = cache.get(key);
  if (hit !== undefined) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  const rawHtml = marked.parse(key);
  // Block javascript: URLs and inline event handlers; allow safe target=_blank rel.
  const html = DOMPurify.sanitize(rawHtml, {
    ADD_ATTR: ['target', 'rel'],
    FORBID_ATTR: ['style'],
    ALLOW_DATA_ATTR: false
  });

  cache.set(key, html);
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value);
  return html;
}

// Exposed for tests and for anywhere that needs a clean slate; not needed in
// normal operation since the cache is self-bounding.
export function _clearMarkdownCache() {
  cache.clear();
}
