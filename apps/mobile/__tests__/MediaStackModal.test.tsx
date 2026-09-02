import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Alert } from 'react-native';
import { MediaStackModal } from '../src/components/CommandCenter/MediaStackModal';

describe('MediaStackModal', () => {
  it('renders correctly with 4 services and handles close', async () => {
    const mockApiRequest = jest.fn().mockResolvedValue({
      success: true,
      queue: [],
      sonarrConnected: true,
      radarrConnected: true,
      lidarrConnected: true,
      retroarrConnected: true,
    });
    const mockOnClose = jest.fn();

    let tree: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <MediaStackModal
          visible={true}
          onClose={mockOnClose}
          serverUrl="http://192.168.1.100:7890"
          apiRequest={mockApiRequest}
        />
      );
    });

    expect(tree).toBeDefined();
    const str = JSON.stringify(tree!.toJSON());
    expect(str).toContain('Media Stack Hub');
    expect(str).toContain('Sonarr');
    expect(str).toContain('Radarr');
    expect(str).toContain('Lidarr');
    expect(str).toContain('RetroArr');

    await ReactTestRenderer.act(async () => {
      tree!.unmount();
    });
  });

  it('restarts a single offline service after confirming the alert', async () => {
    const mockApiRequest = jest.fn().mockResolvedValue({
      success: true,
      queue: [],
      sonarrConnected: false,
      radarrConnected: true,
      lidarrConnected: false,
      retroarrConnected: true,
    });
    // Auto-confirm: invoke the non-cancel button, mirroring a user tapping
    // "Start"/"Restart" in the native alert.
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const confirmBtn = buttons?.find((b: any) => b.style !== 'cancel');
      confirmBtn?.onPress?.();
    });

    let tree: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <MediaStackModal
          visible={true}
          onClose={jest.fn()}
          serverUrl="http://192.168.1.100:7890"
          apiRequest={mockApiRequest}
        />
      );
    });

    const restartBtn = tree!.root.findByProps({ testID: 'restart-sonarr-btn' });
    await ReactTestRenderer.act(async () => {
      restartBtn.props.onPress();
    });

    expect(alertSpy).toHaveBeenCalled();
    expect(mockApiRequest).toHaveBeenCalledWith('POST', '/api/arr/service/sonarr/restart');

    await ReactTestRenderer.act(async () => {
      tree!.unmount();
    });
    alertSpy.mockRestore();
  });

  it('restarts the whole stack via the header action, hitting the stack route not a per-service one', async () => {
    const mockApiRequest = jest.fn().mockResolvedValue({ success: true, queue: [] });
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_title, _msg, buttons) => {
      const confirmBtn = buttons?.find((b: any) => b.style !== 'cancel');
      confirmBtn?.onPress?.();
    });

    let tree: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <MediaStackModal
          visible={true}
          onClose={jest.fn()}
          serverUrl="http://192.168.1.100:7890"
          apiRequest={mockApiRequest}
        />
      );
    });

    const restartAllBtn = tree!.root.findByProps({ testID: 'restart-all-btn' });
    await ReactTestRenderer.act(async () => {
      restartAllBtn.props.onPress();
    });

    expect(mockApiRequest).toHaveBeenCalledWith('POST', '/api/arr/stack/restart');

    await ReactTestRenderer.act(async () => {
      tree!.unmount();
    });
    alertSpy.mockRestore();
  });
});
