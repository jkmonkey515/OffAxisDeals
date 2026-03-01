import { Pressable, Text, StyleSheet, ViewStyle } from 'react-native';
import { useNavigation } from '@react-navigation/native';

interface BackButtonProps {
  onPress?: () => void;
  size?: number;
  style?: ViewStyle;
  accessibilityLabel?: string;
}

export default function BackButton({
  onPress,
  size = 24,
  style,
  accessibilityLabel = 'Back',
}: BackButtonProps) {
  const navigation = useNavigation();

  const handlePress = () => {
    if (onPress) {
      onPress();
    } else if (navigation.canGoBack()) {
      navigation.goBack();
    }
  };

  return (
    <Pressable
      onPress={handlePress}
      style={[styles.button, style]}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      accessibilityLabel={accessibilityLabel}
      accessibilityRole="button"
    >
      <Text style={[styles.icon, { fontSize: size }]}>←</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    padding: 8,
  },
  icon: {
    color: '#000',
    fontWeight: '400',
  },
});
