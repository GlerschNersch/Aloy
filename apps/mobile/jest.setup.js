// AsyncStorage has no native module available under jest's node environment
// (react-test-renderer, not a real device) — swap in the package's own
// in-memory mock, matching its documented jest setup.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest')
);

jest.mock('react-native-tts', () => ({
  getInitStatus: jest.fn().mockResolvedValue('success'),
  speak: jest.fn(),
  stop: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn()
}));

jest.mock('@notifee/react-native', () => ({
  requestPermission: jest.fn().mockResolvedValue({ authorizationStatus: 1 }),
  displayNotification: jest.fn().mockResolvedValue('notif-1'),
  createTriggerNotification: jest.fn().mockResolvedValue('trigger-1'),
  cancelNotification: jest.fn().mockResolvedValue(undefined),
  getTriggerNotificationIds: jest.fn().mockResolvedValue([]),
  createChannel: jest.fn().mockResolvedValue('channel-1'),
  AndroidImportance: { HIGH: 4, DEFAULT: 3 },
  TriggerType: { TIMESTAMP: 0 }
}));

global.fetch = jest.fn().mockImplementation(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve([])
  })
);

jest.mock('react-native-audio-recorder-player', () => {
  return jest.fn().mockImplementation(() => ({
    startRecorder: jest.fn().mockResolvedValue('file:///path/to/record.mp4'),
    stopRecorder: jest.fn().mockResolvedValue('file:///path/to/record.mp4'),
    addRecordBackListener: jest.fn(),
    removeRecordBackListener: jest.fn()
  }));
});

jest.mock('react-native-image-picker', () => ({
  launchImageLibrary: jest.fn()
}));
