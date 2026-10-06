import { useCallback, useEffect, useState } from 'react';
import type { UserSession } from '../../domain/session';
import { useServices } from '../services-context';

export function useSession() {
  const { auth } = useServices();
  const [session, setSession] = useState<UserSession | null>(null);
  const [pending, setPending] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setSession(await auth.getSession());
    } catch {
      setSession(null);
    } finally {
      setPending(false);
    }
  }, [auth]);

  useEffect(() => {
    let active = true;
    auth
      .getSession()
      .catch(() => null)
      .then((current) => {
        if (!active) return;
        setSession(current);
        setPending(false);
      });
    return () => {
      active = false;
    };
  }, [auth]);

  const signIn = async (email: string, password: string) => {
    const failure = await auth.signIn(email, password);
    if (!failure) await refresh();
    return failure;
  };

  const signOut = async () => {
    await auth.signOut();
    setSession(null);
  };

  return { session, pending, refresh, signIn, signOut };
}
