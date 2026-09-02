import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MediaDispatcherPanel from './MediaDispatcherPanel';
import * as mediaService from '../services/mediaService';

vi.mock('../services/mediaService', () => ({
  fetchPlaybackTargets: vi.fn(),
  searchMediaLibrary: vi.fn(),
  dispatchMediaPlayback: vi.fn()
}));

describe('MediaDispatcherPanel Component', () => {
  const mockTargets = [
    { id: 'local', type: 'local', name: 'This PC (Desktop)', status: 'online' },
    { id: 'machine:bazzite', type: 'remote_machine', name: 'Bazzite Gaming Station', status: 'online' }
  ];

  const mockMedia = [
    {
      id: 'movie:Drunken Master (1978)',
      title: 'Drunken Master',
      year: 1978,
      category: 'Movies',
      filePath: 'P:\\Movies\\Drunken Master (1978)\\Drunken Master (1978).mp4',
      sizeBytes: 3833797550
    },
    {
      id: 'tv:The Simpsons - S05E02',
      title: 'S05E02 - Cape Feare',
      showTitle: 'The Simpsons',
      category: 'TV Shows',
      filePath: 'P:\\TV Shows\\The Simpsons (1989)\\Season 05\\The Simpsons - S05E02 - Cape Feare.mkv',
      sizeBytes: 543210000
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mediaService.fetchPlaybackTargets.mockResolvedValue(mockTargets);
    mediaService.searchMediaLibrary.mockResolvedValue(mockMedia);
    mediaService.dispatchMediaPlayback.mockResolvedValue({ success: true, message: 'Playing on Bazzite' });
  });

  it('renders header, target selector, and media list', async () => {
    render(<MediaDispatcherPanel isFullPage={true} onClose={vi.fn()} />);

    expect(screen.getByText(/UNIVERSAL MEDIA DISPATCHER/i)).toBeDefined();
    await waitFor(() => {
      expect(screen.getByText('This PC (Desktop)')).toBeDefined();
      expect(screen.getByText('Bazzite Gaming Station')).toBeDefined();
      expect(screen.getByText('Drunken Master')).toBeDefined();
    });
  });

  it('switches target device and triggers dispatch on click', async () => {
    render(<MediaDispatcherPanel isFullPage={true} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Bazzite Gaming Station')).toBeDefined();
    });

    // Select Bazzite
    fireEvent.click(screen.getByText('Bazzite Gaming Station'));

    // Click Play button
    const playButtons = screen.getAllByRole('button', { name: /Play on Bazzite/i });
    expect(playButtons.length).toBeGreaterThan(0);
    fireEvent.click(playButtons[0]);

    await waitFor(() => {
      expect(mediaService.dispatchMediaPlayback).toHaveBeenCalledWith({
        targetId: 'machine:bazzite',
        mediaPath: 'P:\\Movies\\Drunken Master (1978)\\Drunken Master (1978).mp4',
        mediaTitle: 'Drunken Master'
      });
      expect(screen.getByText(/Playing on Bazzite/i)).toBeDefined();
    });
  });
});
