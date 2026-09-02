// CLI-Hub Runner for Aloy — harvested from HKUDS/CLI-Anything.
// Provides discovery, search, inspection, and safe execution of CLI-Anything
// harnesses and public CLIs from the CLI-Hub ecosystem.
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { wrapToolSuccess, wrapToolError } = require('./toolEnvelope.cjs');

// Common installation locations for cli-hub executable on Windows / POSIX
const CANDIDATE_PATHS = [
  path.join(os.homedir(), 'AppData', 'Local', 'Python', 'pythoncore-3.14-64', 'Scripts', 'cli-hub.exe'),
  path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python312', 'Scripts', 'cli-hub.exe'),
  path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python311', 'Scripts', 'cli-hub.exe'),
  path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'Python', 'Python310', 'Scripts', 'cli-hub.exe'),
  path.join(os.homedir(), '.local', 'bin', 'cli-hub'),
  '/usr/local/bin/cli-hub',
  '/usr/bin/cli-hub'
];

let cachedCliHubPath = null;

function resolveCliHubPath(overridePath = null) {
  if (overridePath) return overridePath;
  if (cachedCliHubPath && fs.existsSync(cachedCliHubPath)) return cachedCliHubPath;

  for (const p of CANDIDATE_PATHS) {
    if (fs.existsSync(p)) {
      cachedCliHubPath = p;
      return p;
    }
  }

  // Fallback to command name if on PATH
  return 'cli-hub';
}

function runCliHubCommand(args, { timeoutMs = 15000, cliPath = null } = {}) {
  return new Promise((resolve) => {
    const bin = resolveCliHubPath(cliPath);
    execFile(bin, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        // If executable not found or execution failed
        return resolve({
          success: false,
          exitCode: err.code || 1,
          stdout: (stdout || '').trim(),
          stderr: (stderr || err.message || '').trim(),
          error: err.message
        });
      }
      resolve({
        success: true,
        exitCode: 0,
        stdout: (stdout || '').trim(),
        stderr: (stderr || '').trim()
      });
    });
  });
}

/**
 * Search available harnesses in the CLI-Hub registry
 */
async function searchCliHub(query, options = {}) {
  const cleanQuery = String(query || '').trim();
  if (!cleanQuery) {
    return wrapToolError('Query parameter cannot be empty', { code: 'INVALID_ARGUMENT' });
  }

  const res = await runCliHubCommand(['search', cleanQuery], options);
  if (!res.success) {
    return wrapToolError(`CLI-Hub search failed: ${res.stderr || res.error}`, {
      code: 'SEARCH_FAILED',
      recoveryHint: 'Ensure cli-anything-hub is installed via python -m pip install cli-anything-hub'
    });
  }

  const lines = res.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const results = [];
  let current = null;

  for (const line of lines) {
    // Matches e.g. "obsidian [knowledge] — Knowledge management"
    const match = line.match(/^([a-zA-Z0-9_\-]+)\s+\[([a-zA-Z0-9_\-]+)\]\s*(?:bundled|public|harness)?\s*[-—]\s*(.*)$/i);
    if (match) {
      if (current) results.push(current);
      current = {
        name: match[1],
        category: match[2],
        description: match[3],
        installCommand: `cli-hub install ${match[1]}`
      };
    } else if (line.startsWith('Install:') && current) {
      current.installCommand = line.replace(/^Install:\s*/, '').trim();
    } else if (current && !current.details) {
      current.details = line;
    }
  }
  if (current) results.push(current);

  return wrapToolSuccess({
    query: cleanQuery,
    count: results.length,
    results: results.length > 0 ? results : [{ raw: res.stdout }]
  });
}

/**
 * Get detailed metadata and skill information for a harness
 */
async function getCliHubInfo(name, options = {}) {
  const toolName = String(name || '').trim();
  if (!toolName) {
    return wrapToolError('Tool name parameter cannot be empty', { code: 'INVALID_ARGUMENT' });
  }

  const res = await runCliHubCommand(['info', toolName], options);
  if (!res.success) {
    return wrapToolError(`Failed to fetch info for '${toolName}': ${res.stderr || res.error}`, {
      code: 'INFO_FAILED',
      recoveryHint: `Use search_cli_tools to verify the harness name '${toolName}'`
    });
  }

  const lines = res.stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  const metadata = { name: toolName, raw: res.stdout };

  for (const line of lines) {
    const parts = line.split(':');
    if (parts.length >= 2) {
      const key = parts[0].trim().toLowerCase().replace(/\s+/g, '_');
      const val = parts.slice(1).join(':').trim();
      metadata[key] = val;
    }
  }

  return wrapToolSuccess(metadata);
}

/**
 * Execute an installed CLI-Anything harness
 */
async function executeCliHubTool(toolName, commandArgs = [], options = {}) {
  const safeTool = String(toolName || '').trim();
  if (!safeTool) {
    return wrapToolError('Tool name cannot be empty', { code: 'INVALID_ARGUMENT' });
  }

  // Guard against path traversal / injection in toolName
  if (/[\\/;:|&`$]/.test(safeTool)) {
    return wrapToolError(`Invalid tool name "${safeTool}": contains prohibited characters`, {
      code: 'SECURITY_VIOLATION'
    });
  }

  const args = ['launch', safeTool, ...commandArgs];
  const res = await runCliHubCommand(args, options);

  if (!res.success) {
    return wrapToolError(`CLI-Anything execution failed for '${safeTool}': ${res.stderr || res.error}`, {
      code: 'EXECUTION_FAILED',
      exitCode: res.exitCode,
      rawOutput: res.stdout,
      recoveryHint: `Check if '${safeTool}' is installed via cli-hub install ${safeTool}`
    });
  }

  let parsedJson = null;
  try {
    parsedJson = JSON.parse(res.stdout);
  } catch {
    // Not json, return raw output
  }

  return wrapToolSuccess({
    tool: safeTool,
    args: commandArgs,
    result: parsedJson || res.stdout
  });
}

module.exports = {
  resolveCliHubPath,
  runCliHubCommand,
  searchCliHub,
  getCliHubInfo,
  executeCliHubTool,
  CANDIDATE_PATHS
};
