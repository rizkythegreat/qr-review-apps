'use client';
import { useCallback, useSyncExternalStore } from 'react';

declare global {
  interface Window {
    __qrReviewGrant?: { path: string; token: string };
  }
}
let snapshot: { path: string; token: string } | undefined;
export function useGrant(path: string) {
  const subscribe = useCallback(
    (listener: () => void) => {
      function capture() {
        if (window.location.hash) {
          snapshot = {
            path,
            token: new URLSearchParams(window.location.hash.slice(1)).get('grant') || '',
          };
          history.replaceState(
            history.state,
            '',
            window.location.pathname + window.location.search,
          );
        } else if (window.__qrReviewGrant?.path === path) {
          snapshot = window.__qrReviewGrant;
          delete window.__qrReviewGrant;
        } else if (snapshot?.path !== path) snapshot = { path, token: '' };
        listener();
      }
      capture();
      window.addEventListener('hashchange', capture);
      return () => window.removeEventListener('hashchange', capture);
    },
    [path],
  );
  const getSnapshot = useCallback(
    () => (snapshot?.path === path ? snapshot.token : undefined),
    [path],
  );
  return useSyncExternalStore(subscribe, getSnapshot, () => undefined);
}
