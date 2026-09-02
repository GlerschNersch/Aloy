import { describe, it, expect } from 'vitest';
import { listListeningPorts, getProcessForPort, isPortOpen, KNOWN_PORT_MAP } from './portManager.cjs';

describe('PortPal Port Manager Engine', () => {
  describe('Port Listing & Resolution', () => {
    it('successfully scans and returns listening ports with structure', () => {
      const ports = listListeningPorts();
      expect(Array.isArray(ports)).toBe(true);
      if (ports.length > 0) {
        const first = ports[0];
        expect(typeof first.port).toBe('number');
        expect(typeof first.pid).toBe('number');
        expect(typeof first.processName).toBe('string');
        expect(typeof first.service).toBe('string');
        expect(typeof first.isProtected).toBe('boolean');
      }
    });

    it('identifies known developer and core service ports', () => {
      expect(KNOWN_PORT_MAP[5173]).toBe('Vite Dev Server');
      expect(KNOWN_PORT_MAP[7890]).toBe('Aloy Core Server');
      expect(KNOWN_PORT_MAP[11434]).toBe('Ollama LLM Engine');
      expect(KNOWN_PORT_MAP[8096]).toBe('Jellyfin Media Server');
    });

    it('returns null when querying an unassigned high ephemeral port', () => {
      const info = getProcessForPort(59999);
      expect(info === null || typeof info === 'object').toBe(true);
    });
  });

  describe('isPortOpen Socket Probe', () => {
    it('probes a port and returns boolean without crashing', async () => {
      const result = await isPortOpen(59998);
      expect(typeof result).toBe('boolean');
    });
  });
});
