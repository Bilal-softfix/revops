import type { Metadata } from 'next';
import { AcceptInviteForm } from '@/features/auth/accept-invite-form';
import { AuthCard } from '@/features/auth/auth-card';
import { getSession } from '@/lib/api/server';
import { param } from '@/lib/redirect';
import { authStrings as s } from '@/lib/strings/auth';

export const metadata: Metadata = { title: 'Accept invitation' };

export default async function AcceptInvitePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const token = param((await searchParams).token);
  if (!token) {
    return (
      <AuthCard title={s.accept.title}>
        <p role="alert" className="text-sm text-destructive">
          {s.accept.missingToken}
        </p>
      </AuthCard>
    );
  }
  const session = await getSession();
  return (
    <AcceptInviteForm
      token={token}
      signedIn={session ? { email: session.user.email, csrfToken: session.csrfToken } : null}
    />
  );
}
