import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import App from './App';

localStorage.setItem('ollama_pro_paused', 'true');
Element.prototype.scrollIntoView = vi.fn();
window.speechSynthesis = { cancel: vi.fn(), speak: vi.fn() };
global.SpeechSynthesisUtterance = vi.fn().mockImplementation((text) => ({ text }));
window.electronAPI = {
  listDevIdeas: vi.fn().mockResolvedValue([]),
  createDevIdea: vi.fn().mockResolvedValue({ id: '1' }),
  deleteDevIdea: vi.fn().mockResolvedValue({ success: true })
};

vi.mock('./services/fileparser', () => ({
  parseDocumentFile: vi.fn().mockResolvedValue('')
}));

vi.mock('./services/kokorotts', () => ({
  checkKokoroStatus: vi.fn().mockResolvedValue(true),
  speakKokoroAudio: vi.fn().mockResolvedValue(undefined),
  stopKokoroAudio: vi.fn()
}));

vi.mock('./services/ollama', () => ({
  fetchModels: vi.fn().mockResolvedValue([{ name: 'aloy-assistant' }]),
  checkOllamaHealth: vi.fn().mockResolvedValue(true),
  unloadModel: vi.fn(),
  streamChat: vi.fn()
}));

describe('Full-Page Workspace Navigation & UX Click-Through', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('completes full click-through cycle across all 7 workspace views cleanly', async () => {
    render(<App />);

    // 1. Initial view: Dashboard — DashboardView is lazy-loaded (see
    // lazyView() in App.jsx), so the very first render only shows the
    // Suspense fallback; must await like every other view switch below.
    expect(await screen.findByText('Aloy Command Center')).toBeDefined();

    // 2. Click Chat Area
    const chatNavBtn = screen.getByText('Chat Area');
    fireEvent.click(chatNavBtn);
    expect(await screen.findByLabelText('Message input')).toBeDefined();

    // 3. Click Hephaestus (HEPH)
    const cauldronNavBtn = screen.getByText('Hephaestus');
    fireEvent.click(cauldronNavBtn);
    expect(await screen.findByText(/Code Forge & Monitored Projects/i)).toBeDefined();
    expect((await screen.findAllByText(/Work Orders/i))[0]).toBeDefined();
    expect((await screen.findAllByText(/Deployed History/i))[0]).toBeDefined();
    expect((await screen.findAllByText(/Feature Backlog/i))[0]).toBeDefined();
    expect((await screen.findAllByText(/Projects & Builds/i))[0]).toBeDefined();

    // Switch sub-tabs inside Hephaestus
    fireEvent.click(screen.getAllByText(/Deployed History/i)[0]);
    expect(await screen.findByText(/Deployment Ledger/i)).toBeDefined();
    fireEvent.click(screen.getAllByText(/Feature Backlog/i)[0]);
    expect(await screen.findByPlaceholderText(/Idea title/i)).toBeDefined();
    fireEvent.click(screen.getAllByText(/Projects & Builds/i)[0]);
    expect(await screen.findByText(/Local dev servers, git status & build checks/i)).toBeDefined();

    // 4. Click Minerva (Smart Home & Reliability Sentinel)
    const minervaNavBtn = screen.getByText('Minerva');
    fireEvent.click(minervaNavBtn);
    expect(await screen.findByText(/Sentinel Watchdog & Health Monitor/i)).toBeDefined();
    expect(screen.getByText(/Smart Home Devices & Perimeter Security/i)).toBeDefined();
    expect(screen.getAllByText(/Smart Lighting/i)[0]).toBeDefined();
    expect(screen.getAllByText(/Smart Locks & 2FA Gate/i)[0]).toBeDefined();

    // 5. Click Apollo (Memory, Skills & User Profile Gardener)
    const apolloNavBtn = screen.getAllByText('Apollo')[0];
    fireEvent.click(apolloNavBtn);
    expect(await screen.findByText('APOLLO')).toBeDefined();
    expect((await screen.findAllByText(/Persistent Facts/i))[0]).toBeDefined();
    expect(screen.getByText(/Skills & Learning Matrix/i)).toBeDefined();
    expect(screen.getByText(/User Profile & Identity/i)).toBeDefined();

    // Switch to Skills tab in Apollo
    fireEvent.click(screen.getByText(/Skills & Learning Matrix/i));
    expect(await screen.findByText(/Overall Skill Proficiency/i)).toBeDefined();

    // Switch to Profile tab in Apollo
    fireEvent.click(screen.getByText(/User Profile & Identity/i));
    expect(await screen.findByText(/User Profile & Aloy Response Persona/i)).toBeDefined();

    // 6. Click Pantheon Council (Weekly Strategic Conclave)
    const councilNavBtn = screen.getAllByText('Pantheon Council')[0];
    fireEvent.click(councilNavBtn);
    expect(await screen.findByText('PANTHEON COUNCIL')).toBeDefined();
    expect((await screen.findAllByText(/Convene Council/i))[0]).toBeDefined();

    // Test Deliberation Transcripts sub-tab with Date Organization
    const deliberationTabBtn = screen.getByText(/Deliberation Transcripts/i);
    fireEvent.click(deliberationTabBtn);
    expect(await screen.findByText(/Deliberation Transcripts by Date/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/Search statements, topics, speakers/i)).toBeDefined();

    // 7. Click Athena (Research Scout)
    const athenaNavBtn = screen.getAllByText('Athena')[0];
    fireEvent.click(athenaNavBtn);
    expect(await screen.findByText(/Deep Intelligence Scout/i)).toBeDefined();

    // 8. Click Dashboard to return home
    const dashboardNavBtn = screen.getByText('Dashboard');
    fireEvent.click(dashboardNavBtn);
    expect(await screen.findByText('Aloy Command Center')).toBeDefined();

    // 9. Click New Conversation
    const newChatBtn = screen.getByText('New Conversation');
    fireEvent.click(newChatBtn);
    expect(await screen.findByLabelText('Message input')).toBeDefined();
  });

  it('correctly filters and organizes Pantheon Council deliberation transcripts by date', async () => {
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);

    const mockTodaySession = {
      id: 'conclave-2026-w34-today',
      isoWeek: 34,
      year: 2026,
      convenedAt: today.toISOString(),
      threads: [
        {
          id: 't-today-1',
          topic: 'Live System Reliability',
          domain: 'Reliability',
          timeStr: '10:00:00 AM',
          messages: [
            { id: 'm-1', speaker: 'Minerva', role: 'Sentinel', avatar: '🛡️', statement: 'All sidecars online today.' }
          ]
        }
      ],
      minutes: [
        { id: 'm-1', speaker: 'Minerva', role: 'Sentinel', avatar: '🛡️', statement: 'All sidecars online today.' }
      ]
    };

    const mockYesterdaySession = {
      id: 'conclave-2026-w34-yesterday',
      isoWeek: 34,
      year: 2026,
      convenedAt: yesterday.toISOString(),
      threads: [
        {
          id: 't-yest-1',
          topic: 'Overnight Skill Matrix Gap Analysis',
          domain: 'Knowledge & Skills',
          timeStr: '08:30:00 PM',
          messages: [
            { id: 'm-2', speaker: 'Apollo', role: 'Vault', avatar: '📚', statement: 'Identified TypeScript gap yesterday.' }
          ]
        }
      ],
      minutes: [
        { id: 'm-2', speaker: 'Apollo', role: 'Vault', avatar: '📚', statement: 'Identified TypeScript gap yesterday.' }
      ]
    };

    window.electronAPI.conclaveLatest = vi.fn().mockResolvedValue(mockTodaySession);
    window.electronAPI.conclaveHistory = vi.fn().mockResolvedValue([mockTodaySession, mockYesterdaySession]);

    render(<App />);

    // Navigate to Pantheon Council
    const councilNavBtn = screen.getAllByText('Pantheon Council')[0];
    fireEvent.click(councilNavBtn);

    // Switch to Deliberation Transcripts
    const deliberationTabBtn = await screen.findByText(/Deliberation Transcripts/i);
    fireEvent.click(deliberationTabBtn);

    // Check header and date tabs
    expect(await screen.findByText(/Deliberation Transcripts by Date/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /All Dates/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Yesterday/i })).toBeDefined();
    expect(screen.getAllByRole('button', { name: /Today/i }).length).toBeGreaterThanOrEqual(1);

    // Verify both date groups are shown in "All Dates" mode
    expect(screen.getByText(/Live System Reliability/i)).toBeDefined();
    expect(screen.getByText(/Overnight Skill Matrix Gap Analysis/i)).toBeDefined();

    // Filter to Yesterday
    fireEvent.click(screen.getByRole('button', { name: /Yesterday/i }));
    expect(screen.getByText(/Overnight Skill Matrix Gap Analysis/i)).toBeDefined();
    expect(screen.queryByText(/Live System Reliability/i)).toBeNull();

    // Filter by search query
    const searchInput = screen.getByPlaceholderText(/Search statements, topics, speakers/i);
    fireEvent.change(searchInput, { target: { value: 'TypeScript' } });
    expect(screen.getByText(/Identified TypeScript gap yesterday/i)).toBeDefined();

    // Clear search
    fireEvent.change(searchInput, { target: { value: 'nonexistent topic' } });
    expect(await screen.findByText(/No Transcripts Found Matching/i)).toBeDefined();
  });
});
