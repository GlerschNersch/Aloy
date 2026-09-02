import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import CommandPalette from './CommandPalette';

describe('CommandPalette (Ctrl+K Spotlight)', () => {
  const mockOnClose = vi.fn();
  const mockOnSelectView = vi.fn();
  const mockOnAskAloy = vi.fn();
  const mockOnExecuteHAService = vi.fn();

  const sampleCategories = {
    lights: [{ entity_id: 'light.office', name: 'Office Light', state: 'on' }],
    switches: [{ entity_id: 'switch.fan', name: 'Desk Fan', state: 'off' }],
    locks: [{ entity_id: 'lock.front', name: 'Front Door', state: 'locked' }]
  };

  it('renders spotlight modal and commands when isOpen is true', () => {
    render(
      <CommandPalette
        isOpen={true}
        onClose={mockOnClose}
        onSelectView={mockOnSelectView}
        onAskAloy={mockOnAskAloy}
        haCategories={sampleCategories}
        onExecuteHAService={mockOnExecuteHAService}
      />
    );

    expect(screen.getByPlaceholderText(/Search studios, smart home devices/i)).toBeDefined();
    expect(screen.getByText('Hephaestus (HEPH)')).toBeDefined();
    expect(screen.getByText('Athena (SCOUT)')).toBeDefined();
    expect(screen.getByText('Turn Off Office Light')).toBeDefined();
  });

  it('filters commands when typing in the search box', () => {
    render(
      <CommandPalette
        isOpen={true}
        onClose={mockOnClose}
        onSelectView={mockOnSelectView}
        onAskAloy={mockOnAskAloy}
        haCategories={sampleCategories}
        onExecuteHAService={mockOnExecuteHAService}
      />
    );

    const input = screen.getByPlaceholderText(/Search studios, smart home devices/i);
    fireEvent.change(input, { target: { value: 'Hephaestus' } });

    expect(screen.getByText('Hephaestus (HEPH)')).toBeDefined();
    expect(screen.queryByText('Athena (SCOUT)')).toBeNull();
  });

  it('triggers view navigation and closes palette when clicking a studio command', () => {
    render(
      <CommandPalette
        isOpen={true}
        onClose={mockOnClose}
        onSelectView={mockOnSelectView}
        onAskAloy={mockOnAskAloy}
        haCategories={sampleCategories}
        onExecuteHAService={mockOnExecuteHAService}
      />
    );

    const hephCmd = screen.getByText('Hephaestus (HEPH)');
    fireEvent.click(hephCmd);

    expect(mockOnSelectView).toHaveBeenCalledWith('hephaestus');
    expect(mockOnClose).toHaveBeenCalled();
  });

  it('triggers smart home service when selecting a smart home command', () => {
    render(
      <CommandPalette
        isOpen={true}
        onClose={mockOnClose}
        onSelectView={mockOnSelectView}
        onAskAloy={mockOnAskAloy}
        haCategories={sampleCategories}
        onExecuteHAService={mockOnExecuteHAService}
      />
    );

    const lightCmd = screen.getByText('Turn Off Office Light');
    fireEvent.click(lightCmd);

    expect(mockOnExecuteHAService).toHaveBeenCalledWith('light', 'turn_off', 'light.office');
    expect(mockOnClose).toHaveBeenCalled();
  });
});
