import { MfaRequiredError } from '@ledgr/client';
import { focusManager, QueryCache, QueryClient } from '@tanstack/react-query';
import { AppState } from 'react-native';

/**
 * In memory only, no persister: nothing financial is written to the phone. Kept (no
 * garbage-collection timer) until sign-out clears it or Android ends the process. A query refused for want of MFA sends the
 * gate back to the code prompt (`onMfaRequired`) instead of showing empty data.
 */
export function createQueryClient(onMfaRequired: () => void): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (e) => {
        if (e instanceof MfaRequiredError) onMfaRequired();
      },
    }),
    defaultOptions: {
      queries: {
        retry: (count, e) => !(e instanceof MfaRequiredError) && count < 2,
        refetchOnWindowFocus: true,
        gcTime: Infinity,
      },
    },
  });
}

/** "Focus" for TanStack Query is the app coming back to the foreground. */
focusManager.setEventListener((setFocused) => {
  const sub = AppState.addEventListener('change', (s) => setFocused(s === 'active'));
  return () => sub.remove();
});
