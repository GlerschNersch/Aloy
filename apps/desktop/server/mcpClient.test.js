import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRequire } from 'module';
import path from 'path';
import os from 'os';

// mcpClient.cjs is a plain CJS module — Vitest's vi.mock only intercepts
// import/dynamic import specifiers, not require() calls inside an actual
// .cjs file (confirmed: vi.mock'ing the SDK here still spawned real child
// processes). So instead of mocking modules, mcpClient.cjs's
// initMcpClients() takes injectable {ClientClass, TransportClass,
// loadConfigFn} — tests pass fakes directly, production code (electron.cjs,
// aloyServer.cjs) calls it with no args and gets the real SDK/config.
const require = createRequire(import.meta.url);
const mcp = require('./mcpClient.cjs');

function makeClientMock(overrides = {}) {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    listTools: vi.fn().mockResolvedValue({ tools: [] }),
    callTool: vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'ok' }] }),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

// Each test pushes the mock client instance(s) it wants the fake `new
// ClientClass()` to return, in the order servers are constructed. Plain
// `function` (not arrow) implementations — mcpClient.cjs calls these with
// `new`, and arrow functions have no [[Construct]] internal method.
let nextClientMocks = [];
const FakeClient = vi.fn().mockImplementation(function () {
  return nextClientMocks.shift() || makeClientMock();
});
const FakeTransport = vi.fn().mockImplementation(function (opts) {
  return { __opts: opts };
});

function init(config) {
  return mcp.initMcpClients({ ClientClass: FakeClient, TransportClass: FakeTransport, loadConfigFn: () => config });
}

beforeEach(() => {
  mcp.__resetForTests();
  nextClientMocks = [];
  FakeClient.mockClear();
  FakeTransport.mockClear();
});

describe('initMcpClients / config loading', () => {
  it('does nothing when the config has no servers', async () => {
    await init([]);
    expect(mcp.getMcpToolDefinitions()).toEqual([]);
  });

  it('connects only enabled servers, skipping disabled ones', async () => {
    nextClientMocks = [makeClientMock({ listTools: vi.fn().mockResolvedValue({ tools: [{ name: 'list_directory' }] }) })];
    await init([
      { name: 'filesystem', enabled: true, command: 'npx', args: [] },
      { name: 'disabled-one', enabled: false, command: 'npx', args: [] }
    ]);

    const names = mcp.getMcpToolDefinitions().map((d) => d.name);
    expect(names).toEqual(['mcp__filesystem__list_directory']);
    expect(FakeClient).toHaveBeenCalledTimes(1);
  });

  it('is memoized: calling initMcpClients twice only connects each server once', async () => {
    const client = makeClientMock();
    nextClientMocks = [client];
    const config = [{ name: 'fetch', enabled: true, command: 'uvx', args: [] }];

    await init(config);
    await init(config);

    expect(client.connect).toHaveBeenCalledTimes(1);
  });

  it('one server failing to connect does not prevent others from connecting', async () => {
    const brokenClient = makeClientMock({ connect: vi.fn().mockRejectedValue(new Error('spawn failed')) });
    const goodClient = makeClientMock({ listTools: vi.fn().mockResolvedValue({ tools: [{ name: 'ping' }] }) });
    nextClientMocks = [brokenClient, goodClient];

    await expect(init([
      { name: 'broken', enabled: true, command: 'bogus-cmd', args: [] },
      { name: 'good', enabled: true, command: 'npx', args: [] }
    ])).resolves.not.toThrow();

    const names = mcp.getMcpToolDefinitions().map((d) => d.name);
    expect(names).toEqual(['mcp__good__ping']);
  });

  it('passes command/args/env through to the transport', async () => {
    nextClientMocks = [makeClientMock()];
    await init([{ name: 'fetch', enabled: true, command: 'uvx', args: ['mcp-server-fetch'], env: { FOO: 'bar' } }]);
    expect(FakeTransport).toHaveBeenCalledWith({ command: 'uvx', args: ['mcp-server-fetch'], env: { FOO: 'bar' } });
  });
});

