'use client';

import { useState, type ReactNode, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, PackagePlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { FormError, InputField, SubmitButton } from '@/components/common';
import { useAdminApi } from '@/components/providers';
import { useAction } from '@/hooks/use-action';
import type { Batch } from '@/lib/types';

export function CreateBatch({ children }: { children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const api = useAdminApi();
  const queries = useQueryClient();
  const router = useRouter();
  const action = useAction((body: { label: string; quantity: number }, key) =>
    api<Batch>('/api/v1/admin/batches', { method: 'POST', body, key }),
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await action.run({
      label: String(form.get('label')).trim(),
      quantity: Number(form.get('quantity')),
    });
    if (!result) return;
    toast.success(`Batch ${result.data.label} berhasil dibuat.`);
    void queries.invalidateQueries({ queryKey: ['admin'] });
    setOpen(false);
    router.push(`/admin/batches/${result.data.id}`);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!action.pending) {
          setOpen(value);
          action.clearError();
        }
      }}
    >
      <DialogTrigger asChild>
        {children || (
          <Button>
            <Plus />
            Buat batch
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        className="sm:max-w-lg"
        onInteractOutside={(event) => {
          if (action.pending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <span className="mb-3 flex size-12 items-center justify-center rounded-xl border bg-muted">
            <PackagePlus className="size-6" />
          </span>
          <DialogTitle>Buat batch QR baru</DialogTitle>
          <DialogDescription>
            Beri nama batch agar produksi dan stok mudah dilacak.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-5 pt-3">
          <InputField
            label="Nama batch"
            name="label"
            placeholder="Produksi Oktober 2026"
            required
            maxLength={120}
            autoFocus
            error={action.error}
          />
          <InputField
            label="Jumlah unit"
            name="quantity"
            type="number"
            defaultValue={100}
            min={1}
            max={500}
            step={1}
            required
            help="Buat 1–500 QR unik dalam satu batch."
            error={action.error}
          />
          <div className="rounded-lg bg-muted p-4 text-xs leading-relaxed text-muted-foreground">
            Setelah dibuat, unduh QR publik untuk cetak dan kode aktivasi dalam paket terpisah.
            Paket kode tersedia maksimal 24 jam dan perlu diunduh sebelum aktivasi unit pertama.
          </div>
          <FormError error={action.error} cooldown={action.cooldown} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={action.pending}
            >
              Batal
            </Button>
            <SubmitButton pending={action.pending} cooldown={action.cooldown}>
              Buat batch
            </SubmitButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
