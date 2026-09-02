import { describe, it, expect } from 'vitest';
import {
  compactConversationHistory,
  estimateTokenCount,
  summarizeOlderMessages,
  MAX_PRESERVED_TURNS
} from './contextCompactor.cjs';

describe('Rolling Chat Context Compactor Suite', () => {
  it('preserves short conversations without modification', () => {
    const shortMessages = [
      { role: 'user', content: 'Hello Aloy' },
      { role: 'assistant', content: 'Greetings! How can I assist you?' }
    ];

    const res = compactConversationHistory(shortMessages);
    expect(res.wasCompacted).toBe(false);
    expect(res.compactedMessages.length).toBe(2);
    expect(res.compactedMessages).toEqual(shortMessages);
  });

  it('accurately estimates token count from character length', () => {
    const messages = [
      { role: 'user', content: 'This is a test of twenty characters.' } // 36 chars => ~9 tokens
    ];
    const tokens = estimateTokenCount(messages);
    expect(tokens).toBe(9);
  });

  it('compacts long conversations by summarizing older turns into a prior context block', () => {
    const longConversation = [];
    for (let i = 1; i <= 10; i++) {
      longConversation.push({ role: 'user', content: `Question ${i}: How do we configure feature ${i}?` });
      longConversation.push({ role: 'assistant', content: `Answer ${i}: Feature ${i} is configured via setting_${i}.` });
    }

    expect(longConversation.length).toBe(20);

    const res = compactConversationHistory(longConversation, { maxPreservedTurns: 6 });
    expect(res.wasCompacted).toBe(true);
    expect(res.originalCount).toBe(20);
    // 1 summary block + 6 preserved recent turns = 7 messages
    expect(res.compactedMessages.length).toBe(7);
    expect(res.compactedMessages[0].role).toBe('system');
    expect(res.compactedMessages[0].content).toContain('[PRIOR CONVERSATION SUMMARY & ESTABLISHED CONTEXT]');
    expect(res.compactedMessages[0].content).toContain('User asked:');
    expect(res.compactedMessages[0].content).toContain('Aloy established:');

    // The most recent turns remain untouched
    const lastMsg = res.compactedMessages[res.compactedMessages.length - 1];
    expect(lastMsg.content).toBe('Answer 10: Feature 10 is configured via setting_10.');
  });

  it('extracts clean topic summaries ignoring think tags', () => {
    const messages = [
      { role: 'user', content: 'Should we upgrade to React 19?' },
      { role: 'assistant', content: '<think>Let us analyze benefits</think>Yes, React 19 provides superior concurrent rendering and action hooks.' }
    ];

    const summary = summarizeOlderMessages(messages);
    expect(summary).toContain('User asked: "Should we upgrade to React 19?"');
    expect(summary).toContain('Aloy established: Yes, React 19 provides superior concurrent rendering');
    expect(summary).not.toContain('<think>');
  });
});
