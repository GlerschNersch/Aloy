import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Alert } from 'react-native';
import { FederationModal } from '../src/components/CommandCenter/FederationModal';

describe('FederationModal', () => {
  it('renders correctly with mesh peers, SPARC phases, and Arena leaderboard', async () => {
    const mockApiRequest = jest.fn().mockImplementation(async (method: string, path: string) => {
      if (path.includes('/federation/peers')) {
        return {
          success: true,
          nodeId: 'TEST-NODE-ALPHA',
          peers: [
            { id: 'peer-1', name: 'Athena Scout', trustLevel: 'STANDARD', status: 'online', circuitBreaker: 'CLOSED', latencyMs: 12 },
          ],
        };
      }
      if (path.includes('/sparc/workflows')) {
        return {
          success: true,
          workflows: [
            { id: 'wf-1', name: 'Media Automation', currentPhase: 'REFINEMENT', phasesCompleted: ['SPECIFICATION', 'PSEUDOCODE', 'ARCHITECTURE'], qualityScore: 98, status: 'in_progress' },
          ],
        };
      }
      if (path.includes('/arena/strategies')) {
        return {
          success: true,
          strategies: [
            { id: 'strat-1', name: 'Reasoning-Heavy CoT', elo: 1350, matchesPlayed: 20, wins: 17, losses: 3, winRate: 85.0, avgTokens: 780 },
          ],
        };
      }
      return { success: true };
    });

    const mockOnClose = jest.fn();

    let tree: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <FederationModal
          visible={true}
          onClose={mockOnClose}
          serverUrl="http://192.168.1.100:7890"
          apiRequest={mockApiRequest}
        />
      );
    });

    expect(tree).toBeDefined();
    const str = JSON.stringify(tree!.toJSON());
    expect(str).toContain('Federation & Arena');
    expect(str).toContain('TEST-NODE-ALPHA');
    expect(str).toContain('Athena Scout');
    expect(str).toContain('HMAC-SHA256');

    await ReactTestRenderer.act(async () => {
      tree!.unmount();
    });
  });

  it('runs an arena tournament and updates strategies', async () => {
    const mockApiRequest = jest.fn().mockImplementation(async (method: string, path: string) => {
      if (path.includes('/arena/tournament')) {
        return {
          success: true,
          matchesRun: 6,
          strategies: [
            { id: 'strat-leader', name: 'Mutated Super Prompt', elo: 1420, matchesPlayed: 30, wins: 26, losses: 4, winRate: 86.7, avgTokens: 690 },
          ],
        };
      }
      return { success: true };
    });

    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

    let tree: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <FederationModal
          visible={true}
          onClose={jest.fn()}
          serverUrl="http://192.168.1.100:7890"
          apiRequest={mockApiRequest}
        />
      );
    });

    expect(tree).toBeDefined();

    await ReactTestRenderer.act(async () => {
      tree!.unmount();
    });

    alertSpy.mockRestore();
  });
});
