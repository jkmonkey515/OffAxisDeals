import { Alert, Linking } from 'react-native';

/**
 * Open an external URL in the system browser with basic validation and error handling.
 */
export function openExternalUrl(url: string): void {
  if (!url || typeof url !== 'string') {
    Alert.alert('Unable to open link', 'Link is not available right now.');
    return;
  }

  const trimmed = url.trim();
  if (trimmed.length === 0) {
    Alert.alert('Unable to open link', 'Link is not available right now.');
    return;
  }

  Linking.canOpenURL(trimmed)
    .then((supported) => {
      if (!supported) {
        Alert.alert('Unable to open link', 'Your device cannot open this link.');
        return;
      }
      return Linking.openURL(trimmed);
    })
    .catch(() => {
      Alert.alert('Unable to open link', 'Something went wrong while opening this link.');
    });
}


