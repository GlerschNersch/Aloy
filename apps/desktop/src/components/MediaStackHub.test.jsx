import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import MediaStackHub from './MediaStackHub';

describe('MediaStackHub Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({ ok: true });
  });

  it('renders all four services (Sonarr, Radarr, Lidarr, RetroArr)', () => {
    render(<MediaStackHub onClose={vi.fn()} />);

    expect(screen.getByText('Media Stack Hub')).toBeDefined();
    expect(screen.getByText('Sonarr')).toBeDefined();
    expect(screen.getByText('Radarr')).toBeDefined();
    expect(screen.getByText('Lidarr')).toBeDefined();
    expect(screen.getByText('RetroArr')).toBeDefined();
  });

  it('switches active service and updates iframe src on tab click', async () => {
    render(<MediaStackHub onClose={vi.fn()} />);

    // Initially Sonarr is selected
    const iframe = screen.getByTitle('Sonarr');
    expect(iframe).toBeDefined();
    expect(iframe.getAttribute('src')).toBe('http://localhost:8989');

    // Click RetroArr tab
    fireEvent.click(screen.getByText('RetroArr'));

    await waitFor(() => {
      const retroIframe = screen.getByTitle('RetroArr');
      expect(retroIframe).toBeDefined();
      expect(retroIframe.getAttribute('src')).toBe('http://localhost:5002');
    });
  });

  it('opens external browser when clicking Open Browser action', () => {
    const openSpy = vi.spyOn(window, 'open').mockImplementation(() => {});
    render(<MediaStackHub onClose={vi.fn()} />);

    const openBtn = screen.getByRole('button', { name: /Open Browser/i });
    fireEvent.click(openBtn);

    expect(openSpy).toHaveBeenCalledWith('http://localhost:8989', '_blank', 'noopener,noreferrer');
  });

  it('restarts a single service via the local server when its restart icon is clicked', async () => {
    render(<MediaStackHub onClose={vi.fn()} />);

    // Sonarr's tab has a title="Restart Sonarr" (client-side ping defaults
    // isOnline to true until checkHealth resolves).
    await waitFor(() => {
      expect(screen.getByTitle(/Restart Sonarr|Start Sonarr/)).toBeDefined();
    });
    fireEvent.click(screen.getByTitle(/Restart Sonarr|Start Sonarr/));

    await waitFor(() => {
      const restartCall = global.fetch.mock.calls.find(([url]) =>
        String(url).includes('/api/arr/service/sonarr/restart')
      );
      expect(restartCall).toBeDefined();
      expect(restartCall[1]?.method).toBe('POST');
    });
  });

  it('restarts the whole stack when clicking the Restart All header action', async () => {
    render(<MediaStackHub onClose={vi.fn()} />);

    const restartAllBtn = screen.getByRole('button', { name: /Restart All/i });
    fireEvent.click(restartAllBtn);

    await waitFor(() => {
      const restartCall = global.fetch.mock.calls.find(([url]) =>
        String(url).includes('/api/arr/stack/restart')
      );
      expect(restartCall).toBeDefined();
      expect(restartCall[1]?.method).toBe('POST');
    });
  });
});
