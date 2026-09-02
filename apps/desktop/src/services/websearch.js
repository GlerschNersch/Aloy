// Free local DuckDuckGo web search integration helper
import { fetchWithTimeout } from './fetchWithTimeout.js';

export async function searchWeb(query) {
  try {
    const res = await fetchWithTimeout(`https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`, {}, 10000);
    if (!res.ok) return null;
    const data = await res.json();
    
    let resultsStr = `[LIVE WEB SEARCH RESULTS FOR: "${query}"]\n`;
    if (data.AbstractText) {
      resultsStr += `Summary: ${data.AbstractText}\nSource: ${data.AbstractURL || 'DuckDuckGo'}\n\n`;
    }

    if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
      data.RelatedTopics.slice(0, 5).forEach((item, idx) => {
        if (item.Text) {
          resultsStr += `${idx + 1}. ${item.Text}\n`;
        }
      });
    }

    return resultsStr;
  } catch (err) {
    console.error('Web search error:', err);
    return null;
  }
}
