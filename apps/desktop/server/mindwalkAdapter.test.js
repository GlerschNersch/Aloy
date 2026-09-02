import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  checkMindwalkLive,
  convertTranscriptToClaudeJsonl,
  MINDWALK_PORT,
  MINDWALK_BIN
} from './mindwalkAdapter.cjs';

describe('Mindwalk Adapter', () => {
  it('defines correct default port and binary path', () => {
    expect(MINDWALK_PORT).toBe(8765);
    expect(MINDWALK_BIN).toContain('mindwalk.exe');
  });

  it('converts an Antigravity transcript into Claude Code JSONL with repo cwd', () => {
    const tmpDir = path.join(os.tmpdir(), `mindwalk-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    const sampleTranscript = path.join(tmpDir, 'transcript.jsonl');
    const mockEvents = [
      {
        step_index: 0,
        type: 'USER_INPUT',
        content: '<USER_REQUEST>Test mindwalk replay</USER_REQUEST>',
        created_at: '2026-08-17T01:00:00Z'
      },
      {
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        created_at: '2026-08-17T01:00:05Z',
        tool_calls: [
          {
            name: 'view_file',
            args: { AbsolutePath: 'C:/Project/AloyMobile/App.tsx' }
          },
          {
            name: 'replace_file_content',
            args: { TargetFile: 'C:/Project/AloyMobile/App.tsx', ReplacementContent: '// updated' }
          }
        ]
      }
    ];

    fs.writeFileSync(sampleTranscript, mockEvents.map(e => JSON.stringify(e)).join('\n'), 'utf8');

    const result = convertTranscriptToClaudeJsonl({
      transcriptPath: sampleTranscript,
      sessionId: 'unit-test-session',
      repoDir: 'C:\\Users\\User\\AloyMobile'
    });

    expect(result.sessionId).toBe('unit-test-session');
    expect(result.eventCount).toBe(3);
    expect(fs.existsSync(result.jsonlPath)).toBe(true);

    const generatedLines = fs.readFileSync(result.jsonlPath, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    expect(generatedLines.length).toBe(3);
    expect(generatedLines[0].type).toBe('user');
    expect(generatedLines[0].cwd).toBe('C:\\Users\\User\\AloyMobile');
    expect(generatedLines[1].type).toBe('assistant');
    expect(generatedLines[1].cwd).toBe('C:\\Users\\User\\AloyMobile');
    expect(generatedLines[1].message.content[0].name).toBe('Read');
    expect(generatedLines[2].type).toBe('assistant');
    expect(generatedLines[2].cwd).toBe('C:\\Users\\User\\AloyMobile');
    expect(generatedLines[2].message.content[0].name).toBe('Edit');

    // Cleanup
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.unlinkSync(result.jsonlPath);
    } catch {}
  });

  it('checks mindwalk live status against active server port', async () => {
    const isLive = await checkMindwalkLive(MINDWALK_PORT);
    expect(typeof isLive).toBe('boolean');
  });
});
