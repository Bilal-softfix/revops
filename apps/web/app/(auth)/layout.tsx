import Link from 'next/link';
import type { ReactNode } from 'react';
import { common } from '@/lib/strings/common';

/** Signed-out pages: a centred card under the logo. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/40 px-4 py-10">
      <Link href="/login" className="text-xl font-semibold tracking-tight">
        {common.appName}
      </Link>
      <div className="w-full max-w-md">{children}</div>
    </main>
  );
}
