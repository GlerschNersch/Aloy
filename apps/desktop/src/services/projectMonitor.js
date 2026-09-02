// Projects & Builds monitoring — local-only, Desktop App (Electron) required.
// Every action here targets a folder/command the user explicitly configured
// in the Projects panel; nothing here is reachable from model output.
import { fetchWithTimeout } from './fetchWithTimeout.js';

export async function pickProjectFolder() {
  if (window.electronAPI?.selectFolder) {
    return await window.electronAPI.selectFolder();
  }
  return null;
}

export async function getGitStatus(folderPath) {
  if (!window.electronAPI?.getGitStatus) return { isGitRepo: false };
  try {
    return await window.electronAPI.getGitStatus(folderPath);
  } catch (err) {
    console.error('Git status check error:', err);
    return { isGitRepo: false };
  }
}

export async function checkPortOpen(port) {
  if (!port || !window.electronAPI?.checkPort) return false;
  try {
    return await window.electronAPI.checkPort(Number(port));
  } catch (err) {
    console.error('Port check error:', err);
    return false;
  }
}

export async function listListeningPorts() {
  if (window.electronAPI?.listPorts) {
    try {
      return await window.electronAPI.listPorts();
    } catch (err) {
      console.error('List ports error:', err);
    }
  }
  try {
    const res = await fetchWithTimeout('/api/ports', {}, 3000);
    return res.ok ? await res.json() : [];
  } catch {
    return [];
  }
}

export async function killPortProcess(port) {
  if (window.electronAPI?.killPortProcess) {
    try {
      return await window.electronAPI.killPortProcess(Number(port));
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
  try {
    const res = await fetchWithTimeout('/api/ports/kill', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ port: Number(port) })
    }, 4000);
    return res.ok ? await res.json() : { success: false, error: 'Failed to kill port process' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

export async function runBuildCommand(folderPath, command) {
  if (!window.electronAPI?.runBuildCommand) {
    return { success: false, error: 'Build checks are only available in the Desktop App.' };
  }
  try {
    return await window.electronAPI.runBuildCommand(folderPath, command);
  } catch (err) {
    return { success: false, error: err.message || 'Build command failed to run.' };
  }
}

// Fetches a project's live status endpoint (e.g. a local Flask/Node dev
// server's JSON status route). In the Electron renderer, routed through the
// main process so it isn't subject to the target server's CORS headers. In
// a plain Node context (the backend server, services/aloyServer.cjs), CORS
// doesn't apply at all — there's no window/electronAPI bridge to use, so
// fetch the URL directly instead.
export async function fetchProjectStatus(url) {
  if (!url) return null;
  try {
    if (typeof window !== 'undefined' && window.electronAPI?.fetchStatusUrl) {
      const res = await window.electronAPI.fetchStatusUrl(url);
      return res.success ? res.data : null;
    }
    const res = await fetchWithTimeout(url, {}, 10000);
    return res.ok ? await res.json() : null;
  } catch (err) {
    console.error('Project status fetch error:', err);
    return null;
  }
}

// Formats a fetched status payload into a compact context block for the AI
// prompt. Recognizes the common { status_message, progress_pct, logs }
// shape used by simple local status endpoints (e.g. AutoRipManager's
// /api/status); falls back to a truncated raw JSON dump for anything else.
export function formatProjectStatusContext(projectName, statusData) {
  if (!statusData || typeof statusData !== 'object') return '';
  const state = statusData.state || statusData;
  let ctx = `[LIVE PROJECT STATUS: ${projectName}]\n`;

  if (state.status_message) ctx += `Status: ${state.status_message}\n`;
  if (typeof state.progress_pct === 'number') ctx += `Progress: ${state.progress_pct}%\n`;
  if (Array.isArray(state.logs) && state.logs.length > 0) {
    ctx += `Recent Log Lines:\n${state.logs.slice(-15).join('\n')}\n`;
  }
  if (Array.isArray(statusData.history) && statusData.history.length > 0) {
    ctx += `Most Recently Completed: ${JSON.stringify(statusData.history[0])}\n`;
  }

  if (!state.status_message && !Array.isArray(state.logs)) {
    ctx += `${JSON.stringify(statusData).slice(0, 1500)}\n`;
  }

  return ctx;
}

// Extracts a normalized summary from a project's status payload for the
// ProjectStatusCard widget — a structured alternative to the model's
// free-form prose, so the UI doesn't depend on the LLM reliably restating
// numbers correctly. Tolerant of shapes that don't match; returns null if
// there's nothing usable at all.
export function parseProjectStatusSummary(statusData) {
  if (!statusData || typeof statusData !== 'object') return null;
  const state = statusData.state || statusData;

  const progressPct = typeof state.progress_pct === 'number' ? state.progress_pct : null;
  const statusMessage = state.status_message || null;

  // Look for a "STAGE x/y: label" marker in the most recent matching log
  // line (e.g. AutoRipManager's "=== STAGE 1/3: MAKEMKV DISC EXTRACTION
  // STARTED ==="). Falls back to no step info if the shape doesn't match.
  let step = null;
  if (Array.isArray(state.logs)) {
    for (let i = state.logs.length - 1; i >= 0; i--) {
      const match = state.logs[i].match(/STAGE\s+(\d+)\s*\/\s*(\d+)\s*:\s*([A-Za-z0-9 ]+?)(?:\s+STARTED\b|\s*\(|\s*===|$)/i);
      if (match) {
        step = {
          current: parseInt(match[1], 10),
          total: parseInt(match[2], 10),
          label: match[3].trim().toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
        };
        break;
      }
    }
  }

  const lastCompleted = Array.isArray(statusData.history) && statusData.history.length > 0
    ? statusData.history[0]
    : null;

  if (progressPct === null && !statusMessage && !lastCompleted) return null;

  return { statusMessage, progressPct, step, lastCompleted };
}
