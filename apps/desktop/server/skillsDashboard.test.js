import { describe, it, expect } from 'vitest';

const { categorize, isOpenGap, getSkillsDashboard } = require('./skillsDashboard.cjs');

describe('Skills Dashboard Aggregation & Categorization', () => {
  it('categorizes questions by keywords correctly', async () => {
    expect(await categorize('How do I configure a custom button-card in Home Assistant lovelace dashboard?')).toBe('Dashboards & Lovelace');
    expect(await categorize('What is the current temperature on the thermostat?')).toBe('Smart Home & Automations');
    expect(await categorize('Has the driveway camera detected any persons recently?')).toBe('Vision & Cameras');
    expect(await categorize('How do I write a React component using TypeScript and state hooks?')).toBe('Programming & Web Development');
    expect(await categorize('What is 42 times 18?')).toBe('General Knowledge');
  }, 15000);

  it('determines open gaps correctly based on teaching status', () => {
    expect(isOpenGap({ teachingStatus: 'pending' })).toBe(true);
    expect(isOpenGap({ teachingStatus: 'needs_review' })).toBe(true);
    expect(isOpenGap({ teachingStatus: 'error' })).toBe(true);
    expect(isOpenGap({ teachingStatus: 'confirmed' })).toBe(false);
    expect(isOpenGap({ teachingStatus: 'skipped' })).toBe(false);
  });

  it('calculates skills dashboard overview with correct categories and proficiency scores', async () => {
    const dashboard = await getSkillsDashboard();
    expect(dashboard).toHaveProperty('categories');
    expect(dashboard).toHaveProperty('overallProficiencyScore');
    expect(dashboard).toHaveProperty('needsReviewCount');
    expect(dashboard.categories.length).toBeGreaterThan(0);
    expect(typeof dashboard.overallProficiencyScore).toBe('number');
  });
});
