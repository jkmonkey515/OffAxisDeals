import * as Sentry from '@sentry/react-native';
import { registerRootComponent } from 'expo';
import Constants from 'expo-constants';

import App from './App';

// DSN from Expo runtime config (app.config.js extra), not process.env.
const extra =
  Constants.expoConfig?.extra ?? (Constants.manifest as any)?.extra ?? {};
const dsn =
  (Constants.expoConfig?.extra?.EXPO_PUBLIC_SENTRY_DSN ?? "") as string;
const dsnPresent = typeof dsn === "string" && dsn.trim().length > 0;

if (__DEV__) {
  console.log("[Sentry] dsn present:", dsnPresent);
  console.log("[Sentry][debug] extra keys", Object.keys(extra));
  console.log("[Sentry][debug] has EXPO_PUBLIC_SENTRY_DSN", Boolean(extra.EXPO_PUBLIC_SENTRY_DSN));
}

// Init must run before any Sentry.wrap so "App Start Span" can finish. Only init when DSN is set.
if (dsnPresent) {
  Sentry.init({
    dsn: dsn.trim(),
    enableAutoSessionTracking: true,
    tracesSampleRate: 0.2,
    debug: __DEV__,
  });
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately. Sentry.wrap captures unhandled JS errors.
registerRootComponent(dsnPresent ? Sentry.wrap(App) : App);
