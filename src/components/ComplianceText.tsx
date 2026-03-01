import { View, Text, StyleSheet } from 'react-native';

/**
 * Reusable compliance text components for Off Axis Deals app.
 * All text blocks include required disclaimers about marketplace-only nature,
 * user-provided content, no verification, no legal/financial/investment advice,
 * and transactions occurring between users.
 */

const baseTextStyle = {
  fontSize: 11,
  color: '#666',
  lineHeight: 16,
};

/**
 * Marketplace-only notice for ListingsBrowse footer
 */
export function MarketplaceOnlyNotice() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>
        Off Axis Deals is a marketplace only. All listings are user-provided and Off Axis Deals does not verify listings. 
        Off Axis Deals does not provide legal, financial, or investment advice. Transactions occur between users.
      </Text>
    </View>
  );
}

/**
 * Listing detail disclaimer for ListingDetails footer
 */
export function ListingDetailDisclaimer() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>
        This listing is user-provided and Off Axis Deals does not verify listings. 
        Off Axis Deals does not provide legal, financial, or investment advice. 
        Transactions occur between users. Off Axis Deals is a marketplace only.
      </Text>
    </View>
  );
}

/**
 * Map approximate location disclaimer for Heatmap/Map screen
 */
export function MapApproxLocationDisclaimer() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>
        Map locations are approximate and user-provided. Off Axis Deals does not verify locations. 
        Off Axis Deals is a marketplace only and does not provide legal, financial, or investment advice. 
        Transactions occur between users.
      </Text>
    </View>
  );
}

/**
 * Messaging disclaimer for Messaging screen
 */
export function MessagingDisclaimer() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>
        Messages are between users. Off Axis Deals is a marketplace only and does not verify user communications. 
        Off Axis Deals does not provide legal, financial, or investment advice. Transactions occur between users.
      </Text>
    </View>
  );
}

/**
 * Subscription neutral notice for Settings → Subscription screen
 */
export function SubscriptionNeutralNotice() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>
        Off Axis Deals is a marketplace only. All content is user-provided and Off Axis Deals does not verify listings or user information. 
        Off Axis Deals does not provide legal, financial, or investment advice. Transactions occur between users.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 12,
    backgroundColor: '#f9f9f9',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  text: {
    fontSize: 11,
    color: '#666',
    lineHeight: 16,
    textAlign: 'center',
  },
});

