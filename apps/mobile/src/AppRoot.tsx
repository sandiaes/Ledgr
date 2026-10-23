import { QueryClientProvider } from '@tanstack/react-query';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthGateProvider, useGate } from './auth/AuthGate';
import {
  GateErrorScreen,
  LoadingScreen,
  MfaChallengeScreen,
  NoAuthenticatorScreen,
  SignInScreen,
} from './auth/screens';
import { createQueryClient } from './data/queryClient';
import { LockGate } from './lock/LockGate';
import { MainTabs } from './MainTabs';
import { ServicesProvider, type Services } from './services';
import { SettingsProvider } from './settings/SettingsProvider';

/** The whole app below the configuration check; `services` are faked in tests. */
export function AppRoot({ services }: { services: Services }) {
  return (
    <ServicesProvider services={services}>
      <SafeAreaProvider>
        <StatusBar style="dark" />
        <SettingsProvider>
          <Session />
        </SettingsProvider>
      </SafeAreaProvider>
    </ServicesProvider>
  );
}

function Session() {
  const reevaluate = useRef<() => void>(() => undefined);
  const [queryClient] = useState(() => createQueryClient(() => reevaluate.current()));
  const clear = useCallback(() => queryClient.clear(), [queryClient]);
  useEffect(() => clear, [clear]);
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGateProvider onSignedOut={clear}>
        <GateView reevaluate={reevaluate} onSignedOut={clear} />
      </AuthGateProvider>
    </QueryClientProvider>
  );
}

function GateView(props: { reevaluate: { current: () => void }; onSignedOut(): void }) {
  const { gate, evaluate } = useGate();
  const { onSignedOut } = props;
  props.reevaluate.current = evaluate;
  // However the session ended (sign-out, expired refresh token), the cache goes with it.
  useEffect(() => {
    if (gate.kind === 'signed-out') onSignedOut();
  }, [gate.kind, onSignedOut]);

  switch (gate.kind) {
    case 'loading':
      return <LoadingScreen />;
    case 'signed-out':
      return <SignInScreen />;
    case 'needs-code':
      return <MfaChallengeScreen factorId={gate.factorId} />;
    case 'needs-enrollment':
      return <NoAuthenticatorScreen />;
    case 'error':
      return <GateErrorScreen code={gate.code} />;
    case 'aal2':
      return (
        <LockGate>
          <MainTabs />
        </LockGate>
      );
  }
}
