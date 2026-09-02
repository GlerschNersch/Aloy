import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import RouteIntelligenceDashboard from './RouteIntelligenceDashboard';
import * as networkService from '../services/networkTraceService';

// Mock framer-motion to avoid animation issues in jsdom
vi.mock('framer-motion', () => ({
  motion: {
    div: ({ children, className, style, onClick, ...props }) => (
      <div className={className} style={style} onClick={onClick} {...props}>
        {children}
      </div>
    ),
    button: ({ children, className, style, onClick, ...props }) => (
      <button className={className} style={style} onClick={onClick} {...props}>
        {children}
      </button>
    )
  },
  AnimatePresence: ({ children }) => <>{children}</>
}));

vi.mock('../services/networkTraceService', () => ({
  fetchRouteTrace: vi.fn()
}));

describe('RouteIntelligenceDashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    networkService.fetchRouteTrace.mockResolvedValue({
      success: true,
      target: '1.1.1.1',
      protocol: 'ICMP',
      totalHops: 2,
      destinationIp: '1.1.1.1',
      finalRtt: 14.0,
      hops: [
        {
          hop: 1,
          ip: '192.168.1.1',
          hostname: 'gateway.local',
          rtt: [1.1],
          avgRtt: 1.1,
          loss: 0,
          type: 'LAN',
          location: { city: 'Local Network', country: 'Home', flag: '🏠' },
          as: 'RFC1918',
          org: 'Local Subnet',
          isIxp: false,
          isCdn: false
        },
        {
          hop: 2,
          ip: '1.1.1.1',
          hostname: 'one.one.one.one',
          rtt: [14.0],
          avgRtt: 14.0,
          loss: 0,
          type: 'DESTINATION',
          location: { city: 'Seattle, WA', country: 'US', flag: '🇺🇸' },
          as: 'AS13335',
          org: 'Cloudflare, Inc.',
          isIxp: false,
          isCdn: true
        }
      ]
    });
  });

  it('renders header, target query bar, and presets', async () => {
    render(<RouteIntelligenceDashboard isFullPage={true} onClose={vi.fn()} />);
    expect(screen.getByText(/Route Intelligence & Telemetry/i)).toBeDefined();
    expect(screen.getByPlaceholderText(/Enter IP, hostname, or domain/i)).toBeDefined();
    expect(screen.getByText('Cloudflare DNS')).toBeDefined();
    expect(screen.getByText('Google DNS')).toBeDefined();
  });

  it('allows protocol switching and renders hops', async () => {
    render(<RouteIntelligenceDashboard isFullPage={true} onClose={vi.fn()} />);
    const tcpButtons = screen.getAllByText('TCP');
    expect(tcpButtons.length).toBeGreaterThan(0);
    fireEvent.click(tcpButtons[0]);

    await waitFor(() => {
      expect(screen.getByText('192.168.1.1')).toBeDefined();
    });
  });
});