describe('getMcpToolDefinitions', () => {
  it('qualifies names as mcp__<server>__<tool> and carries description/inputSchema/serverName', async () => {
    nextClientMocks = [makeClientMock({
      listTools: vi.fn().mockResolvedValue({
        tools: [{ name: 'read_text_file', description: 'Reads a file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } }]
      })
    })];
    await init([{ name: 'filesystem', enabled: true, command: 'npx', args: [] }]);

    expect(mcp.getMcpToolDefinitions()).toEqual([{
      name: 'mcp__filesystem__read_text_file',
      description: 'Reads a file',
      inputSchema: { type: 'object', properties: { path: { type: 'string' } } },
      serverName: 'filesystem'
    }]);
  });
});

describe('callMcpTool', () => {
  async function setupWithTool(toolName, callToolImpl) {
    const client = makeClientMock({
      listTools: vi.fn().mockResolvedValue({ tools: [{ name: toolName }] }),
      callTool: callToolImpl
    });
    nextClientMocks = [client];
    await init([{ name: 'filesystem', enabled: true, command: 'npx', args: [] }]);
    return client;
  }

  it('routes to the correct server and tool, preserving underscores in the tool name', async () => {
    const client = await setupWithTool(
      'list_directory_with_sizes',
      vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'listing' }] })
    );

    const testPath = path.join(os.tmpdir(), 'test_dir');
    const result = await mcp.callMcpTool('mcp__filesystem__list_directory_with_sizes', { path: testPath });
    expect(client.callTool).toHaveBeenCalledWith({ name: 'list_directory_with_sizes', arguments: { path: testPath } });
    expect(result).toEqual({ success: true, result: 'listing' });
  });

  it('blocks unauthorized path arguments before sending to MCP client', async () => {
    const client = await setupWithTool(
      'list_directory_with_sizes',
      vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'listing' }] })
    );

    const result = await mcp.callMcpTool('mcp__filesystem__list_directory_with_sizes', { path: 'C:\\Windows\\System32' });
    expect(client.callTool).not.toHaveBeenCalled();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/forbidden|outside authorized/i);
  });

  it('returns an error for a qualified name with no server separator', async () => {
    await init([]);
    const result = await mcp.callMcpTool('not_a_valid_mcp_name', {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not a valid mcp tool name/i);
  });

  it('returns an error for a name not starting with mcp__', async () => {
    await init([]);
    const result = await mcp.callMcpTool('filesystem__read_text_file', {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not a valid mcp tool name/i);
  });

  it('returns an error when the referenced server is not connected', async () => {
    await init([]);
    const result = await mcp.callMcpTool('mcp__filesystem__read_text_file', {});
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not connected/i);
  });

  it('treats result.isError as a failure, still reducing content to a string', async () => {
    await setupWithTool(
      'write_file',
      vi.fn().mockResolvedValue({ isError: true, content: [{ type: 'text', text: 'permission denied' }] })
    );
    const result = await mcp.callMcpTool('mcp__filesystem__write_file', {});
    expect(result).toEqual({ success: false, error: 'permission denied' });
  });

  it('prefers structuredContent over text content when both are present', async () => {
    await setupWithTool(
      'get_file_info',
      vi.fn().mockResolvedValue({
        structuredContent: { size: 42 },
        content: [{ type: 'text', text: 'ignored' }]
      })
    );
    const result = await mcp.callMcpTool('mcp__filesystem__get_file_info', {});
    expect(result).toEqual({ success: true, result: JSON.stringify({ size: 42 }) });
  });

  it('joins multiple text content blocks with newlines', async () => {
    await setupWithTool(
      'read_multiple_files',
      vi.fn().mockResolvedValue({ content: [{ type: 'text', text: 'file1' }, { type: 'text', text: 'file2' }] })
    );
    const result = await mcp.callMcpTool('mcp__filesystem__read_multiple_files', {});
    expect(result).toEqual({ success: true, result: 'file1\nfile2' });
  });

  it('falls back to JSON.stringify(content) when there are no text blocks', async () => {
    await setupWithTool(
      'read_media_file',
      vi.fn().mockResolvedValue({ content: [{ type: 'image', data: 'base64...', mimeType: 'image/png' }] })
    );
    const result = await mcp.callMcpTool('mcp__filesystem__read_media_file', {});
    expect(result).toEqual({
      success: true,
      result: JSON.stringify([{ type: 'image', data: 'base64...', mimeType: 'image/png' }])
    });
  });

  it('returns a thrown protocol error as a failure rather than rejecting', async () => {
    await setupWithTool('list_directory', vi.fn().mockRejectedValue(new Error('timed out')));
    const result = await mcp.callMcpTool('mcp__filesystem__list_directory', {});
    expect(result).toEqual({ success: false, error: 'timed out' });
  });
});

describe('closeMcpClients', () => {
  it('closes every connected client and clears state so init can run again', async () => {
    const client = makeClientMock();
    nextClientMocks = [client];
    await init([{ name: 'filesystem', enabled: true, command: 'npx', args: [] }]);

    await mcp.closeMcpClients();
    expect(client.close).toHaveBeenCalledTimes(1);
    expect(mcp.getMcpToolDefinitions()).toEqual([]);

    // initPromise was reset — a subsequent initMcpClients() call re-connects.
    const secondClient = makeClientMock();
    nextClientMocks = [secondClient];
    await init([{ name: 'filesystem', enabled: true, command: 'npx', args: [] }]);
    expect(secondClient.connect).toHaveBeenCalledTimes(1);
  });
});
