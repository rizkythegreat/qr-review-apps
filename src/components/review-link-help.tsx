'use client';

import { ExternalLink } from 'lucide-react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { supportedReviewUrl } from '@/lib/format';

export function ReviewLinkHelp({ value }: { value: string }) {
  const valid = supportedReviewUrl(value);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          Pastikan link membuka halaman ulasan bisnis yang tepat.
        </p>
        {valid ? (
          <Button asChild variant="outline" size="sm">
            <a href={value} target="_blank" rel="noopener noreferrer">
              <ExternalLink />
              Uji tujuan
            </a>
          </Button>
        ) : (
          <Button variant="outline" size="sm" disabled>
            <ExternalLink />
            Uji tujuan
          </Button>
        )}
      </div>
      <Accordion type="single" collapsible>
        <AccordionItem value="review-guide" className="border-b-0">
          <AccordionTrigger className="py-2 text-xs font-medium">
            Cara mendapatkan link review Google
          </AccordionTrigger>
          <AccordionContent className="space-y-3 text-xs leading-relaxed text-muted-foreground">
            <p>
              Buka Profil Bisnis Google toko Anda, pilih Baca Ulasan, lalu Dapatkan lebih banyak
              ulasan dan salin link yang diberikan. Buka link tersebut dan pastikan nama bisnisnya
              benar.
            </p>
            <p>Format yang didukung:</p>
            <ul className="list-inside list-disc space-y-1 font-mono text-[11px]">
              <li className="break-all">https://g.page/r/kode/review</li>
              <li className="break-all">https://search.google.com/local/writereview?placeid=ID</li>
            </ul>
            <p>
              Link pendek Maps belum dapat dipakai. Minta bantuan penjual bila link Anda memakai
              format lain.
            </p>
            <a
              href="https://support.google.com/business/answer/16816815?hl=id"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-foreground underline underline-offset-4"
            >
              Panduan resmi Google
              <ExternalLink className="size-3" />
            </a>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
