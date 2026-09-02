// MINDWALK ADAPTER — Bridges Antigravity & Hephaestus session traces into 3D Codebase Maps.
// Converts tool calls (read, edit, bash, search) into normalized traces for cosmtrek/mindwalk.

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const http = require('http');
const { validatePathAccess } = require('./securityGuard.cjs');

const MINDWALK_BIN = path.join(os.homedir(), 'bin', 'mindwalk.exe');
const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const MINDWALK_PORT = 8765;

let mindwalkProcess = null;

/**
 * Checks if the Mindwalk local web server is currently responding on port 8765.
 */
async function checkMindwalkLive(port = MINDWALK_PORT) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}`, { timeout: 1500 }, (res) => {
      resolve(res.statusCode === 200 || res.statusCode === 304);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

/**
 * Ensures the Mindwalk server is running in the background.
 */
async function ensureMindwalkRunning(port = MINDWALK_PORT) {
  const isLive = await checkMindwalkLive(port);
  if (isLive) {
    return { running: true, port, url: `http://127.0.0.1:${port}` };
  }

  if (fs.existsSync(MINDWALK_BIN)) {
    try {
      mindwalkProcess = spawn(MINDWALK_BIN, ['serve', '--port', String(port), '--no-open'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      });
      mindwalkProcess.unref();

      // Give it 1 second to bind
      await new Promise(r => setTimeout(r, 1000));
      return { running: true, port, url: `http://127.0.0.1:${port}` };
    } catch (err) {
      console.warn('[MindwalkAdapter] Failed to spawn mindwalk.exe:', err.message);
    }
  }

  return { running: false, error: 'mindwalk.exe not found or failed to start' };
}

/**
 * Normalizes an Antigravity/Aloy transcript into a Claude Code format JSONL that Mindwalk natively replays.
 */
function convertTranscriptToClaudeJsonl({
  transcriptPath,
  sessionId,
  title = 'Aloy Session',
  repoDir = path.join(os.homedir(), 'AloyMobile')
}) {
  // transcriptPath arrives from POST /api/mindwalk/export-session and went
  // straight to existsSync + readFileSync. Content is not returned, so this was
  // a file-existence and JSONL-shape oracle rather than a full read primitive —
  // but it is still an unfenced read of any path on the machine.
  const pathCheck = validatePathAccess(transcriptPath, false);
  if (!pathCheck.allowed) {
    throw new Error(`Transcript path rejected: ${pathCheck.reason}`);
  }
  if (!fs.existsSync(transcriptPath)) {
    throw new Error(`Transcript file not found: ${transcriptPath}`);
  }

  const rawLines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(Boolean);
  const outEvents = [];

  // Project folder slug (e.g. C--Users-User-AloyMobile)
  const safeSlug = repoDir.replace(/[:\\/]/g, '-').replace(/^-+/, '');
  const projectDir = path.join(CLAUDE_PROJECTS_DIR, safeSlug);
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  const outJsonlPath = path.join(projectDir, `${sessionId || 'session-' + Date.now()}.jsonl`);

  for (const line of rawLines) {
    try {
      const step = JSON.parse(line);
      const ts = step.created_at || new Date().toISOString();

      if (step.type === 'USER_INPUT' && step.content) {
        outEvents.push({
          type: 'user',
          sessionId: sessionId || 'session-' + Date.now(),
          cwd: repoDir,
          message: {
            role: 'user',
            content: step.content.replace(/<[^>]+>/g, '').trim()
          },
          timestamp: ts
        });
      }

      if (step.type === 'PLANNER_RESPONSE' && Array.isArray(step.tool_calls)) {
        for (const tc of step.tool_calls) {
          const name = tc.name;
          const args = tc.args || {};

          let toolName = 'Bash';
          let toolInput = {};

          if (name === 'view_file') {
            toolName = 'Read';
            toolInput = { file_path: args.AbsolutePath || args.path };
          } else if (name === 'replace_file_content' || name === 'write_to_file') {
            toolName = 'Edit';
            toolInput = { file_path: args.TargetFile || args.path, content: args.ReplacementContent || args.CodeContent };
          } else if (name === 'grep_search') {
            toolName = 'Grep';
            toolInput = { pattern: args.Query, path: args.SearchPath };
          } else if (name === 'list_dir') {
            toolName = 'Glob';
            toolInput = { path: args.DirectoryPath };
          } else if (name === 'run_command') {
            toolName = 'Bash';
            toolInput = { command: args.CommandLine };
          } else if (name === 'invoke_subagent') {
            toolName = 'Agent';
            toolInput = { role: tc.Role || 'Subagent', prompt: tc.Prompt };
          }

          outEvents.push({
            type: 'assistant',
            sessionId: sessionId || 'session-' + Date.now(),
            cwd: repoDir,
            message: {
              role: 'assistant',
              content: [
                {
                  type: 'tool_use',
                  id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                  name: toolName,
                  input: toolInput
                }
              ]
            },
            timestamp: ts
          });
        }
      }
    } catch {
      // skip corrupted line
    }
  }

  const serialized = outEvents.map(e => JSON.stringify(e)).join('\n');
  fs.writeFileSync(outJsonlPath, serialized, 'utf8');

  return {
    sessionId: sessionId || path.basename(outJsonlPath, '.jsonl'),
    jsonlPath: outJsonlPath,
    eventCount: outEvents.length,
    projectSlug: safeSlug
  };
}

module.exports = {
  checkMindwalkLive,
  ensureMindwalkRunning,
  convertTranscriptToClaudeJsonl,
  MINDWALK_BIN,
  MINDWALK_PORT
};
