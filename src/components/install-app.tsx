'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function standalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  );
}
function subscribeStandalone(callback: () => void) {
  const media = window.matchMedia('(display-mode: standalone)');
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}

export function InstallApp({ showLabel = false }: { showLabel?: boolean }) {
  const isStandalone = useSyncExternalStore(subscribeStandalone, standalone, () => true);
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [open, setOpen] = useState(false);
  const [ios, setIos] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    function beforeInstall(event: Event) {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    }
    function appInstalled() {
      setInstalled(true);
      setPrompt(null);
      setOpen(false);
    }
    window.addEventListener('beforeinstallprompt', beforeInstall);
    window.addEventListener('appinstalled', appInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', beforeInstall);
      window.removeEventListener('appinstalled', appInstalled);
    };
  }, []);

  async function install() {
    if (prompt) {
      setInstalling(true);
      try {
        await prompt.prompt();
        const { outcome } = await prompt.userChoice;
        if (outcome === 'accepted') setInstalled(true);
        return;
      } catch {
        // Browser prompts may expire; the manual instructions remain available.
      } finally {
        setPrompt(null);
        setInstalling(false);
      }
    }
    setIos(
      /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
    );
    setOpen(true);
  }

  if (isStandalone || installed) return null;
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        aria-label="Install aplikasi"
        disabled={installing}
        onClick={() => void install()}
      >
        <Download />
        <span className={showLabel ? undefined : 'hidden sm:inline'}>Install</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Install QR Review</DialogTitle>
            <DialogDescription>
              Buka QR Review langsung dari ikon aplikasi di perangkat Anda.
            </DialogDescription>
          </DialogHeader>
          {ios ? (
            <ol className="list-decimal space-y-3 pl-5 text-sm leading-relaxed">
              <li>Buka situs ini di Safari.</li>
              <li>
                Ketuk <strong>Bagikan (Share)</strong>, lalu{' '}
                <strong>Tambahkan ke Layar Utama (Add to Home Screen)</strong>.
              </li>
              <li>
                Aktifkan <strong>Buka sebagai App (Open as Web App)</strong> jika pilihan itu
                tersedia, lalu ketuk <strong>Tambah (Add)</strong>.
              </li>
            </ol>
          ) : (
            <div className="space-y-3 text-sm leading-relaxed">
              <p>
                <strong>Android:</strong> buka di Chrome, ketuk menu ⋮, lalu pilih{' '}
                <strong>Install aplikasi</strong> atau <strong>Tambahkan ke layar utama</strong>.
              </p>
              <p>
                <strong>Komputer:</strong> gunakan ikon install di bilah alamat Chrome/Edge atau
                pilihan install di menu browser. Di Safari Mac, pilih{' '}
                <strong>File → Add to Dock</strong>.
              </p>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            Gunakan browser langsung saat membuka tautan dari WhatsApp atau Instagram. Aplikasi
            memerlukan koneksi internet.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
