// Stock/ETF quote fetching for Hermes's portfolio tracking (server/hermes.cjs's
// getPortfolioSnapshot). Uses Yahoo Finance's public chart endpoint — no API
// key, no account, and it's already proven reliable for tracked symbols
// (e.g. AAPL, MSFT, NVDA) when this was built. If Yahoo ever rate-limits
// or changes this endpoint, a single symbol's failure is isolated (see fetchQuotes below) rather than taking
// down the whole snapshot.
//
// Network calls go through http.cjs's httpJson, per this codebase's one
// hard rule for outbound requests (see that file's own comment) — a bare
// fetch() here would fail the smoke gate.

const { httpJson } = require('./http.cjs');

const QUOTE_TIMEOUT_MS = 8000;

/**
 * Fetches a live quote for a single symbol. Never throws — returns
 * { symbol, ok, ...quote } or { symbol, ok: false, error }, so a caller
 * fetching several symbols can isolate one bad ticker from the rest.
 */
async function fetchQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const { ok, data, error, timedOut } = await httpJson(url, {
    timeoutMs: QUOTE_TIMEOUT_MS,
    headers: { 'User-Agent': 'Mozilla/5.0' } // Yahoo's endpoint 999s a default Node UA
  });

  if (!ok) return { symbol, ok: false, error: timedOut ? 'timed out' : (error || 'request failed') };

  const result = data?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta || typeof meta.regularMarketPrice !== 'number') {
    return { symbol, ok: false, error: data?.chart?.error?.description || 'no quote data returned' };
  }

  const price = meta.regularMarketPrice;
  const previousClose = meta.previousClose ?? meta.chartPreviousClose ?? price;
  const change = price - previousClose;
  const changePercent = previousClose ? (change / previousClose) * 100 : 0;

  return {
    symbol,
    ok: true,
    name: meta.shortName || meta.longName || symbol,
    price,
    previousClose,
    change: Number(change.toFixed(4)),
    changePercent: Number(changePercent.toFixed(2)),
    currency: meta.currency || 'USD',
    fetchedAt: new Date().toISOString()
  };
}

/**
 * Fetches quotes for multiple symbols in parallel. One symbol failing
 * (delisted ticker, a transient Yahoo hiccup) never blocks the others —
 * each result carries its own ok/error rather than the whole call rejecting.
 */
async function fetchQuotes(symbols) {
  return Promise.all(symbols.map(fetchQuote));
}

module.exports = { fetchQuote, fetchQuotes };
