import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App';

// This exercises the real tool-calling loop (runModelTurn/onToolCalls/
// handleToolCallResponse in App.jsx) against the real src/services/tools.js
// registry — only streamChat itself (the network call) is faked, so a bug
// in how App.jsx wires tool results back into the conversation would show
// up here even though tools.js's own unit tests (tools.test.js) pass.
//
// isPaused=true (via the same localStorage key Gaming Mode uses) sidesteps
// the Ollama-health/HA/project-status polling effects and ChatArea's
// mount-time getUserMedia() call — none of those are relevant to the
// tool-calling loop and jsdom has no real camera/network for them anyway.
localStorage.setItem('ollama_pro_paused', 'true');

// jsdom doesn't implement scrollIntoView — ChatArea calls it on every new message.
Element.prototype.scrollIntoView = vi.fn();

// jsdom has no speech synthesis API either. Auto-speak can hit this path
// even with Kokoro mocked as "online", since isKokoroOnline is set by an
// async effect that may not have resolved yet when the first message speaks.
window.speechSynthesis = { cancel: vi.fn(), speak: vi.fn() };
global.SpeechSynthesisUtterance = vi.fn().mockImplementation(function (text) { return { text }; });

// pdfjs-dist (pulled in transitively for PDF attachment parsing) touches
// DOMMatrix, which jsdom doesn't implement — irrelevant to the tool-calling
// loop this file tests, so just stub the module out.
vi.mock('./services/fileparser', () => ({
  parseDocumentFile: vi.fn().mockResolvedValue('')
}));

// checkKokoroStatus resolves true so ChatArea's auto-speak takes the
// (fully mocked) Kokoro path rather than falling back to the browser's
// window.speechSynthesis, which jsdom doesn't implement.
vi.mock('./services/kokorotts', () => ({
  checkKokoroStatus: vi.fn().mockResolvedValue(true),
  speakKokoroAudio: vi.fn().mockResolvedValue(undefined),
  stopKokoroAudio: vi.fn()
}));

const streamChatMock = vi.fn();
vi.mock('./services/ollama', () => ({
  fetchModels: vi.fn().mockResolvedValue([{ name: 'aloy-assistant' }]),
  checkOllamaHealth: vi.fn().mockResolvedValue(true),
  unloadModel: vi.fn(),
  streamChat: (...args) => streamChatMock(...args)
}));

beforeEach(() => {
  streamChatMock.mockReset();
});

// Drives the whole visible flow: switch to Chat Area if needed, type into the message box and press send.
async function sendMessage(text) {
  const chatBtn = screen.queryByText('Chat Area');
  if (chatBtn) {
    fireEvent.click(chatBtn);
  }
  const input = await screen.findByLabelText('Message input', {}, { timeout: 5000 });
  fireEvent.change(input, { target: { value: text } });
  fireEvent.click(screen.getByLabelText('Send message'));
}

describe('App tool-calling loop', () => {
  it('auto-executes a read-only tool call and continues the turn without user input', async () => {
    // Turn 1: model asks to check finances (no confirmation needed).
    streamChatMock.mockImplementationOnce(async ({ onToolCalls }) => {
      await onToolCalls([{ id: 'call-1', function: { name: 'get_finance_summary', arguments: '{}' } }]);
    });
    // Turn 2: after the tool result is fed back, the model gives a final answer.
    streamChatMock.mockImplementationOnce(async ({ messages, onComplete }) => {
      const toolResult = messages.find((m) => m.role === 'tool');
      expect(toolResult).toBeDefined();
      onComplete(`Here's your summary: ${toolResult.content}`);
    });

    render(<App />);
    await sendMessage('How much did I spend this month?');

    await waitFor(() => {
      expect(screen.getByText(/Here's your summary:/)).toBeDefined();
    });
    expect(streamChatMock).toHaveBeenCalledTimes(2);
    // The read-only tool renders as a subtle "Checked X" chip, not a confirm card.
    expect(screen.getByText(/Checked finance summary/i)).toBeDefined();
  });

  it('surfaces a write tool call as a pending confirmation and does not execute it until confirmed', async () => {
    streamChatMock.mockImplementationOnce(async ({ onToolCalls }) => {
      await onToolCalls([{
        id: 'call-2',
        function: { name: 'add_reminder', arguments: JSON.stringify({ text: 'Call the vet' }) }
      }]);
    });

    render(<App />);
    await sendMessage('Remind me to call the vet');

    const confirmLabel = await screen.findByText(/Add reminder: "Call the vet"/);
    expect(confirmLabel).toBeDefined();
    // Only one streamChat call so far — execution/continuation is gated on the user.
    expect(streamChatMock).toHaveBeenCalledTimes(1);
  });

  it('executes the tool and continues the turn once the user confirms', async () => {
    streamChatMock.mockImplementationOnce(async ({ onToolCalls }) => {
      await onToolCalls([{
        id: 'call-3',
        function: { name: 'add_reminder', arguments: JSON.stringify({ text: 'Buy milk' }) }
      }]);
    });
    streamChatMock.mockImplementationOnce(async ({ messages, onComplete }) => {
      const toolResult = messages.find((m) => m.role === 'tool');
      expect(JSON.parse(toolResult.content)).toEqual({ success: true, text: 'Buy milk', due_at: null });
      onComplete('Added that reminder for you.');
    });

    render(<App />);
    await sendMessage('Remind me to buy milk');
    await screen.findByText(/Add reminder: "Buy milk"/);

    fireEvent.click(screen.getByText('Confirm'));

    await waitFor(() => {
      expect(screen.getByText('Added that reminder for you.')).toBeDefined();
    });
    expect(streamChatMock).toHaveBeenCalledTimes(2);
  });

  it('does not execute the tool when the user denies, and records the decline reason', async () => {
    const executeSpy = vi.fn();
    streamChatMock.mockImplementationOnce(async ({ onToolCalls }) => {
      await onToolCalls([{
        id: 'call-4',
        function: { name: 'add_reminder', arguments: JSON.stringify({ text: 'Should not happen' }) }
      }]);
    });
    streamChatMock.mockImplementationOnce(async ({ messages, onComplete }) => {
      const toolResult = messages.find((m) => m.role === 'tool');
      executeSpy(JSON.parse(toolResult.content));
      onComplete('Okay, I will not do that.');
    });

    render(<App />);
    await sendMessage('Remind me of something bad');
    await screen.findByText(/Should not happen/);

    fireEvent.click(screen.getByText('Deny'));

    await waitFor(() => {
      expect(screen.getByText('Okay, I will not do that.')).toBeDefined();
    });
    expect(executeSpy).toHaveBeenCalledWith(expect.objectContaining({ declined: true }));
  });

  it('stops after MAX_TOOL_LOOP_DEPTH consecutive tool calls instead of looping forever', async () => {
    // Every turn immediately asks for another read-only tool call — this
    // exercises the runaway-loop guard, not real model behavior.
    streamChatMock.mockImplementation(async ({ onToolCalls }) => {
      await onToolCalls([{ id: `call-${Math.random()}`, function: { name: 'get_finance_summary', arguments: '{}' } }]);
    });

    render(<App />);
    await sendMessage('loop forever');

    await waitFor(() => {
      expect(screen.getByText(/Stopped after too many tool calls in a row/)).toBeDefined();
    });
  });
});
