'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { nameSchema, passwordSchema, sessionResponseSchema } from '@revops/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { FormError, TextField } from '@/components/form/text-field';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/problem';
import { applyApiError } from '@/lib/forms';
import { authStrings as s } from '@/lib/strings/auth';
import { AuthCard } from './auth-card';

const newUserSchema = z.object({ name: nameSchema, password: passwordSchema });
type NewUser = z.infer<typeof newUserSchema>;

export interface AcceptInviteProps {
  token: string;
  /** Present when someone is signed in: they accept as themselves (token only). */
  signedIn: { email: string; csrfToken: string } | null;
}

/**
 * Accepting an invitation. Signed in → one click (the API checks the invited email matches).
 * Signed out → create an account (name + password; the link proves the email). An existing
 * account must sign in first: the API answers `invitation_login_required`.
 */
export function AcceptInviteForm({ token, signedIn }: AcceptInviteProps) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [busy, setBusy] = useState(false);
  const loginHref = `/login?next=${encodeURIComponent(`/accept-invite?token=${token}`)}`;
  const form = useForm<z.input<typeof newUserSchema>, unknown, NewUser>({
    resolver: zodResolver(newUserSchema),
    defaultValues: { name: '', password: '' },
  });

  const accept = async (body: Record<string, string>) => {
    setFormError(null);
    try {
      await api('/v1/invitations/accept', {
        method: 'POST',
        body: { token, ...body },
        schema: sessionResponseSchema,
        csrfToken: signedIn?.csrfToken,
      });
      router.replace('/dashboard');
      router.refresh();
    } catch (error) {
      setNeedsLogin(error instanceof ApiError && error.code === 'invitation_login_required');
      setFormError(applyApiError(error, form.setError, ['name', 'password']));
    }
  };

  const signOut = async () => {
    if (!signedIn) return;
    await api('/v1/auth/logout', { method: 'POST', csrfToken: signedIn.csrfToken }).catch(
      () => undefined,
    );
    router.refresh();
  };

  if (signedIn) {
    return (
      <AuthCard title={s.accept.title} description={s.accept.signedInBody(signedIn.email)}>
        <FormError message={formError} />
        <Button
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void accept({}).finally(() => setBusy(false));
          }}
        >
          {s.accept.submitExisting}
        </Button>
        <Button variant="link" onClick={() => void signOut()}>
          {s.accept.switchAccount}
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={s.accept.title}
      description={s.accept.newUserBody}
      footer={
        <>
          {s.accept.haveAccount}{' '}
          <Link className="font-medium text-foreground underline" href={loginHref}>
            {s.accept.loginToAccept}
          </Link>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(event) => void form.handleSubmit((values) => accept(values))(event)}
        className="grid gap-4"
      >
        <FormError message={formError} />
        {needsLogin ? (
          <Button asChild variant="outline">
            <Link href={loginHref}>{s.accept.loginToAccept}</Link>
          </Button>
        ) : null}
        <TextField
          label={s.name}
          autoComplete="name"
          error={form.formState.errors.name?.message}
          {...form.register('name')}
        />
        <TextField
          label={s.password}
          type="password"
          autoComplete="new-password"
          hint={s.passwordHint}
          error={form.formState.errors.password?.message}
          {...form.register('password')}
        />
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {s.accept.submitNew}
        </Button>
      </form>
    </AuthCard>
  );
}
