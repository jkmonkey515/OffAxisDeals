# Map Screen Setup Instructions

## Installation

The Map screen requires two additional packages:

1. **react-native-maps** - For rendering the map
2. **expo-location** - For requesting location permissions

### Install packages:

```bash
npx expo install react-native-maps expo-location
```

### iOS Configuration

For iOS, you may need to add Google Maps API key to `app.config.js` if you want to use Google Maps (currently configured to use Google Maps provider).

If you encounter issues with Google Maps on iOS, you can:
1. Remove `provider={PROVIDER_GOOGLE}` from MapView to use Apple Maps (default on iOS)
2. Or add your Google Maps API key to `app.config.js`:

```javascript
ios: {
  config: {
    googleMapsApiKey: 'YOUR_GOOGLE_MAPS_API_KEY',
  },
}
```

### Android Configuration

Android should work out of the box with the current configuration. The location permissions are already added to `app.config.js`.

## Database Schema

The Map screen assumes the `listings` table has the following columns:
- `latitude` (numeric/decimal)
- `longitude` (numeric/decimal)
- `id` (uuid)
- `title` (text, optional)
- `address` (text, optional)
- `cover_image_url` (text, optional)

If your columns have different names (e.g., `lat`, `lng`, `location`), update the query in `src/screens/MapScreen.tsx` accordingly.

## Testing Checklist

### 1. Permission Granted Path
- [ ] Open the Map tab
- [ ] Grant location permission when prompted
- [ ] Verify map centers on your current location
- [ ] Verify user location indicator (blue dot) appears
- [ ] Verify listings markers appear on the map

### 2. Permission Denied Path
- [ ] Clear app data or deny location permission
- [ ] Open the Map tab
- [ ] Deny location permission when prompted
- [ ] Verify map centers on default region (Tucson, AZ)
- [ ] Verify no user location indicator appears
- [ ] Verify listings markers still appear (if any in Tucson area)

### 3. Search This Area Refresh
- [ ] Pan/zoom the map to a different area
- [ ] Tap "Search this area" button
- [ ] Verify loading indicator appears on button
- [ ] Verify new listings appear for the visible region
- [ ] Verify markers update correctly

### 4. Marker Tap Navigation
- [ ] Tap a marker on the map
- [ ] Verify navigation to Listing Details screen
- [ ] Verify the correct listing details are displayed
- [ ] Verify back navigation returns to Map screen

### Additional Tests
- [ ] Verify Map tab appears in correct position (after Messages, before Settings for investors; after PostDeal, before Settings for wholesalers)
- [ ] Verify Map tab is only visible for paid users (gated by `useHeatmap` permission)
- [ ] Verify compliance disclaimer appears at bottom of map
- [ ] Verify "Search this area" button floats above tab bar
- [ ] Test on both iOS and Android devices

