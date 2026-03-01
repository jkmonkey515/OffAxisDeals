import { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabaseClient } from '../lib/supabase';
import { colors, spacing, typography } from '../theme';

interface User {
  id: string;
  full_name: string | null;
  company_name: string | null;
}

interface MarkAsSoldModalProps {
  visible: boolean;
  listingId: string;
  onClose: () => void;
  onSave: () => void;
}

interface ClosedDealInsert {
  listing_id: string;
  wholesaler_id: string;
  sold_to_name: string;
  sold_to_profile_id: string | null;
  sold_price: number | null;
  wholesale_fee: number | null;
  closed_at: string | null;
  notes: string | null;
}

interface ListingUpdate {
  status: 'sold';
}

export default function MarkAsSoldModal({
  visible,
  listingId,
  onClose,
  onSave,
}: MarkAsSoldModalProps) {
  const [buyerSearchQuery, setBuyerSearchQuery] = useState('');
  const [buyerSearchResults, setBuyerSearchResults] = useState<User[]>([]);
  const [showBuyerResults, setShowBuyerResults] = useState(false);
  const [selectedBuyer, setSelectedBuyer] = useState<User | null>(null);
  const [soldTo, setSoldTo] = useState('');
  const [finalSalePrice, setFinalSalePrice] = useState('');
  const [wholesaleFee, setWholesaleFee] = useState('');
  const [closingDate, setClosingDate] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Set default closing date to today
  useEffect(() => {
    if (visible && !closingDate) {
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, '0');
      const day = String(today.getDate()).padStart(2, '0');
      setClosingDate(`${year}-${month}-${day}`);
    }
  }, [visible, closingDate]);

  // Reset form when modal closes
  useEffect(() => {
    if (!visible) {
      setBuyerSearchQuery('');
      setBuyerSearchResults([]);
      setShowBuyerResults(false);
      setSelectedBuyer(null);
      setSoldTo('');
      setFinalSalePrice('');
      setWholesaleFee('');
      setNotes('');
      setClosingDate('');
      setSearchError(null);
    }
  }, [visible]);

  // Update soldTo when buyer is selected
  useEffect(() => {
    if (selectedBuyer) {
      const displayName = selectedBuyer.company_name || selectedBuyer.full_name || 'Unknown';
      setSoldTo(displayName);
    }
  }, [selectedBuyer]);

  // Search users by name
  const searchUsers = useCallback(async (query: string) => {
    if (!query.trim() || query.length < 2) {
      setBuyerSearchResults([]);
      setShowBuyerResults(false);
      setSearchError(null);
      return;
    }

    // Don't search if there's a persistent error (user needs to change input)
    if (searchError) {
      return;
    }

    try {
      const { data, error } = await supabaseClient
        .from('profiles')
        .select('id, full_name, company_name')
        .or(`full_name.ilike.%${query}%,company_name.ilike.%${query}%`)
        .limit(10);

      if (error) {
        console.error('[MarkAsSoldModal] User search error:', error);
        setBuyerSearchResults([]);
        setShowBuyerResults(false);
        setSearchError('Unable to search users. Please try again.');
        return;
      }

      setBuyerSearchResults((data || []) as User[]);
      setShowBuyerResults(true);
      setSearchError(null);
    } catch (err) {
      console.error('[MarkAsSoldModal] User search exception:', err);
      setBuyerSearchResults([]);
      setShowBuyerResults(false);
      setSearchError('Unable to search users. Please try again.');
    }
  }, [searchError]);

  // Debounced search
  const handleBuyerSearchChange = useCallback((text: string) => {
    setBuyerSearchQuery(text);
    setSelectedBuyer(null);
    // Clear error when user changes input
    setSearchError(null);

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (text.trim().length === 0) {
      setBuyerSearchResults([]);
      setShowBuyerResults(false);
      setSearchError(null);
      return;
    }

    debounceTimerRef.current = setTimeout(() => {
      searchUsers(text);
    }, 300);
  }, [searchUsers]);

  const handleSelectBuyer = useCallback((user: User) => {
    setSelectedBuyer(user);
    setBuyerSearchQuery('');
    setBuyerSearchResults([]);
    setShowBuyerResults(false);
  }, []);

  const handleClearBuyer = useCallback(() => {
    setSelectedBuyer(null);
    setBuyerSearchQuery('');
    setSoldTo('');
  }, []);

  const handleSave = useCallback(async () => {
    // Validate sold_to is required
    if (!soldTo.trim()) {
      Alert.alert('Validation Error', 'Sold to (name or company) is required.');
      return;
    }

    setSaving(true);
    try {
      // Get current user
      const { data: { user }, error: userError } = await supabaseClient.auth.getUser();
      
      if (userError || !user) {
        Alert.alert('Error', 'Unable to get current user. Please try again.');
        setSaving(false);
        return;
      }

      // Build closed_deals insert payload
      const closedDealData: ClosedDealInsert = {
        listing_id: listingId,
        wholesaler_id: user.id,
        sold_to_name: soldTo.trim(),
        sold_to_profile_id: selectedBuyer?.id ?? null,
        sold_price: null,
        wholesale_fee: null,
        closed_at: null,
        notes: null,
      };

      // Parse optional numeric fields
      if (finalSalePrice.trim()) {
        const price = parseFloat(finalSalePrice.trim());
        if (!isNaN(price) && price > 0) {
          closedDealData.sold_price = price;
        }
      }

      if (wholesaleFee.trim()) {
        const fee = parseFloat(wholesaleFee.trim());
        if (!isNaN(fee) && fee >= 0) {
          closedDealData.wholesale_fee = fee;
        }
      }

      // Convert closing date to ISO timestamptz
      if (closingDate.trim()) {
        // Convert YYYY-MM-DD to ISO string (e.g., "2024-01-15" -> "2024-01-15T00:00:00Z")
        closedDealData.closed_at = `${closingDate.trim()}T00:00:00Z`;
      }

      if (notes.trim()) {
        closedDealData.notes = notes.trim();
      }

      // Step 1: Insert into closed_deals
      const { error: insertError } = await supabaseClient
        .from('closed_deals')
        .insert([closedDealData]);

      if (insertError) {
        Alert.alert('Error', insertError.message || 'Failed to create closed deal record.');
        setSaving(false);
        return;
      }

      // Step 2: Update listing status to 'sold'
      const listingUpdate: ListingUpdate = {
        status: 'sold',
      };

      const { error: updateError } = await supabaseClient
        .from('listings')
        .update(listingUpdate)
        .eq('id', listingId);

      if (updateError) {
        Alert.alert('Error', updateError.message || 'Failed to update listing status.');
        setSaving(false);
        return;
      }

      onSave();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to mark listing as sold.';
      Alert.alert('Error', message);
    } finally {
      setSaving(false);
    }
  }, [listingId, soldTo, selectedBuyer, finalSalePrice, wholesaleFee, closingDate, notes, onSave, onClose]);

  // Cleanup debounce timer
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Mark as Sold</Text>
          <TouchableOpacity onPress={onClose} disabled={saving}>
            <Text style={styles.closeButton}>Cancel</Text>
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content} keyboardShouldPersistTaps="handled">
          {/* Buyer Search */}
          <View style={styles.fieldContainer}>
            <Text style={styles.label}>Search for buyer (optional)</Text>
            <View style={styles.searchContainer}>
              <TextInput
                style={styles.input}
                placeholder="Search by name or company"
                placeholderTextColor={colors.textTertiary}
                value={selectedBuyer ? (selectedBuyer.company_name || selectedBuyer.full_name || 'Unknown') : buyerSearchQuery}
                onChangeText={handleBuyerSearchChange}
                editable={!selectedBuyer && !saving}
                autoCapitalize="words"
                autoCorrect={false}
              />
              {selectedBuyer && (
                <TouchableOpacity
                  style={styles.clearButton}
                  onPress={handleClearBuyer}
                  disabled={saving}
                >
                  <Text style={styles.clearButtonText}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>
            {searchError && (
              <Text style={styles.errorText}>{searchError}</Text>
            )}
            {showBuyerResults && buyerSearchResults.length > 0 && (
              <View style={styles.resultsContainer}>
                <ScrollView
                  keyboardShouldPersistTaps="always"
                  nestedScrollEnabled={true}
                  style={styles.resultsScrollView}
                >
                  {buyerSearchResults.map((item) => {
                    const displayName = item.company_name || item.full_name || 'Unknown';
                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={styles.buyerResultItem}
                        onPress={() => handleSelectBuyer(item)}
                      >
                        <Text style={styles.buyerResultName}>{displayName}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </ScrollView>
              </View>
            )}
          </View>

          {/* Sold To */}
          <View style={styles.fieldContainer}>
            <Text style={styles.label}>
              Sold to (name or company) <Text style={styles.required}>*</Text>
            </Text>
            <TextInput
              style={styles.input}
              placeholder="Enter buyer name or company"
              placeholderTextColor={colors.textTertiary}
              value={soldTo}
              onChangeText={setSoldTo}
              editable={!saving}
            />
          </View>

          {/* Final Sale Price */}
          <View style={styles.fieldContainer}>
            <Text style={styles.label}>Final Sale Price (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="0.00"
              placeholderTextColor={colors.textTertiary}
              value={finalSalePrice}
              onChangeText={setFinalSalePrice}
              keyboardType="decimal-pad"
              editable={!saving}
            />
          </View>

          {/* Wholesale Fee */}
          <View style={styles.fieldContainer}>
            <Text style={styles.label}>Wholesale Fee (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="0.00"
              placeholderTextColor={colors.textTertiary}
              value={wholesaleFee}
              onChangeText={setWholesaleFee}
              keyboardType="decimal-pad"
              editable={!saving}
            />
          </View>

          {/* Closing Date */}
          <View style={styles.fieldContainer}>
            <Text style={styles.label}>Closing Date (optional)</Text>
            <TextInput
              style={styles.input}
              placeholder="YYYY-MM-DD"
              placeholderTextColor={colors.textTertiary}
              value={closingDate}
              onChangeText={setClosingDate}
              editable={!saving}
            />
          </View>

          {/* Notes */}
          <View style={styles.fieldContainer}>
            <Text style={styles.label}>Notes (optional)</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              placeholder="Add any additional notes"
              placeholderTextColor={colors.textTertiary}
              value={notes}
              onChangeText={setNotes}
              multiline
              numberOfLines={4}
              textAlignVertical="top"
              editable={!saving}
            />
          </View>
        </ScrollView>

        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.saveButton, saving && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            {saving ? (
              <ActivityIndicator size="small" color={colors.textInverse} />
            ) : (
              <Text style={styles.saveButtonText}>Save</Text>
            )}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
    color: colors.text,
  },
  closeButton: {
    fontSize: typography.fontSize.base,
    color: colors.primary,
    fontWeight: typography.fontWeight.medium,
  },
  content: {
    flex: 1,
    padding: spacing.md,
  },
  fieldContainer: {
    marginBottom: spacing.md,
  },
  label: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.text,
    marginBottom: spacing.xs,
  },
  required: {
    color: colors.danger,
  },
  input: {
    backgroundColor: colors.backgroundElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    fontSize: typography.fontSize.base,
    color: colors.text,
    minHeight: 44,
  },
  textArea: {
    minHeight: 100,
    paddingTop: spacing.sm,
  },
  searchContainer: {
    position: 'relative',
  },
  clearButton: {
    position: 'absolute',
    right: spacing.sm,
    top: 8,
    padding: spacing.xs,
  },
  clearButtonText: {
    fontSize: typography.fontSize.sm,
    color: colors.primary,
    fontWeight: typography.fontWeight.medium,
  },
  resultsContainer: {
    marginTop: spacing.xs,
    maxHeight: 200,
    backgroundColor: colors.backgroundElevated,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    overflow: 'hidden',
  },
  resultsScrollView: {
    flexGrow: 0,
  },
  buyerResultItem: {
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderLight,
  },
  buyerResultName: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.medium,
    color: colors.text,
  },
  errorText: {
    fontSize: typography.fontSize.sm,
    color: colors.danger,
    marginTop: spacing.xs,
  },
  footer: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  saveButton: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.textInverse,
  },
});
