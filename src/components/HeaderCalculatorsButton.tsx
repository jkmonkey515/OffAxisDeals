import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface HeaderCalculatorsButtonProps {
  onPress: () => void;
}

export default function HeaderCalculatorsButton({ onPress }: HeaderCalculatorsButtonProps) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={styles.calculatorButton}
      activeOpacity={0.7}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
    >
      <View style={styles.calculatorContainer}>
        <Ionicons name="calculator-outline" size={22} color="#000" />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  calculatorButton: {
    padding: 10,
    minWidth: 44,
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
  },
  calculatorContainer: {
    position: 'relative',
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
