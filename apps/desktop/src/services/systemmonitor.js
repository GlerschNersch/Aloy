// 100% Local Desktop Vision, System Telemetry & OS Command Client Service
import { fetchWithTimeout } from './fetchWithTimeout.js';
import { sidecarAuthHeaders } from './sidecarAuth.js';

const MONITOR_SERVER_URL = 'http://localhost:8889';

export async function fetchPCTelemetry() {
  try {
    const res = await fetchWithTimeout(`${MONITOR_SERVER_URL}/telemetry`, { method: 'GET', headers: await sidecarAuthHeaders() }, 5000);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.warn('System monitor server offline:', err);
  }
  return null;
}

export async function fetchDesktopScreenshot() {
  try {
    const res = await fetchWithTimeout(`${MONITOR_SERVER_URL}/screenshot`, { method: 'GET', headers: await sidecarAuthHeaders() }, 15000);
    if (res.ok) {
      const data = await res.json();
      return data.image_data_url || null;
    }
  } catch (err) {
    console.error('Desktop screenshot capture error:', err);
  }
  return null;
}

export async function learnMemoryFact(fact) {
  try {
    const res = await fetchWithTimeout(`${MONITOR_SERVER_URL}/learn_memory`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await sidecarAuthHeaders()) },
      body: JSON.stringify({ fact })
    }, 10000);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.error('Auto-memory learning error:', err);
  }
  return null;
}

export async function executeOSCommand(command) {
  try {
    const res = await fetchWithTimeout(`${MONITOR_SERVER_URL}/exec_command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await sidecarAuthHeaders()) },
      body: JSON.stringify({ command })
    }, 60000);
    if (res.ok) {
      return await res.json();
    }
  } catch (err) {
    console.error('OS command execution error:', err);
  }
  return null;
}
