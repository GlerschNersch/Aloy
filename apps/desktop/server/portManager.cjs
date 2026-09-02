/**
 * PortPal-inspired Port Inspector & Process Killer Engine for Aloy (Hephaestus & Minerva)
 * 
 * Features:
 * 1. Fast scanning of active listening TCP ports with PID and process name resolution.
 * 2. Smart Framework & Service Detection (Vite, Ollama, Aloy, Jellyfin, Home Assistant, Next.js, Node, Python).
 * 3. Safe, one-click process termination with system PID protection (prevents killing PID 0, 4, or critical Windows binaries).
 * 4. Conflict detection before launching test/dev servers.
 */

const { execSync } = require('child_process');
const os = require('os');
const net = require('net');
const { logAuditEvent } = require('./auditLogger.cjs');

// System critical PIDs and process names that must NEVER be terminated
const SYSTEM_CRITICAL_PIDS = new Set([0, 4]);
const SYSTEM_CRITICAL_NAMES = new Set([
  'system', 'smss.exe', 'csrss.exe', 'wininit.exe', 'services.exe', 'lsass.exe',
  'svchost.exe', 'winlogon.exe', 'dwm.exe', 'explorer.exe', 'kernel'
]);

// Well-known developer ports & framework mappings
const KNOWN_PORT_MAP = {
  5173: 'Vite Dev Server',
  3000: 'React / Next.js Dev',
  8080: 'Web / Dev Server',
  8000: 'FastAPI / Django / Python Server',
  7890: 'Aloy Core Server',
  11434: 'Ollama LLM Engine',
  8096: 'Jellyfin Media Server',
  8123: 'Home Assistant Hub',
  6379: 'Redis Cache',
  5432: 'PostgreSQL DB',
  3306: 'MySQL / MariaDB',
  27017: 'MongoDB Server'
};

/**
 * Checks if a specific TCP port is actively listening.
 * @param {number} port
 * @param {string} [host='127.0.0.1']
 * @returns {Promise<boolean>}
 */
function isPortOpen(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(400);

    socket.on('connect', () => {
      socket.destroy();
      resolve(true);
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve(false);
    });

    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.connect(Number(port), host);
  });
}

/**
 * Builds a fast in-memory map of PID -> Process Name using a single CLI call.
 * @returns {Map<number, string>}
 */
function getProcessMap() {
  const map = new Map();
  try {
    if (process.platform === 'win32') {
      const output = execSync('tasklist /FO CSV /NH', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 2500 });
      const lines = output.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        // Format: "Image Name","PID","Session Name","Session#","Mem Usage"
        const match = trimmed.match(/^"([^"]+)","(\d+)"/);
        if (match) {
          map.set(parseInt(match[2], 10), match[1]);
        }
      }
    } else {
      const output = execSync('ps -eo pid,comm', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 2500 });
      const lines = output.split('\n').slice(1);
      for (const line of lines) {
        const match = line.trim().match(/^(\d+)\s+(.+)$/);
        if (match) {
          map.set(parseInt(match[1], 10), match[2].trim());
        }
      }
    }
  } catch (err) {
    console.warn('[PortManager] Failed to get process map:', err.message);
  }
  return map;
}

/**
 * Scans all active listening TCP ports on the system.
 * @returns {Array<{ port: number, pid: number, processName: string, localAddress: string, service: string, isProtected: boolean }>}
 */
function listListeningPorts() {
  const results = [];
  const seenPorts = new Set();
  const processMap = getProcessMap();

  try {
    if (process.platform === 'win32') {
      const output = execSync('netstat -ano -p tcp', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 2500 });
      const lines = output.split('\n');

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.includes('LISTENING')) continue;

        // Example: TCP    127.0.0.1:5173         0.0.0.0:0              LISTENING       14220
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 5) {
          const localAddr = parts[1];
          const pid = parseInt(parts[parts.length - 1], 10);
          const portMatch = localAddr.match(/:(\d+)$/);

          if (portMatch && !isNaN(pid)) {
            const port = parseInt(portMatch[1], 10);
            if (seenPorts.has(port)) continue;
            seenPorts.add(port);

            const processName = processMap.get(pid) || (SYSTEM_CRITICAL_PIDS.has(pid) ? 'System' : 'unknown');
            const isProtected = SYSTEM_CRITICAL_PIDS.has(pid) || SYSTEM_CRITICAL_NAMES.has(processName.toLowerCase());
            const service = KNOWN_PORT_MAP[port] || (processName !== 'unknown' ? processName : 'Local Service');

            results.push({
              port,
              pid,
              processName,
              localAddress: localAddr,
              service,
              isProtected
            });
          }
        }
      }
    } else {
      // Unix / macOS lsof fallback
      const output = execSync('lsof -iTCP -sTCP:LISTEN -n -P', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 2500 });
      const lines = output.split('\n').slice(1);

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 9) {
          const processName = parts[0];
          const pid = parseInt(parts[1], 10);
          const namePart = parts[8];
          const portMatch = namePart.match(/:(\d+)$/);

          if (portMatch && !isNaN(pid)) {
            const port = parseInt(portMatch[1], 10);
            if (seenPorts.has(port)) continue;
            seenPorts.add(port);

            const isProtected = pid <= 1;
            const service = KNOWN_PORT_MAP[port] || processName;

            results.push({
              port,
              pid,
              processName,
              localAddress: namePart,
              service,
              isProtected
            });
          }
        }
      }
    }
  } catch (err) {
    console.warn('[PortManager] Failed to scan listening ports:', err.message);
  }

  return results.sort((a, b) => a.port - b.port);
}

/**
 * Retrieves process details for a specific port.
 * @param {number} port
 * @returns {{ port: number, pid: number, processName: string, service: string, isProtected: boolean } | null}
 */
function getProcessForPort(port) {
  const numPort = Number(port);
  const all = listListeningPorts();
  return all.find(p => p.port === numPort) || null;
}

/**
 * Safely kills the process occupying a specific port.
 * @param {number} port
 * @param {Object} [options]
 * @returns {Promise<{ success: boolean, port: number, pid?: number, processName?: string, error?: string }>}
 */
async function killProcessOnPort(port, options = {}) {
  const numPort = Number(port);
  const info = getProcessForPort(numPort);

  if (!info) {
    return { success: false, port: numPort, error: `No process is currently listening on port ${numPort}.` };
  }

  if (info.isProtected) {
    return { success: false, port: numPort, error: `Process "${info.processName}" (PID ${info.pid}) is system-protected and cannot be terminated.` };
  }

  try {
    if (process.platform === 'win32') {
      execSync(`taskkill /PID ${info.pid} /F /T`, { stdio: ['pipe', 'pipe', 'ignore'] });
    } else {
      execSync(`kill -9 ${info.pid}`, { stdio: ['pipe', 'pipe', 'ignore'] });
    }

    logAuditEvent('PORT_KILL_SUCCESS', { port: numPort, pid: info.pid, processName: info.processName });
    return {
      success: true,
      port: numPort,
      pid: info.pid,
      processName: info.processName
    };
  } catch (err) {
    logAuditEvent('PORT_KILL_FAILED', { port: numPort, pid: info.pid, error: err.message });
    return { success: false, port: numPort, pid: info.pid, error: err.message };
  }
}

module.exports = {
  isPortOpen,
  listListeningPorts,
  getProcessForPort,
  killProcessOnPort,
  KNOWN_PORT_MAP
};
