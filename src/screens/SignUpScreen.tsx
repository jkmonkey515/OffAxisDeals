import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Image,
  ScrollView,
} from 'react-native';
import { supabaseClient } from '../lib/supabase';
import type { UserRole } from '../contexts/AuthContext';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { AuthStackParamList } from '../types/navigation';
import { colors, spacing, typography } from '../theme';

interface SignUpScreenProps {
  navigation: NativeStackNavigationProp<AuthStackParamList, 'SignUp'>;
}

export default function SignUpScreen({ navigation }: SignUpScreenProps) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [selectedRole, setSelectedRole] = useState<UserRole>('wholesaler');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const validateInputs = () => {
    if (!email.trim()) {
      setError('Email is required');
      return false;
    }
    if (!email.includes('@')) {
      setError('Please enter a valid email address');
      return false;
    }
    if (!password.trim()) {
      setError('Password is required');
      return false;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters');
      return false;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return false;
    }
    return true;
  };

  const handleSignUp = async () => {
    setError('');
    setSuccess('');
    
    if (!validateInputs()) {
      return;
    }

    setLoading(true);

    const signUpEmail = email.trim();
    const signUpPassword = password;

    try {
      // Step 1: Create account with role/segment in metadata
      const { data, error: authError } = await supabaseClient.auth.signUp({
        email: signUpEmail,
        password: signUpPassword,
        options: {
          data: {
            role: selectedRole,
            segment: selectedRole, // Same value as role for consistency
          },
        },
      });

      if (authError) {
        console.log('[SIGNUP ERROR]', JSON.stringify(authError, null, 2));
        setError(authError.message);
        setLoading(false);
        return;
      }

      if (!data.user) {
        setError('Account creation failed - no user returned');
        setLoading(false);
        return;
      }

      // Log successful signup data
      console.log('[SIGNUP SUCCESS]', {
        userId: data.user?.id,
        role: selectedRole,
      });

      // Send welcome email (non-blocking) if role is investor or wholesaler
      const userId = data.user?.id ?? data.session?.user?.id;
      if (userId && selectedRole && (selectedRole === 'investor' || selectedRole === 'wholesaler')) {
        fetch('https://www.offaxisdeals.com/api/welcome-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId, role: selectedRole }),
        }).catch((err) => {
          if (__DEV__) {
            console.log('[WelcomeEmail] failed', err);
          }
        });
        if (__DEV__) {
          console.log('[WelcomeEmail] sent', { userId, role: selectedRole });
        }
      }

      // Step 2: Handle routing based on session
      // The trigger will create the profile with role from metadata
      if (data.session) {
        // Email confirmation disabled - session exists, AppNavigator will route to Home
        setSuccess('Account created successfully!');
        setLoading(false);
        return;
      }

      // Step 3: No session (email confirmation enabled) - sign in immediately
      const { error: signInError } = await supabaseClient.auth.signInWithPassword({
        email: signUpEmail,
        password: signUpPassword,
      });

      if (signInError) {
        setError(signInError.message);
        setLoading(false);
        return;
      }

      // Sign-in succeeded - show success message
      // Navigation will happen automatically via auth state change in AppNavigator
      setSuccess('Account created successfully!');
      setLoading(false);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'An unexpected error occurred';
      setError(errorMessage);
      setLoading(false);
    }
  };

  return (
    <ScrollView 
      contentContainerStyle={styles.scrollContent}
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.container}>
        <Image
          source={require('../../assets/icon.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <Text style={styles.title}>Sign Up</Text>

        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {success ? <Text style={styles.successText}>{success}</Text> : null}

      <TextInput
        style={styles.input}
        placeholder="Email"
        placeholderTextColor={colors.textTertiary}
        selectionColor={colors.primary}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        autoComplete="email"
        editable={!loading}
      />

      <TextInput
        style={styles.input}
        placeholder="Password"
        placeholderTextColor={colors.textTertiary}
        selectionColor={colors.primary}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="password-new"
        editable={!loading}
      />

      <TextInput
        style={styles.input}
        placeholder="Confirm Password"
        placeholderTextColor={colors.textTertiary}
        selectionColor={colors.primary}
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        secureTextEntry
        autoCapitalize="none"
        autoComplete="password-new"
        editable={!loading}
      />

      {/* Role Selector */}
      <View style={styles.roleSelector}>
        <Text style={styles.roleLabel}>I am a:</Text>
        <View style={styles.roleButtons}>
          <TouchableOpacity
            style={[
              styles.roleButton,
              selectedRole === 'wholesaler' && styles.roleButtonSelected,
            ]}
            onPress={() => setSelectedRole('wholesaler')}
            disabled={loading}
          >
            <Text
              style={[
                styles.roleButtonText,
                selectedRole === 'wholesaler' && styles.roleButtonTextSelected,
              ]}
            >
              Wholesaler
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.roleButton,
              selectedRole === 'investor' && styles.roleButtonSelected,
            ]}
            onPress={() => setSelectedRole('investor')}
            disabled={loading}
          >
            <Text
              style={[
                styles.roleButtonText,
                selectedRole === 'investor' && styles.roleButtonTextSelected,
              ]}
            >
              Investor
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.button, loading && styles.buttonDisabled]}
        onPress={handleSignUp}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Sign Up</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.linkButton}
        onPress={() => navigation.navigate('Login')}
        disabled={loading}
      >
        <Text style={styles.linkText}>Already have an account? Login</Text>
      </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    flexGrow: 1,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  logo: {
    width: 160,
    height: 160,
    alignSelf: 'center',
    marginBottom: spacing.lg,
  },
  title: {
    fontSize: typography.fontSize['3xl'],
    fontWeight: typography.fontWeight.bold,
    marginBottom: spacing.xl,
    textAlign: 'center',
    color: colors.text,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.sm,
    marginBottom: spacing.md,
    fontSize: typography.fontSize.base,
    color: colors.text,
    backgroundColor: colors.backgroundElevated,
  },
  roleSelector: {
    marginBottom: spacing.md,
  },
  roleLabel: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.medium,
    marginBottom: spacing.sm,
    color: colors.text,
  },
  roleButtons: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  roleButton: {
    flex: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    padding: spacing.sm,
    alignItems: 'center',
    backgroundColor: colors.backgroundElevated,
  },
  roleButtonSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  roleButtonText: {
    fontSize: typography.fontSize.base,
    color: colors.text,
    fontWeight: typography.fontWeight.medium,
  },
  roleButtonTextSelected: {
    color: colors.textInverse,
    fontWeight: typography.fontWeight.semibold,
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 8,
    padding: spacing.md,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: colors.textInverse,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
  linkButton: {
    marginTop: spacing.lg,
    alignItems: 'center',
  },
  linkText: {
    color: colors.primary,
    fontSize: typography.fontSize.sm,
  },
  errorText: {
    color: colors.danger,
    fontSize: typography.fontSize.sm,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  successText: {
    color: colors.success,
    fontSize: typography.fontSize.sm,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
});
