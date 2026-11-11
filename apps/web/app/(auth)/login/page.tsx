import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/features/auth/login-form';
import { getSession } from '@/lib/api/server';
import { param, safeNext } from '@/lib/redirect';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const next = safeNext(query.next);
  if (await getSession()) redirect(next);
  return <LoginForm next={next} email={param(query.email)} />;
}
