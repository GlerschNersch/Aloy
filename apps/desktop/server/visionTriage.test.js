import { describe, it, expect } from 'vitest';
import { triageSnapshot } from './visionTriage.cjs';

describe('Vision Triage Engine (Athena Spec)', () => {
  it('classifies front door snapshot as delivery event when appropriate', async () => {
    const res = await triageSnapshot({
      cameraName: 'Front Door Porch',
      sourceEvent: 'motion',
    });

    expect(res.camera).toBe('Front Door Porch');
    expect(res.isPerson).toBe(true);
    expect(res.isDeliveryDriver).toBe(true);
    expect(res.detectedItems).toContain('package');
    expect(res.recommendedAction).toBe('announce_delivery');
    expect(res.threatLevel).toBe('none');
  });

  it('classifies generic backyard perimeter motion without false delivery alert', async () => {
    const res = await triageSnapshot({
      cameraName: 'Backyard Garden',
      sourceEvent: 'motion',
    });

    expect(res.camera).toBe('Backyard Garden');
    expect(res.isDeliveryDriver).toBe(false);
    expect(res.recommendedAction).toBe('silent_log');
  });
});
