import { Suspense } from 'react';
import { LoginForm } from '@/components/login-form';
import { Brand, Loading } from '@/components/common';
import type { Metadata } from 'next';
import { ThemeToggle } from '@/components/theme-toggle';
import { InstallApp } from '@/components/install-app';

export const metadata: Metadata = { title: 'Masuk admin' };
export default function AdminLoginPage() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-8 bg-muted/40 px-5 py-10">
      <div className="flex items-center gap-4">
        <Brand />
        <ThemeToggle />
      </div>
      <div className="w-full max-w-sm md:max-w-4xl">
        <Suspense fallback={<Loading />}>
          <LoginForm />
        </Suspense>
        <div className="mt-5 flex justify-center">
          <InstallApp showLabel />
        </div>
      </div>
    </main>
  );
}
