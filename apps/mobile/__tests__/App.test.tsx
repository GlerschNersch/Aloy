import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import App from '../App';

// The previous version of this file rendered <App /> and asserted nothing at
// all — no expect(), and no unmount, so it could not detect the two failure
// classes that actually matter here (setState after unmount, and leaked
// intervals/timers). It passed even while AsyncStorage.setItem was throwing
// into a swallowed catch.

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('mounts without throwing', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<App />);
  });
  expect(tree).toBeDefined();
  expect(tree!.toJSON()).not.toBeNull();
  await ReactTestRenderer.act(async () => { tree!.unmount(); });
});

test('clears every timer it starts on unmount', async () => {
  // Guards the polling effects and the 15s Claude-revision timer. A leak here
  // means setState after unmount and a phone doing network work forever.
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<App />);
  });
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(1000); });
  await ReactTestRenderer.act(async () => { tree!.unmount(); });
  jest.advanceTimersToNextTimer();
  expect(jest.getTimerCount()).toBe(0);
});

test('does not warn about setState on an unmounted component', async () => {
  const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<App />);
  });
  await ReactTestRenderer.act(async () => { tree!.unmount(); });
  await ReactTestRenderer.act(async () => { jest.advanceTimersByTime(60000); });
  const offenders = errorSpy.mock.calls
    .map((c) => String(c[0]))
    .filter((m) => /unmounted component|not wrapped in act/i.test(m));
  expect(offenders).toEqual([]);
});

test('ships no hardcoded bearer token', () => {
  // Regression guard: a live 64-hex token was committed in this file, shipped
  // in the APK, and auto-persisted to AsyncStorage on first launch.
  const src = require('fs').readFileSync(require.resolve('../App.tsx'), 'utf8');
  expect(src).not.toMatch(/['"][0-9a-f]{32,}['"]/);
});
