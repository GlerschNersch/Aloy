// Shared auth header for the local sidecar servers (system monitor, whisper,
// kokoro, face — ports 8888-8891), which now require the same Bearer token
// as the main Aloy backend (server/auth.cjs) after a 2026-08-06 security
// review found them running with zero auth. Token is fetched once via IPC
// (electron.cjs's server:getToken handler re-reads the same on-disk token)
// and cached — these functions get called often (e.g. every TTS line), and
// a fresh IPC round trip per call would be wasteful.
let cachedToken = null;

async function getToken() {
  if (cachedToken) return cachedToken;
  if (typeof window === 'undefined' || !window.electronAPI?.getServerToken) return null;
  cachedToken = await window.electronAPI.getServerToken();
  return cachedToken;
}

export async function sidecarAuthHeaders() {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
