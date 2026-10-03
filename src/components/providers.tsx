'use client';

import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import { ThemeProvider } from 'next-themes';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { apiRequest, apiBlob, ApiFailure, type ApiOptions } from '@/lib/api';
import type { ApiResponse } from '@/lib/types';

interface AuthValue {
  client: SupabaseClient | null;
  session: Session | null;
  loading: boolean;
}
const AuthContext = createContext<AuthValue>({ client: null, session: null, loading: true });
export function Providers({
  children,
  supabaseUrl,
  publishableKey,
}: {
  children: ReactNode;
  supabaseUrl: string;
  publishableKey: string;
}) {
  const [queries] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15000, retry: false, refetchOnWindowFocus: true },
          mutations: { retry: false },
        },
      }),
  );
  const [auth, setAuth] = useState<AuthValue>({
    client: null,
    session: null,
    loading: Boolean(supabaseUrl && publishableKey),
  });
  useEffect(() => {
    if (!supabaseUrl || !publishableKey) return;
    const client = createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    });
    let alive = true;
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      setAuth({ client, session, loading: false });
      if (!session) queries.removeQueries({ queryKey: ['admin'] });
    });
    void client.auth.getSession().then(({ data }) => {
      if (alive) setAuth({ client, session: data.session, loading: false });
    });
    return () => {
      alive = false;
      subscription.unsubscribe();
      client.auth.stopAutoRefresh();
    };
  }, [supabaseUrl, publishableKey, queries]);
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="qr-review-theme"
    >
      <QueryClientProvider client={queries}>
        <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
export function useAdminBlob() {
  const { client } = useAdminAuth();
  return useCallback(
    async (path: string, options: ApiOptions = {}) => {
      const { data } = client ? await client.auth.getSession() : { data: { session: null } };
      if (!data.session) throw new ApiFailure('UNAUTHENTICATED', 'Silakan masuk kembali.', 401);
      return apiBlob(path, { ...options, bearer: data.session.access_token });
    },
    [client],
  );
}
export function useAdminAuth() {
  return useContext(AuthContext);
}
export function useAdminApi() {
  const { client } = useAdminAuth();
  return useCallback(
    async <T,>(path: string, options: ApiOptions = {}): Promise<ApiResponse<T>> => {
      const { data } = client ? await client.auth.getSession() : { data: { session: null } };
      if (!data.session) throw new ApiFailure('UNAUTHENTICATED', 'Silakan masuk kembali.', 401);
      return apiRequest<T>(path, { ...options, bearer: data.session.access_token });
    },
    [client],
  );
}
