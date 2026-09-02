// Remote Machines Bridge for Aloy
// Connects to local network machines (Bazzite, Lenny, etc.) via SSH and provides
// hardware telemetry, remote command execution, and one-click terminal session launching.

const { exec } = require('child_process');
const net = require('net');
const { logAuditEvent } = require('./auditLogger.cjs');

const MACHINES = {
  bazzite: {
    id: 'bazzite',
    name: 'Bazzite Gaming Station',
    host: process.env.BAZZITE_HOST || '192.168.1.111',
    hostname: 'bazzite.local',
    username: process.env.BAZZITE_USER || 'bazzite',
    port: parseInt(process.env.BAZZITE_PORT || '22', 10),
    // Read at call time from the environment so the secret stays server-side.
    // It used to be inlined in BazziteRemoteCard.jsx, which meant it shipped in
    // the renderer bundle and was echoed back into the on-screen command log.
    sudoPassEnv: 'BAZZITE_SUDO_PASS',
    icon: 'Gamepad2',
    description: 'Fedora/Bazzite 44 Gaming System'
  },
  lenny: {
    id: 'lenny',
    name: 'Lenny Server',
    host: process.env.LENNY_HOST || '192.168.1.106',
    hostname: 'lenny.local',
    username: process.env.LENNY_USER || 'lenny',
    port: parseInt(process.env.LENNY_PORT || '22', 10),
    sudoPassEnv: 'LENNY_SUDO_PASS',
    icon: 'Server',
    description: 'Ubuntu 26.04 LTS System'
  }
};

function getMachineConfig(machineId = 'bazzite') {
  const key = String(machineId).toLowerCase();
  return MACHINES[key] || MACHINES.bazzite;
}

/**
 * Checks if SSH port 22 is responding on target host
 */
function checkPortOpen(host, port = 22, timeout = 3000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let isResolved = false;

    socket.setTimeout(timeout);

    socket.once('connect', () => {
      isResolved = true;
      socket.destroy();
      resolve(true);
    });

    socket.once('timeout', () => {
      if (!isResolved) {
        isResolved = true;
        socket.destroy();
        resolve(false);
      }
    });

    socket.once('error', () => {
      if (!isResolved) {
        isResolved = true;
        socket.destroy();
        resolve(false);
      }
    });

    socket.connect(port, host);
  });
}

/**
 * Executes a command on the target machine over SSH using base64 script piping
 */
function executeRemoteCommand(machineId = 'bazzite', command = '', timeoutMs = 20000, { elevated = false } = {}) {
  return new Promise((resolve) => {
    const config = getMachineConfig(machineId);
    const host = config.host;
    const user = config.username;

    // `elevated` is how a caller asks for sudo WITHOUT ever seeing the
    // password. The secret is read here, used to build the payload, and never
    // returned to the caller or logged — `command` (the un-elevated text) is
    // what appears in the audit entry and in the UI's command echo.
    let payload = command;
    if (elevated) {
      const pass = process.env[config.sudoPassEnv];
      if (!pass) {
        return resolve({
          machineId: config.id,
          success: false,
          stdout: '',
          stderr: `Elevated command requested but ${config.sudoPassEnv} is not set in the server environment.`,
          exitCode: 1
        });
      }
      // Password and command both travel inside the base64 blob, so neither is
      // parsed by the local shell and neither appears in this machine's
      // process list.
      payload = `echo ${JSON.stringify(pass)} | sudo -S -p '' ${command}`;
    }

    // This is the most dangerous operation in the app and was the only
    // high-risk path with no audit trail at all. Log intent before running.
    logAuditEvent({
      category: 'remote_exec',
      action: elevated ? 'remote_command_elevated' : 'remote_command',
      target: `${user}@${host}`,
      status: 'pending_confirmation',
      payload: { machineId: config.id, command, elevated },
      details: `Executing on ${config.name}`
    });

    const b64 = Buffer.from(payload).toString('base64');
    const sshCmd = `ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5 ${user}@${host} "echo ${b64} | base64 -d | bash"`;

    exec(sshCmd, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        logAuditEvent({
          category: 'remote_exec', action: 'remote_command', target: `${user}@${host}`,
          status: 'error', payload: { machineId: config.id, command, elevated },
          details: String(stderr || error.message || '').slice(0, 300)
        });
        resolve({
          machineId: config.id,
          success: false,
          stdout: stdout ? stdout.trim() : '',
          stderr: stderr ? stderr.trim() : error.message,
          exitCode: error.code || 1
        });
      } else {
        logAuditEvent({
          category: 'remote_exec', action: 'remote_command', target: `${user}@${host}`,
          status: 'success', payload: { machineId: config.id, command, elevated }
        });
        resolve({
          machineId: config.id,
          success: true,
          stdout: stdout ? stdout.trim() : '',
          stderr: stderr ? stderr.trim() : '',
          exitCode: 0
        });
      }
    });
  });
}

/**
 * Gathers telemetry from a specific machine
 */
