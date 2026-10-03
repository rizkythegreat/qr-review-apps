'use client';

import { useSyncExternalStore } from 'react';

function standalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}

function subscribe(callback: () => void) {
  const media = window.matchMedia('(display-mode: standalone)');
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}

const serverBrowser = () => false;
const serverStandalone = () => true;

export function useStandalone(serverValue = false) {
  return useSyncExternalStore(
    subscribe,
    standalone,
    serverValue ? serverStandalone : serverBrowser,
  );
}
