const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

if (process.env.NODE_ENV !== "production") {
  console.log("[app.config] mapsKeyLen=", (process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY || "").length);
}

module.exports = ({ config }) => ({
  ...config,
  name: "Off Axis Deals",
  version: "1.0.2",
  icon: "./assets/icon.png",
  android: {
    ...config.android,
    package: "com.offaxisdeals.app",
    versionCode: 7,
    googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY || "",
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#0B1B2B",
    },
    config: {
      ...config.android?.config,
      googleMaps: {
        ...config.android?.config?.googleMaps,
        apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY || "",
      },
    },
  },
  ios: {
    ...config.ios,
    bundleIdentifier: "com.offaxisdeals.app",
    buildNumber: "7",
    entitlements: {
      ...config.ios?.entitlements,
      "aps-environment": "production",
    },
  },
  extra: {
    ...config.extra,
    eas: {
      projectId: "a50b8c3f-4c6f-4a77-9aab-baf9a81c4ade",
    },
    EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY:
      process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_API_KEY || "",
    EXPO_PUBLIC_GOOGLE_PLACES_API_KEY:
      process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY || "",
  },
});
