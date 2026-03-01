import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import LoginScreen from '../screens/LoginScreen';
import SignUpScreen from '../screens/SignUpScreen';
import type { AuthStackParamList } from '../types/navigation';

const Stack = createNativeStackNavigator<AuthStackParamList>();

type LoginScreenProps = NativeStackScreenProps<AuthStackParamList, 'Login'>;
type SignUpScreenProps = NativeStackScreenProps<AuthStackParamList, 'SignUp'>;

/**
 * Authentication stack navigator
 * Only accessible when user is not signed in
 */
export default function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login">
        {(props: LoginScreenProps) => <LoginScreen navigation={props.navigation} />}
      </Stack.Screen>
      <Stack.Screen name="SignUp">
        {(props: SignUpScreenProps) => <SignUpScreen navigation={props.navigation} />}
      </Stack.Screen>
    </Stack.Navigator>
  );
}
