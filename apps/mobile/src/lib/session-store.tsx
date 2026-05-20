/* Light state store for the active session. Auth screens write to this,
 * every other screen reads. Independent of expo-secure-store so layout can
 * decide synchronously whether to render the auth gate.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { clearSession, loadSession, saveSession, type Session } from './session';

interface Value {
  session: Session | null;
  loading: boolean;
  signIn: (session: Session) => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<Value | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadSession().then((s) => {
      setSession(s);
      setLoading(false);
    });
  }, []);

  const signIn = useCallback(async (next: Session) => {
    await saveSession(next);
    setSession(next);
  }, []);

  const signOut = useCallback(async () => {
    await clearSession();
    setSession(null);
  }, []);

  const value = useMemo<Value>(
    () => ({ session, loading, signIn, signOut }),
    [session, loading, signIn, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Value {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSession must be called inside <SessionProvider>');
  return v;
}
