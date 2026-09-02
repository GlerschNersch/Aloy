// MCP (Model Context Protocol) client — connects to locally-configured MCP
// servers (stdio transport) and exposes their tools to the same tool-calling
// loop the app's own hand-written tools use (see src/services/tools.js).
//
// Config lives in mcp-servers.json (gitignored, machine-specific — see
// mcp-servers.example.json), matching this project's .env/.env.example
// precedent for local-only config. A missing config file is not an error —
// MCP support is opt-in.
//
// MCP tools are third-party (server-defined, not audited by this app) so
// they always require user confirmation before running — enforced on the
// renderer side in src/services/tools.js, not here.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Client } = require('@modelcontextprotocol/sdk/client');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

// Prefers the external ~/.aloy-server/mcp-servers.json (same directory as
// store.json/lock.json/.env) so a packaged build's machine-specific config
// lives outside the asar and survives rebuilds; falls back to the
// project-root copy for dev-mode convenience.
const EXTERNAL_CONFIG_PATH = path.join(os.homedir(), '.aloy-server', 'mcp-servers.json');
const PROJECT_CONFIG_PATH = path.join(__dirname, '..', 'mcp-servers.json');
const CONFIG_PATH = fs.existsSync(EXTERNAL_CONFIG_PATH) ? EXTERNAL_CONFIG_PATH : PROJECT_CONFIG_PATH;

// serverName -> { client, tools }
const servers = new Map();

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    return Array.isArray(parsed.servers) ? parsed.servers : [];
  } catch (err) {
    console.error('MCP: failed to parse mcp-servers.json:', err.message);
    return [];
  }
}

// Memoized — both electron.cjs (desktop renderer's IPC handler) and
// aloyServer.cjs (mobile/API path) call this, and it must only spawn each
// configured server once, not once per caller.
let initPromise = null;

// ClientClass/TransportClass/loadConfigFn are injectable so tests can pass
// fakes directly instead of mocking modules — Vitest can't intercept a
// plain CJS require() inside a .cjs file (confirmed the hard way: real
// child processes spawned through vi.mock'd specifiers). Production call
// sites (electron.cjs, aloyServer.cjs) call this with no args, getting the
// real SDK classes and real config loading — zero behavior change there.
function initMcpClients({ ClientClass = Client, TransportClass = StdioClientTransport, loadConfigFn = loadConfig } = {}) {
  if (!initPromise) {
    initPromise = (async () => {
      const configs = loadConfigFn().filter((s) => s.enabled);
      for (const cfg of configs) {
        try {
          const transport = new TransportClass({ command: cfg.command, args: cfg.args || [], env: cfg.env || undefined });
          transport.onerror = (err) => {
            console.warn(`MCP server "${cfg.name}" transport error:`, err?.message || err);
          };
          const client = new ClientClass({ name: 'aloy', version: '1.0.0' });
          await client.connect(transport);
          const { tools } = await client.listTools();
          servers.set(cfg.name, { client, tools });
          console.log(`MCP server "${cfg.name}" connected (${tools.length} tools).`);
        } catch (err) {
          console.error(`MCP server "${cfg.name}" failed to start:`, err.message);
        }
      }
    })();
  }
  return initPromise;
}

function getMcpToolDefinitions() {
  const defs = [];
  for (const [serverName, { tools }] of servers) {
    for (const tool of tools) {
      defs.push({
        name: `mcp__${serverName}__${tool.name}`,
        description: tool.description || '',
        inputSchema: tool.inputSchema || { type: 'object', properties: {} },
        serverName
      });
    }
  }
  return defs;
}

