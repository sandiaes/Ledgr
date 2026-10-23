import { verifyCode } from '@ledgr/client';
import { useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useServices } from '../services';
import { Button } from '../ui/parts';
import { colors, space } from '../ui/theme';
import { useGate } from './AuthGate';
import { errorCode } from './errors';

function Screen(props: { title: string; children: ReactNode }) {
  return (
    <KeyboardAvoidingView behavior="height" style={styles.screen}>
      <View style={styles.box}>
        <Text style={styles.brand}>Ledgr</Text>
        <Text style={styles.title} accessibilityRole="header">
          {props.title}
        </Text>
        {props.children}
      </View>
    </KeyboardAvoidingView>
  );
}

export function LoadingScreen() {
  return (
    <View style={styles.screen}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

/** The configuration is unsafe or incomplete: names the variable, never its value. */
export function StartupErrorScreen({ problem }: { problem: string }) {
  return (
    <Screen title="Cannot start">
      <Text style={styles.text}>{problem}</Text>
      <Text style={styles.hint}>
        Fix apps/mobile/.env (or the EAS environment variables) and restart. See docs/mobile-run.md.
      </Text>
    </Screen>
  );
}

export function SignInScreen() {
  const { auth } = useServices();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    const { error: e } = await auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (e) setError(`Sign-in failed (${errorCode(e)})`);
    // On success onAuthStateChange moves the gate on (to the code prompt).
  };

  return (
    <Screen title="Sign in">
      <TextInput
        style={styles.input}
        placeholder="Email"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        style={styles.input}
        placeholder="Password"
        secureTextEntry
        autoComplete="password"
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={submit}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button
        label={busy ? 'Signing in…' : 'Sign in'}
        onPress={submit}
        disabled={busy || !email || !password}
      />
    </Screen>
  );
}

/** Every aal1 session lands here: a 6-digit TOTP code from the authenticator app. */
export function MfaChallengeScreen({ factorId }: { factorId: string }) {
  const { auth } = useServices();
  const { evaluate, signOut } = useGate();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await verifyCode(auth, factorId, code);
      evaluate();
    } catch (e) {
      setError(
        /6-digit/.test(e instanceof Error ? e.message : '')
          ? 'Enter the 6-digit code from your authenticator'
          : `That code did not work (${errorCode(e)})`,
      );
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen title="Two-factor code">
      <Text style={styles.text}>Enter the 6-digit code from your authenticator app.</Text>
      <TextInput
        style={[styles.input, styles.code]}
        placeholder="123456"
        keyboardType="number-pad"
        autoComplete="one-time-code"
        maxLength={7}
        value={code}
        onChangeText={setCode}
        onSubmitEditing={submit}
        accessibilityLabel="Authenticator code"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <Button label={busy ? 'Checking…' : 'Verify'} onPress={submit} disabled={busy} />
      <Button label="Sign out" kind="plain" onPress={signOut} />
    </Screen>
  );
}

/** Signed in, but no verified TOTP factor: enrollment happens in the desktop app. */
export function NoAuthenticatorScreen() {
  const { signOut } = useGate();
  return (
    <Screen title="Set up two-factor sign-in first">
      <Text style={styles.text}>
        This account has no authenticator app enrolled, so Ledgr cannot show any data. Enroll one on
        the desktop page (Ledgr desktop → sign in → scan the QR code → verify a code), then sign in
        here again.
      </Text>
      <Button label="Sign out" onPress={signOut} />
    </Screen>
  );
}

export function GateErrorScreen({ code }: { code: string }) {
  const { evaluate, signOut } = useGate();
  return (
    <Screen title="Cannot check your sign-in">
      <Text style={styles.text}>Ledgr could not reach the server ({code}).</Text>
      <Button label="Try again" onPress={evaluate} />
      <Button label="Sign out" kind="plain" onPress={signOut} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, justifyContent: 'center', backgroundColor: colors.background },
  box: { padding: space.xl },
  brand: { fontSize: 15, fontWeight: '700', color: colors.accent, marginBottom: space.sm },
  title: { fontSize: 24, fontWeight: '700', color: colors.text, marginBottom: space.lg },
  text: { fontSize: 15, color: colors.text, lineHeight: 21, marginBottom: space.md },
  hint: { fontSize: 13, color: colors.muted },
  input: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    fontSize: 16,
    marginBottom: space.md,
  },
  code: { fontSize: 24, letterSpacing: 6, textAlign: 'center' },
  error: { color: colors.loss, marginBottom: space.sm },
});
