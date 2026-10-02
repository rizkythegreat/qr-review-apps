'use client';

import { useRef, useState, useEffect } from 'react';
import { ApiFailure } from '@/lib/api';

export function useAction<P, T>(action: (payload: P, key: string) => Promise<T>) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [cooldown, setCooldown] = useState(0);
  const lock = useRef(false);
  const attempt = useRef<{ payload: string; key: string; execute: () => Promise<T> } | null>(null);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  async function run(payload: P) {
    if (lock.current || cooldown > 0) return undefined;
    const fingerprint = JSON.stringify(payload);
    if (!attempt.current || attempt.current.payload !== fingerprint) {
      const key = crypto.randomUUID();
      // Keep the first callback too: retries retain the original If-Match and CSRF values.
      attempt.current = { payload: fingerprint, key, execute: () => action(payload, key) };
    }
    lock.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await attempt.current.execute();
      attempt.current = null;
      return result;
    } catch (failure) {
      setError(failure);
      if (failure instanceof ApiFailure) {
        setCooldown(Math.min(900, Math.max(0, failure.retryAfter)));
        if (failure.status > 0 && failure.status < 500 && failure.code !== 'REQUEST_IN_PROGRESS')
          attempt.current = null;
      }
      return undefined;
    } finally {
      lock.current = false;
      setPending(false);
    }
  }
  return { run, pending, error, cooldown, clearError: () => setError(null) };
}
