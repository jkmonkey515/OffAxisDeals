import { View, Text, StyleSheet } from 'react-native';

export default function AdminScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Admin Panel</Text>
      <Text style={styles.subtitle}>Admin only - gated by Guard</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
});

