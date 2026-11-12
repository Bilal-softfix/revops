'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type EmailOnlyRequest, emailOnlyRequestSchema } from '@revops/shared';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FormError, TextField } from '@/components/form/text-field';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api/client';
import { applyApiError } from '@/lib/forms';
import { authStrings as s } from '@/lib/strings/auth';
import { AuthCard } from './auth-card';

export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof emailOnlyRequestSchema>, unknown, EmailOnlyRequest>({
    resolver: zodResolver(emailOnlyRequestSchema),
    defaultValues: { email: '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api('/v1/auth/forgot-password', { method: 'POST', body: values });
      setSent(true);
    } catch (error) {
      setFormError(applyApiError(error, form.setError, ['email']));
    }
  });

  if (sent) {
    return (
      <AuthCard title={s.forgot.sentTitle} description={s.forgot.sentBody}>
        <Button asChild variant="outline">
          <Link href="/login">{s.toLogin}</Link>
        </Button>
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title={s.forgot.title}
      description={s.forgot.body}
      footer={
        <Link className="underline" href="/login">
          {s.toLogin}
        </Link>
      }
    >
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="grid gap-4">
        <FormError message={formError} />
        <TextField
          label={s.email}
          type="email"
          autoComplete="email"
          error={form.formState.errors.email?.message}
          {...form.register('email')}
        />
        <Button type="submit" disabled={form.formState.isSubmitting}>
          {s.forgot.submit}
        </Button>
      </form>
    </AuthCard>
  );
}
