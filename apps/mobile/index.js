/**
 * @format
 */

import { AppRegistry, LogBox } from 'react-native';
import App from './App';
import { name as appName } from './app.json';

// The dev-mode warning banner sits in an overlay layer that can intercept
// touches meant for the UI beneath it — silence it for now during testing.
LogBox.ignoreAllLogs(true);

AppRegistry.registerComponent(appName, () => App);
