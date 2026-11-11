'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type VerifyEmailRequest, verifyEmailRequestSchema } from '@revops/shared';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FormError, TextField } from '@/components/form/text-field';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { api } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/messages';
import { ApiError } from '@/lib/api/problem';
import { common } from '@/lib/strings/common';
import { authStrings as s } from '@/lib/strings/auth';
import { AuthCard } from './auth-card';
import { ResendVerification } from './resend-verification';

type Outcome = 'verified' | 'deleted' | null;

/**
 * Verify needs the link AND the sign-up password (T4 decision): whoever signed up must also own
 * the inbox. "This wasn't me" deletes the unverified account and its workspace instead.
 */
export function VerifyEmailForm({ token }: { token: string }) {
  const [outcome, setOutcome] = useState<Outcome>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [linkDead, setLinkDead] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const form = useForm<z.input<typeof verifyEmailRequestSchema>, unknown, VerifyEmailRequest>({
    resolver: zodResolver(verifyEmailRequestSchema),
    defaultValues: { token, password: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api('/v1/auth/verify-email', { method: 'POST', body: values });
      setOutcome('verified');
    } catch (error) {
      setLinkDead(error instanceof ApiError && error.code === 'verification_failed');
      setFormError(errorMessage(error));
    }
  });

  const cancelSignup = async () => {
    setCancelling(true);
    setFormError(null);
    try {
      await api('/v1/auth/verify-email/cancel', { method: 'POST', body: { token } });
      setOutcome('deleted');
    } catch (error) {
      setFormError(errorMessage(error));
    } finally {
      setCancelling(false);
    }
  };

  if (outcome === 'verified') {
    return (
      <AuthCard title={s.verify.doneTitle} description={s.verify.doneBody}>
        <Button asChild>
          <Link href="/login">{s.toLogin}</Link>
        </Button>
      </AuthCard>
    );
  }
  if (outcome === 'deleted') {
    return (
      <AuthCard title={s.verify.deletedTitle} description={s.verify.deletedBody}>
        <Button asChild variant="outline">
          <Link href="/signup">{s.signup.title}</Link>
        </Button>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={s.verify.title} description={s.verify.body}>
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="grid gap-4">
        <FormError message={formError} />
        <input type="hidden" {...form.register('token')} />
        <TextField
          label={s.password}
          type="password"
          autoComplete="current-password"
          error={form.formState.errors.password?.message}
          {...form.register('password')}
        />
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {s.verify.submit}
        </Button>
      </form>
      {linkDead ? (
        <div className="grid gap-2 border-t pt-4">
          <p className="text-sm font-medium">{s.verify.newLink}</p>
          <ResendVerification />
        </div>
      ) : null}
      <Dialog>
        <DialogTrigger asChild>
          <Button variant="link" className="text-muted-foreground">
            {s.verify.notMe}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{s.verify.notMeConfirmTitle}</DialogTitle>
            <DialogDescription>{s.verify.notMeConfirmBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{common.cancel}</Button>
            </DialogClose>
            <Button variant="destructive" disabled={cancelling} onClick={() => void cancelSignup()}>
              {s.verify.notMeConfirm}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AuthCard>
  );
}
