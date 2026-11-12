import type { Metadata } from 'next';
import { AuthCard } from '@/features/auth/auth-card';
import { VerifyEmailForm } from '@/features/auth/verify-email-form';
import { param } from '@/lib/redirect';
import { authStrings as s } from '@/lib/strings/auth';

export const metadata: Metadata = { title: 'Verify email' };

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const token = param((await searchParams).token);
  if (!token) {
    return (
      <AuthCard title={s.verify.title}>
        <p role="alert" className="text-sm text-destructive">
          {s.verify.missingToken}
        </p>
      </AuthCard>
    );
  }
  return <VerifyEmailForm token={token} />;
}
