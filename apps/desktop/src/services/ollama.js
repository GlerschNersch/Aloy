// Helper service to interact directly with local Ollama API
import { fetchWithTimeout } from './fetchWithTimeout.js';

const OLLAMA_BASE_URL = import.meta.env?.VITE_OLLAMA_URL || 'http://localhost:11434';

export async function fetchModels() {
  try {
    const res = await fetchWithTimeout(`${OLLAMA_BASE_URL}/api/tags`, {}, 5000);
    if (!res.ok) throw new Error('Failed to fetch models');
    const data = await res.json();
    return data.models || [];
  } catch (err) {
    console.error('Ollama fetchModels error:', err);
    return [];
  }
}

// How long Ollama keeps a model in VRAM after a request. '30m' rather than -1
// (never unload) so a forgotten background app cannot hold the GPU hostage
// indefinitely, while still covering any realistic conversational gap.
const KEEP_ALIVE = '30m';

// Explicitly frees the model's VRAM immediately (keep_alive: 0) instead of
// waiting for Ollama's idle-unload timeout — used by Gaming Mode so GPU memory
// is completely returned to concurrent games immediately.
export async function unloadModel(model) {
  try {
    const loadedModels = new Set();
    if (model) loadedModels.add(model);

    // Discover all models currently resident in Ollama VRAM
    try {
      const psRes = await fetchWithTimeout(`${OLLAMA_BASE_URL}/api/ps`, { method: 'GET' }, 3000);
      if (psRes && psRes.ok) {
        const psData = await psRes.json();
        if (psData?.models && Array.isArray(psData.models)) {
          psData.models.forEach((m) => {
            if (m.name) loadedModels.add(m.name);
            if (m.model) loadedModels.add(m.model);
          });
        }
      }
    } catch {
      // Non-critical — fall back to selected model
    }

    if (loadedModels.size === 0) return;

    // Unload all detected models concurrently
    await Promise.all(
      Array.from(loadedModels).map((m) =>
        fetchWithTimeout(`${OLLAMA_BASE_URL}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: m, keep_alive: 0 })
        }, 8000).catch(() =>
          fetchWithTimeout(`${OLLAMA_BASE_URL}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: m, messages: [], keep_alive: 0 })
          }, 8000).catch(() => {})
        )
      )
    );
  } catch (err) {
    console.warn('Failed to unload Ollama model:', err);
  }
}

export async function checkOllamaHealth() {
  try {
    const res = await fetchWithTimeout(`${OLLAMA_BASE_URL}/api/tags`, { method: 'GET' }, 3000);
    return res.ok;
  } catch {
    return false;
  }
}

// One model turn. If the model requests tool calls, onToolCalls fires instead
// of onComplete — the caller decides whether to auto-execute (read-only
// tools) and continue the conversation, or surface a confirmation UI (write
// tools) and pause. `tools` is the Ollama/OpenAI-style function schema array;
// omit it for a plain turn with no tool access.
export async function streamChat({ model, messages, systemPrompt, temperature, tools, signal, onChunk, onThinking, onToolCalls, onError, onComplete }) {
  let fullText = '';
  let thinkingText = '';
  let toolCalls = null;

  try {
    const formattedMessages = [];
    if (systemPrompt) {
      formattedMessages.push({ role: 'system', content: systemPrompt });
    }
    formattedMessages.push(...messages);

    const payload = {
      model: model || 'gemma4:12b',
      messages: formattedMessages,
      stream: true,
      // Reasoning-capable models (e.g. gemma4) default to an unconstrained
      // internal monologue that can run for hundreds of words even on a
      // simple factual question, then bleeds into a padded final answer.
      // This app's chat UI already renders a plain-text personal assistant
      // experience with no use for visible/extended chain-of-thought, so
      // thinking is turned off at the request level rather than per-model.
      think: false,
      // Pin the model in VRAM between turns.
      //
      // Ollama's default idle-unload means the FIRST request after any quiet
      // period pays a multi-second cold load — and that is exactly the moment
      // responsiveness matters most (you walk up and speak). Holding the
      // conversational model resident removes the single worst-case latency
      // in the whole voice loop.
      //
      // Gaming Mode's unloadModel() still frees VRAM on demand, so this trades
      // idle VRAM for responsiveness only while the app is actually in use.
      keep_alive: KEEP_ALIVE,
      options: {
        temperature: parseFloat(temperature || 0.7),
        num_ctx: 16384
      },
      ...(tools && tools.length > 0 ? { tools } : {})
    };

    // 120s bounds headers only (stream: true), so a cold 14B load has room
    // while a dead Ollama still fails instead of hanging the turn forever.
    // `signal` is composed, not replaced — barge-in keeps working.
    let res = await fetchWithTimeout(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal
    }, 120000);

    if (!res.ok) {
      const errData = await res.json().catch(() => null);
      const rawError = errData?.error || `HTTP error! status: ${res.status}`;

      // If the model does not support tools, transparently retry without tools
      if (tools && tools.length > 0 && (rawError.includes('does not support tools') || rawError.includes('tools'))) {
        console.warn(`[ollama] Model "${payload.model}" does not support tools. Retrying turn without tools payload...`);
        const fallbackPayload = { ...payload };
        delete fallbackPayload.tools;
        const retryRes = await fetchWithTimeout(`${OLLAMA_BASE_URL}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(fallbackPayload),
          signal
        }, 120000);
        if (retryRes.ok) {
          res = retryRes;
        } else {
          const retryErrData = await retryRes.json().catch(() => null);
          throw new Error(retryErrData?.error || `HTTP error! status: ${retryRes.status}`);
        }
      } else {
        throw new Error(rawError);
      }
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    const handleLine = (line) => {
      if (!line.trim()) return;
      try {
        const parsed = JSON.parse(line);

        // `thinking` arrives as its own field (not inline <think> tags) on
        // reasoning-capable models — stream it separately, then synthesize a
        // <think> block around the final content so the existing
        // reasoning-collapse UI (which parses that tag out of content) still
        // works without needing its own rewrite.
        if (parsed.message?.thinking) {
          thinkingText += parsed.message.thinking;
          if (onThinking) onThinking(parsed.message.thinking, thinkingText);
        }

        if (parsed.message?.content) {
          fullText += parsed.message.content;
          onChunk(parsed.message.content, fullText);
        }

        if (parsed.message?.tool_calls && parsed.message.tool_calls.length > 0) {
          toolCalls = parsed.message.tool_calls;
        }
      } catch {
        // Ignore malformed / non-JSON lines
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Keep the last, possibly incomplete, line for the next read
      buffer = lines.pop() || '';

      for (const line of lines) handleLine(line);
    }

    // Flush any trailing buffered line
    handleLine(buffer);

    if (toolCalls) {
      onToolCalls(toolCalls, fullText);
      return;
    }

    const finalText = (thinkingText && !fullText.includes('<think>'))
      ? `<think>${thinkingText}</think>${fullText}`
      : fullText;
    onComplete(finalText);
  } catch (err) {
    // A user-initiated stop surfaces as an AbortError — treat it as a clean
    // finish and keep whatever text streamed so far, rather than an error.
    if (err?.name === 'AbortError') {
      onComplete(fullText);
      return;
    }
    console.error('Streaming error:', err);
    onError(err.message || 'Failed to stream response from Ollama.');
  }
}
