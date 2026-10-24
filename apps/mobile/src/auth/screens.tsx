import { verifyCode } from '@ledgr/client';
import { useState, type ReactNode } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, StyleSheet, View } from 'react-native';
import { useServices } from '../services';
import { Button, Input } from '../ui/parts';
import { T } from '../ui/T';
import { CODE_LETTER_SPACING, space, type as typography, type Colors } from '../ui/theme';
import { useColors, useStyles } from '../ui/ThemeProvider';
import { useGate } from './AuthGate';
import { errorCode } from './errors';

function Screen(props: { title: string; children: ReactNode }) {
  const styles = useStyles(makeStyles);
  return (
    <KeyboardAvoidingView behavior="height" style={styles.screen}>
      <View style={styles.box}>
        <T variant="title2" tone="accent" style={styles.brand}>
          Ledgr
        </T>
        <T variant="title1" accessibilityRole="header" style={styles.title}>
          {props.title}
        </T>
        {props.children}
      </View>
    </KeyboardAvoidingView>
  );
}

export function LoadingScreen() {
  const styles = useStyles(makeStyles);
  const colors = useColors();
  return (
    <View style={styles.screen}>
      <ActivityIndicator color={colors.accent} />
    </View>
  );
}

/** The configuration is unsafe or incomplete: names the variable, never its value. */
export function StartupErrorScreen({ problem }: { problem: string }) {
  const styles = useStyles(makeStyles);
  return (
    <Screen title="Cannot start">
      <T variant="body" style={styles.text}>
        {problem}
      </T>
      <T variant="sub" tone="muted">
        Fix apps/mobile/.env (or the EAS environment variables) and restart. See docs/mobile-run.md.
      </T>
    </Screen>
  );
}

export function SignInScreen() {
  const styles = useStyles(makeStyles);
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
      <Input
        style={styles.input}
        placeholder="Email"
        accessibilityLabel="Email"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <Input
        style={styles.input}
        placeholder="Password"
        accessibilityLabel="Password"
        secureTextEntry
        autoComplete="password"
        value={password}
        onChangeText={setPassword}
        onSubmitEditing={submit}
      />
      {error ? (
        <T variant="sub" tone="loss" style={styles.error}>
          {error}
        </T>
      ) : null}
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
  const styles = useStyles(makeStyles);
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
      <T variant="body" style={styles.text}>
        Enter the 6-digit code from your authenticator app.
      </T>
      <Input
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
      {error ? (
        <T variant="sub" tone="loss" style={styles.error}>
          {error}
        </T>
      ) : null}
      <Button label={busy ? 'Checking…' : 'Verify'} onPress={submit} disabled={busy} />
      <Button label="Sign out" kind="plain" onPress={signOut} />
    </Screen>
  );
}

/** Signed in, but no verified TOTP factor: enrollment happens in the desktop app. */
export function NoAuthenticatorScreen() {
  const styles = useStyles(makeStyles);
  const { signOut } = useGate();
  return (
    <Screen title="Set up two-factor sign-in first">
      <T variant="body" style={styles.text}>
        This account has no authenticator app enrolled, so Ledgr cannot show any data. Enroll one on
        the desktop page (Ledgr desktop → sign in → scan the QR code → verify a code), then sign in
        here again.
      </T>
      <Button label="Sign out" onPress={signOut} />
    </Screen>
  );
}

export function GateErrorScreen({ code }: { code: string }) {
  const styles = useStyles(makeStyles);
  const { evaluate, signOut } = useGate();
  return (
    <Screen title="Cannot check your sign-in">
      <T variant="body" style={styles.text}>
        Ledgr could not reach the server ({code}).
      </T>
      <Button label="Try again" onPress={evaluate} />
      <Button label="Sign out" kind="plain" onPress={signOut} />
    </Screen>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, justifyContent: 'center', backgroundColor: colors.background },
    box: { padding: space.xl },
    brand: { marginBottom: space.sm },
    title: { marginBottom: space.lg },
    text: { marginBottom: space.md },
    input: { marginBottom: space.md },
    code: {
      ...typography.title1,
      letterSpacing: CODE_LETTER_SPACING,
      textAlign: 'center',
      fontVariant: ['tabular-nums'],
    },
    error: { marginBottom: space.sm },
  });
