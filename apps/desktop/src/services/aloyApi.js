// The one way the renderer talks to Aloy's own HTTP API on :7890.
//
// WHY THIS EXISTS (audit, 2026-08-25): 40 of the 42 local-server fetches in
// this app were returning 401 and nobody could tell, because every one of them
// either wraps the call in `catch {}` or guards on `if (res.ok)`.
//
// server/aloyServer.cjs mounts `app.use(requireAuth(token))` before every /api
// route, so all of them need `Authorization: Bearer <token>`. What was actually
// being sent:
//
//   * 35 call sites sent no Authorization header at all.
//   * InboxView and AthenaWorkspace built one from
//     localStorage['aloy_server_auth_token'] — a key nothing in this repo ever
//     writes. getAuthHeaders() therefore always returned {}, which looks like
//     working auth code and is not.
//   * HudOverlay was the only caller doing it correctly, via
//     window.electronAPI.getServerToken().
//
// The app still felt fine because the desktop's primary paths are IPC; these
// HTTP calls back a second tier of features — the Jellyfin card, GPU/VRAM
// stats, the health capsule, the daily brief, and most of the Pantheon panels.
// Those just showed nothing, or kept an optimistic hardcoded default:
// jellyfinStatus started at { online: true, serverName: 'Aloy Server' } and the
// health capsule at batteryLevel 59 / 'Optimal', so a permanently failing fetch
// rendered as a confident, wrong widget rather than an error.
//
// This module uses HudOverlay's mechanism — the one that demonstrably worked —
// for every caller, and routes through fetchWithTimeout so none of them can
// hang. It is also the single definition of the server's base URL, which was
// previously copy-pasted into five files.
//
// Use apiFetch/apiJson for anything hitting :7890. A bare fetch() to that
// origin is a 401 waiting to happen.

import { fetchWithTimeout } from './fetchWithTimeout.js';

export const SERVER_BASE_URL =
  (typeof window !== 'undefined' && window.__VITE_SERVER_URL__) || 'http://localhost:7890';

// Cached because these calls are frequent (several panels poll on intervals)
// and each miss is an IPC round trip. Mirrors sidecarAuth.js, which solved the
// same problem for the 8888-8891 sidecars.
let cachedToken = null;

export async function getServerToken() {
  if (cachedToken) return cachedToken;

  // Preferred: ask the main process, which re-reads the same on-disk token the
  // server itself uses. This is what HudOverlay does.
  if (typeof window !== 'undefined' && window.electronAPI?.getServerToken) {
    try {
      const result = await window.electronAPI.getServerToken();
      // The IPC handler has returned both shapes over time; accept either
      // rather than silently producing "Bearer undefined".
      const token = typeof result === 'string' ? result : (result?.token || '');
      if (token) {
        cachedToken = token;
        return cachedToken;
      }
    } catch (err) {
      console.warn('[aloyApi] getServerToken IPC failed:', err?.message || err);
    }
  }

  // Fallback for any non-Electron context (a browser tab pointed at the dev
  // server). Nothing currently writes this key — kept so that setting it by
  // hand works for debugging, not as a mechanism to rely on.
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem('aloy_server_auth_token');
    if (stored) {
      cachedToken = stored;
      return cachedToken;
    }
  }

  return '';
}

export async function authHeaders() {
  const token = await getServerToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/**
 * fetch() against the local Aloy server, with auth and a timeout.
 *
 * `path` is normally a leading-slash path ('/api/jellyfin/status'); a full URL
 * is passed through so callers already holding one still work.
 *
 * Throws on timeout (see fetchWithTimeout) rather than hanging. It does NOT
 * throw on a non-2xx response — callers keep their existing `if (res.ok)`
 * checks — but a 401 is logged once so a broken token stops being invisible,
 * which is the failure this whole module exists to prevent.
 */
export async function apiFetch(path, options = {}, timeoutMs = 15000) {
  const url = /^https?:\/\//.test(path) ? path : `${SERVER_BASE_URL}${path}`;
  const headers = { ...(await authHeaders()), ...(options.headers || {}) };
  const res = await fetchWithTimeout(url, { ...options, headers }, timeoutMs);
  if (res.status === 401) {
    console.warn(`[aloyApi] 401 from ${url} — auth token missing or stale.`);
    cachedToken = null; // force a re-fetch next call, in case it rotated
  }
  return res;
}

/** apiFetch + res.json(), throwing with the status when the response isn't ok. */
export async function apiJson(path, options = {}, timeoutMs = 15000) {
  const res = await apiFetch(path, options, timeoutMs);
  if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}`);
  return res.json();
}

/** Clears the cached token. Call if the server restarts with a new one. */
export function resetServerToken() {
  cachedToken = null;
}
