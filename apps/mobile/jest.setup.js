jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
// Icon fonts are not loaded in tests.
jest.mock('@expo/vector-icons/Ionicons', () => 'Ionicons');
