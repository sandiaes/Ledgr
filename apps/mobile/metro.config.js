// Expo's defaults already handle the pnpm workspace (packages/* are symlinked).
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
