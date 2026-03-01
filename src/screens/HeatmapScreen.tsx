import { View, Text, StyleSheet } from 'react-native';
import { MapApproxLocationDisclaimer } from '../components/ComplianceText';

export default function HeatmapScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Heatmap</Text>
      <Text style={styles.subtitle}>Plus feature - gated by Guard</Text>

      {/* Compliance disclaimer near map */}
      <View style={styles.disclaimerContainer}>
        <MapApproxLocationDisclaimer />
      </View>
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
  disclaimerContainer: {
    marginTop: 20,
    paddingHorizontal: 20,
  },
});

