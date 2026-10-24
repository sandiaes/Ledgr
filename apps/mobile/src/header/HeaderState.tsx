import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

interface HeaderStateValue {
  expanded: boolean;
  setExpanded(expanded: boolean): void;
  toggle(): void;
}

const HeaderStateContext = createContext<HeaderStateValue | null>(null);

/**
 * Whether the header shows Portfolio value, Today's result and Total result. One state for
 * the whole app, so all tabs and the pushed detail screens agree. Not persisted: the app
 * always starts collapsed.
 */
export function HeaderStateProvider({ children }: { children: ReactNode }) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((e) => !e), []);
  const value = useMemo(() => ({ expanded, setExpanded, toggle }), [expanded, toggle]);
  return <HeaderStateContext.Provider value={value}>{children}</HeaderStateContext.Provider>;
}

export function useHeaderState(): HeaderStateValue {
  const value = useContext(HeaderStateContext);
  if (!value) throw new Error('HeaderStateProvider missing');
  return value;
}