// Reduces an MCP callTool() result down to a plain string/JSON-serializable
// value suitable for feeding back to the LLM as a tool result message.
function reduceToolResult(result, toolName = '') {
  let rawText = '';
  if (result.structuredContent) {
    if (result.structuredContent.content && typeof result.structuredContent.content === 'string') {
      rawText = result.structuredContent.content;
    } else {
      rawText = JSON.stringify(result.structuredContent);
    }
  } else if (result.content && Array.isArray(result.content)) {
    const textBlocks = result.content.filter((b) => b.type === 'text').map((b) => b.text);
    if (textBlocks.length > 0) rawText = textBlocks.join('\n');
  }

  if (!rawText) {
    rawText = typeof result === 'string' ? result : JSON.stringify(result.content || result);
  }

  if (rawText && (toolName === 'list_directory' || toolName === 'search_files')) {
    try {
      const parsed = JSON.parse(rawText);
      if (parsed && typeof parsed.content === 'string') {
        rawText = parsed.content;
      }
    } catch {}

    const lines = rawText.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    const dirCount = lines.filter((l) => l.startsWith('[DIR]')).length;
    const fileCount = lines.filter((l) => l.startsWith('[FILE]')).length;
    const total = lines.length;
    if (total > 0) {
      const summary = (dirCount > 0 && fileCount > 0)
        ? `[Directory Contents: ${total} total items (${dirCount} directories, ${fileCount} files)]\n`
        : dirCount > 0
          ? `[Directory Contents: ${total} directories]\n`
          : `[Directory Contents: ${total} files]\n`;
      return summary + rawText;
    }
  }

  return rawText;
}

// Splits "mcp__<serverName>__<toolName>" back apart. Only the first "__"
// after the "mcp__" prefix is treated as the separator, so tool names
// containing underscores (common — e.g. "list_directory_with_sizes") are
// preserved intact; server names (ours, from mcp-servers.json) must not
// themselves contain "__".
function parseQualifiedName(qualifiedName) {
  if (!qualifiedName.startsWith('mcp__')) return null;
  const rest = qualifiedName.slice('mcp__'.length);
  const sepIdx = rest.indexOf('__');
  if (sepIdx === -1) return null;
  return { serverName: rest.slice(0, sepIdx), toolName: rest.slice(sepIdx + 2) };
}

const { validatePathAccess } = require('./securityGuard.cjs');

async function callMcpTool(qualifiedName, args) {
  const parsed = parseQualifiedName(qualifiedName);
  if (!parsed) return { success: false, error: `Not a valid MCP tool name: "${qualifiedName}"` };
  const { serverName, toolName } = parsed;
  const entry = servers.get(serverName);
  if (!entry) return { success: false, error: `MCP server "${serverName}" is not connected.` };

  // Security guard check on path arguments across MCP tools
  // This used to read five specific keys and short-circuit on the first
  // truthy one, so `move_file`'s `source`/`destination`, `read_multiple_files`'
  // `paths` array and every mcp-server-git `repo_path` went unchecked — and a
  // call carrying both `path` and `destination` validated only `path`.
  //
  // Collect every argument that looks like a filesystem path and validate all
  // of them. An unknown future tool with a new key name is caught by the
  // heuristic rather than silently exempt.
  const PATH_KEYS = /^(path|paths|file|files|filePath|filePaths|targetPath|target|directory|dirPath|dir|source|src|destination|dest|repo_path|repoPath|cwd|folder|output|outputPath)$/i;
  const candidatePaths = [];
  for (const [key, value] of Object.entries(args || {})) {
    if (!PATH_KEYS.test(key)) continue;
    if (typeof value === 'string') candidatePaths.push(value);
    else if (Array.isArray(value)) candidatePaths.push(...value.filter((v) => typeof v === 'string'));
  }
  if (candidatePaths.length) {
    const isWriteTool = /write|create|edit|delete|remove|move|modify|append|save/i.test(toolName);
    for (const candidate of candidatePaths) {
      const pathCheck = validatePathAccess(candidate, isWriteTool);
      if (!pathCheck.allowed) {
        return { success: false, error: `${pathCheck.reason} (argument: ${candidate})` };
      }
    }
  }

  try {
    const result = await entry.client.callTool({ name: toolName, arguments: args || {} });
    if (result.isError) return { success: false, error: reduceToolResult(result, toolName) };
    return { success: true, result: reduceToolResult(result, toolName) };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

async function closeMcpClients() {
  await Promise.all(
    Array.from(servers.values()).map(({ client }) => client.close().catch(() => {}))
  );
  servers.clear();
  initPromise = null;
}

// Test-only: resets module-singleton state between tests without needing to
// reload the whole module (no real clients to close — tests use fakes).
function __resetForTests() {
  servers.clear();
  initPromise = null;
}

module.exports = { initMcpClients, getMcpToolDefinitions, callMcpTool, closeMcpClients, __resetForTests };
