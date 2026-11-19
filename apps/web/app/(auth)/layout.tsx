import { CheckCircle2 } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/layout/logo';
import { authStrings as s } from '@/lib/strings/auth';

/** Signed-out pages: a brand panel (desktop) beside the form card. */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-indigo-600 via-indigo-700 to-violet-800 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-24 -right-24 size-96 rounded-full bg-white/10 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-32 -left-16 size-96 rounded-full bg-violet-400/20 blur-3xl"
        />
        <Link href="/login" className="relative">
          <Logo inverted />
        </Link>
        <div className="relative max-w-md space-y-6">
          <h2 className="text-3xl leading-tight font-semibold">{s.brand.headline}</h2>
          <p className="text-indigo-100">{s.brand.body}</p>
          <ul className="space-y-3">
            {s.brand.points.map((point) => (
              <li key={point} className="flex gap-3 text-sm text-indigo-50">
                <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-indigo-200" aria-hidden />
                {point}
              </li>
            ))}
          </ul>
        </div>
        <p className="relative text-xs text-indigo-200">{s.brand.footer}</p>
      </aside>
      <main className="flex flex-col items-center justify-center gap-8 bg-background px-4 py-10">
        <Link href="/login" className="lg:hidden">
          <Logo />
        </Link>
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
