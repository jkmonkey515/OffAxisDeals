import { View, Text, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { SubscriptionNeutralNotice } from '../components/ComplianceText';

interface SubscriptionScreenProps {
  navigation: {
    goBack: () => void;
  };
}

export default function SubscriptionScreen({ navigation }: SubscriptionScreenProps) {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      <Text style={styles.title}>Subscription</Text>
      <Text style={styles.subtitle}>Coming soon</Text>

      <TouchableOpacity style={styles.backButton} onPress={navigation.goBack}>
        <Text style={styles.backButtonText}>Back</Text>
      </TouchableOpacity>

      {/* Compliance notice */}
      <View style={styles.noticeContainer}>
        <SubscriptionNeutralNotice />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  contentContainer: {
    flexGrow: 1,
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
    marginBottom: 24,
  },
  backButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  backButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  noticeContainer: {
    marginTop: 40,
    width: '100%',
  },
});


