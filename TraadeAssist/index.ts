// ⚡ Import Unistyles FIRST — before Expo Router evaluates any route files.
// Without this, StyleSheet.create theme functions crash because
// StyleSheet.configure hasn't run yet when routes are discovered.
// See: https://www.unistyl.es/v3/guides/expo-router/#modify-main-entry
import './unistyles';

import 'expo-router/entry';
