import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { SignupForm } from '@/features/auth/signup-form';
import { getSession } from '@/lib/api/server';

export const metadata: Metadata = { title: 'Create account' };

export default async function SignupPage() {
  if (await getSession()) redirect('/dashboard');
  return <SignupForm />;
}