async function getMachineStatus(machineId = 'bazzite') {
  const config = getMachineConfig(machineId);
  const isOnline = await checkPortOpen(config.host, config.port, 3000);

  if (!isOnline) {
    return {
      id: config.id,
      name: config.name,
      online: false,
      host: config.host,
      hostname: config.hostname,
      user: config.username,
      error: 'Machine unreachable or SSH service inactive'
    };
  }

  // Probe telemetry
  const probeScript = `
echo "---UPTIME---"
uptime -p 2>/dev/null || uptime
echo "---OS---"
grep PRETTY_NAME /etc/os-release 2>/dev/null | cut -d= -f2 | tr -d '"'
echo "---KERNEL---"
uname -r
echo "---CPU---"
lscpu | grep 'Model name' | cut -d: -f2 | xargs
echo "---MEM---"
free -m | awk '/Mem:/ {print $3","$2}'
echo "---DISK---"
(df -h /var/home 2>/dev/null || df -h / 2>/dev/null) | awk 'NR==2 {print $3","$2","$4","$5}'
echo "---THERMALS---"
sensors 2>/dev/null | awk '/Package id 0:/ {print $4} /temp1:/ {print $2}' | tr -d '+°C' | head -n 2
echo "---VERSION---"
rpm-ostree status 2>/dev/null | awk '/●/ {found=1} found && /Version:/ {print $2; exit}' || lsb_release -d 2>/dev/null | cut -f2 || echo ""
`;

  const res = await executeRemoteCommand(config.id, probeScript, 10000);

  if (!res.success) {
    return {
      id: config.id,
      name: config.name,
      online: true,
      host: config.host,
      hostname: config.hostname,
      user: config.username,
      error: res.stderr || 'Failed to fetch telemetry'
    };
  }

  const sections = {};
  let currentKey = 'init';
  for (const line of res.stdout.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('---') && trimmed.endsWith('---')) {
      currentKey = trimmed.replace(/---/g, '').toLowerCase();
      sections[currentKey] = [];
    } else if (trimmed && sections[currentKey]) {
      sections[currentKey].push(trimmed);
    }
  }

  const memParts = (sections.mem?.[0] || '').split(',');
  const diskLines = sections.disk || [];
  const diskLine = diskLines.find(l => l.includes('%') || l.includes(',')) || diskLines[0] || '';
  let diskParts = diskLine.includes(',') ? diskLine.split(',') : diskLine.split(/\s+/).slice(2, 6);

  const thermals = sections.thermals || [];

  return {
    id: config.id,
    name: config.name,
    online: true,
    host: config.host,
    hostname: config.hostname,
    user: config.username,
    uptime: sections.uptime?.[0] || 'Up',
    os: sections.os?.[0] || (config.id === 'bazzite' ? 'Bazzite' : 'Ubuntu'),
    version: sections.version?.[0] || '',
    kernel: sections.kernel?.[0] || 'Linux',
    cpu: sections.cpu?.[0] || 'Intel Processor',
    ram: {
      usedMb: parseInt(memParts[0] || '0', 10),
      totalMb: parseInt(memParts[1] || '0', 10),
      label: memParts[1] ? `${Math.round(parseInt(memParts[0], 10) / 1024)}GB / ${Math.round(parseInt(memParts[1], 10) / 1024)}GB` : 'N/A'
    },
    disk: {
      used: diskParts[0] || '0G',
      total: diskParts[1] || '0G',
      avail: diskParts[2] || '0G',
      percent: diskParts[3] || '0%'
    },
    cpuTemp: thermals[0] ? `${thermals[0]}°C` : null,
    gpuTemp: thermals[1] ? `${thermals[1]}°C` : null,
    lastChecked: new Date().toISOString()
  };
}

/**
 * Gathers telemetry from all configured machines simultaneously
 */
async function getAllMachinesStatus() {
  const machineKeys = Object.keys(MACHINES);
  const results = await Promise.all(machineKeys.map(key => getMachineStatus(key)));
  const statusMap = {};
  for (const item of results) {
    statusMap[item.id] = item;
  }
  return {
    machines: results,
    statusMap
  };
}

/**
 * Spawns an interactive native Windows Terminal or PowerShell window directly connected to target machine
 */
function launchRemoteTerminal(machineId = 'bazzite') {
  return new Promise((resolve) => {
    const config = getMachineConfig(machineId);
    const host = config.host;
    const user = config.username;
    const title = `${config.name} (${host})`;

    const wtCmd = `wt.exe -p "PowerShell" --title "${title}" ssh ${user}@${host}`;

    exec(wtCmd, (wtErr) => {
      if (!wtErr) {
        return resolve({ success: true, method: 'Windows Terminal', machineId: config.id });
      }

      // Fallback: spawn powershell.exe directly
      const psCmd = `start powershell.exe -NoExit -Command "Write-Host 'Connecting to ${config.name} at ${host}...' -ForegroundColor Cyan; ssh ${user}@${host}"`;
      exec(psCmd, (psErr) => {
        if (psErr) {
          resolve({ success: false, error: psErr.message, machineId: config.id });
        } else {
          resolve({ success: true, method: 'PowerShell', machineId: config.id });
        }
      });
    });
  });
}

// Backward compatibility helpers
const BAZZITE_CONFIG = MACHINES.bazzite;
const executeBazziteCommand = (cmd, timeout) => executeRemoteCommand('bazzite', cmd, timeout);
const getBazziteStatus = () => getMachineStatus('bazzite');
const launchBazziteTerminal = () => launchRemoteTerminal('bazzite');

module.exports = {
  MACHINES,
  getMachineConfig,
  checkPortOpen,
  executeRemoteCommand,
  getMachineStatus,
  getAllMachinesStatus,
  launchRemoteTerminal,
  // Backwards compatibility
  BAZZITE_CONFIG,
  executeBazziteCommand,
  getBazziteStatus,
  launchBazziteTerminal
};
