import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getToolDefinitions, getTool, registerMcpTools, getMcpStatus, parseToolArguments } from './tools';

describe('MCP tool registration', () => {
  beforeEach(() => {
    // registerMcpTools mutates module-level state — reset between tests so
    // one test's registered tools don't leak into the next.
    registerMcpTools([], async () => ({ success: true, result: '' }));
  });

  it('starts with no MCP tools registered', () => {
    const status = getMcpStatus();
    expect(status).toEqual({ serverCount: 0, toolCount: 0 });
  });

  it('always includes the app\'s own static tools regardless of MCP registration', () => {
    const names = getToolDefinitions().map((d) => d.function.name);
    expect(names).toContain('get_finance_summary');
    expect(names).toContain('control_smart_home_device');
  });

  it('merges registered MCP tool definitions into getToolDefinitions()', () => {
    registerMcpTools([
      { name: 'mcp__filesystem__list_directory', description: 'List a directory', inputSchema: { type: 'object', properties: { path: { type: 'string' } } }, serverName: 'filesystem' }
    ], async () => ({ success: true, result: 'ok' }));

    const defs = getToolDefinitions();
    const mcpDef = defs.find((d) => d.function.name === 'mcp__filesystem__list_directory');
    expect(mcpDef).toBeDefined();
    expect(mcpDef.function.description).toBe('List a directory');
    expect(mcpDef.function.parameters).toEqual({ type: 'object', properties: { path: { type: 'string' } } });
  });

  it('getTool() finds a registered MCP tool by name', () => {
    registerMcpTools([
      { name: 'mcp__fetch__fetch', description: 'Fetch a URL', inputSchema: {}, serverName: 'fetch' }
    ], async () => ({ success: true, result: 'ok' }));

    const tool = getTool('mcp__fetch__fetch');
    expect(tool).toBeDefined();
    expect(tool.requiresConfirmation).toBe(false);
  });

  it('MCP write tools require confirmation while read-only tools execute seamlessly', () => {
    registerMcpTools([
      { name: 'mcp__filesystem__list_allowed_directories', description: 'Read-only listing', inputSchema: {}, serverName: 'filesystem' },
      { name: 'mcp__filesystem__write_file', description: 'Write file', inputSchema: {}, serverName: 'filesystem' }
    ], async () => ({ success: true, result: 'ok' }));

    expect(getTool('mcp__filesystem__list_allowed_directories').requiresConfirmation).toBe(false);
    expect(getTool('mcp__filesystem__write_file').requiresConfirmation).toBe(true);
  });

  it('confirmLabel includes the tool name, server name, and arguments', () => {
    registerMcpTools([
      { name: 'mcp__git__git_status', description: '', inputSchema: {}, serverName: 'git' }
    ], async () => ({ success: true, result: 'ok' }));

    const args = { repo_path: 'C:\\repo' };
    const label = getTool('mcp__git__git_status').confirmLabel(args);
    expect(label).toContain('mcp__git__git_status');
    expect(label).toContain('git');
    expect(label).toContain(JSON.stringify(args));
  });

  it('execute() calls the injected callTool function and returns its result on success', async () => {
    const callTool = vi.fn().mockResolvedValue({ success: true, result: 'file contents here' });
    registerMcpTools([
      { name: 'mcp__filesystem__read_text_file', description: '', inputSchema: {}, serverName: 'filesystem' }
    ], callTool);

    const result = await getTool('mcp__filesystem__read_text_file').execute({ path: 'a.txt' });
    expect(callTool).toHaveBeenCalledWith('mcp__filesystem__read_text_file', { path: 'a.txt' });
    expect(result).toBe('file contents here');
  });

  it('execute() returns a JSON error string when callTool reports failure', async () => {
    const callTool = vi.fn().mockResolvedValue({ success: false, error: 'MCP server not connected' });
    registerMcpTools([
      { name: 'mcp__git__git_status', description: '', inputSchema: {}, serverName: 'git' }
    ], callTool);

    const result = await getTool('mcp__git__git_status').execute({ repo_path: 'x' });
    expect(JSON.parse(result)).toEqual({ error: 'MCP server not connected' });
  });

  it('getMcpStatus() counts distinct servers, not distinct tools', () => {
    registerMcpTools([
      { name: 'mcp__filesystem__read_text_file', description: '', inputSchema: {}, serverName: 'filesystem' },
      { name: 'mcp__filesystem__write_file', description: '', inputSchema: {}, serverName: 'filesystem' },
      { name: 'mcp__fetch__fetch', description: '', inputSchema: {}, serverName: 'fetch' }
    ], async () => ({ success: true, result: '' }));

    expect(getMcpStatus()).toEqual({ serverCount: 2, toolCount: 3 });
  });

  it('re-registering replaces the previous MCP tool set rather than accumulating', () => {
    registerMcpTools([{ name: 'mcp__a__x', description: '', inputSchema: {}, serverName: 'a' }], async () => ({ success: true }));
    registerMcpTools([{ name: 'mcp__b__y', description: '', inputSchema: {}, serverName: 'b' }], async () => ({ success: true }));

    expect(getTool('mcp__a__x')).toBeUndefined();
    expect(getTool('mcp__b__y')).toBeDefined();
    expect(getMcpStatus()).toEqual({ serverCount: 1, toolCount: 1 });
  });
});

describe('parseToolArguments', () => {
  it('passes through an already-parsed object unchanged', () => {
    expect(parseToolArguments({ a: 1 })).toEqual({ a: 1 });
  });

  it('parses a JSON string', () => {
    expect(parseToolArguments('{"a":1}')).toEqual({ a: 1 });
  });

  it('returns an empty object for null/undefined', () => {
    expect(parseToolArguments(null)).toEqual({});
    expect(parseToolArguments(undefined)).toEqual({});
  });

  it('returns an empty object for malformed JSON rather than throwing', () => {
    expect(parseToolArguments('{not json')).toEqual({});
  });
});
