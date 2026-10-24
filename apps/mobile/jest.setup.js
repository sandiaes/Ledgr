// The drawer and the gesture handler run on native code in the app; in tests they are the
// libraries' own mocks.
import 'react-native-gesture-handler/jestSetup';

jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => require('react-native-reanimated/mock'));
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
// Icon fonts are not loaded in tests.
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');

// The hardware back button: `BackHandler.mockPressBack()` runs the listeners last registered
// first, like Android, and exits the app when none handles the press.
jest.mock('react-native/Libraries/Utilities/BackHandler', () => {
  const listeners = [];
  const BackHandler = {
    exitApp: jest.fn(),
    addEventListener: (_event, listener) => {
      listeners.push(listener);
      return {
        remove: () => {
          const i = listeners.indexOf(listener);
          if (i >= 0) listeners.splice(i, 1);
        },
      };
    },
    mockPressBack: () => {
      for (const listener of [...listeners].reverse()) if (listener()) return true;
      BackHandler.exitApp();
      return false;
    },
  };
  return { __esModule: true, default: BackHandler };
});
