import type { Metadata } from 'next';
import { AuthCard } from '@/features/auth/auth-card';
import { ResetPasswordForm } from '@/features/auth/reset-password-form';
import { param } from '@/lib/redirect';
import { authStrings as s } from '@/lib/strings/auth';

export const metadata: Metadata = { title: 'Choose a new password' };

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const token = param((await searchParams).token);
  if (!token) {
    return (
      <AuthCard title={s.reset.title}>
        <p role="alert" className="text-sm text-destructive">
          {s.reset.missingToken}
        </p>
      </AuthCard>
    );
  }
  return <ResetPasswordForm token={token} />;
}
