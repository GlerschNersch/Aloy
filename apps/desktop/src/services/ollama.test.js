import { describe, it, expect, vi } from 'vitest';
import { checkOllamaHealth, fetchModels } from './ollama';

describe('Ollama Service Functions', () => {
  it('should return false for checkOllamaHealth when server is unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));
    const isHealthy = await checkOllamaHealth();
    expect(isHealthy).toBe(false);
  });

  it('should return true for checkOllamaHealth when server responds OK', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: [] })
    });
    const isHealthy = await checkOllamaHealth();
    expect(isHealthy).toBe(true);
  });

  it('should fetch and return models array', async () => {
    const mockModels = [{ name: 'llama3:latest' }, { name: 'gemma:7b' }];
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ models: mockModels })
    });

    const models = await fetchModels();
    expect(models).toHaveLength(2);
    expect(models[0].name).toBe('llama3:latest');
  });
});
