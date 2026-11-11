'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type EmailOnlyRequest, emailOnlyRequestSchema } from '@revops/shared';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FormError, TextField } from '@/components/form/text-field';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/messages';
import { authStrings as s } from '@/lib/strings/auth';

/** "Resend the email": always 202 (the API never reveals whether the email needs verifying). */
export function ResendVerification({ email }: { email?: string }) {
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const form = useForm<z.input<typeof emailOnlyRequestSchema>, unknown, EmailOnlyRequest>({
    resolver: zodResolver(emailOnlyRequestSchema),
    defaultValues: { email: email ?? '' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setError(null);
    try {
      await api('/v1/auth/resend-verification', { method: 'POST', body: values });
      setSent(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  });

  if (sent) return <p className="text-sm text-muted-foreground">{s.signup.resent}</p>;
  return (
    <form noValidate onSubmit={(event) => void onSubmit(event)} className="grid gap-3">
      <FormError message={error} />
      {email ? null : (
        <TextField
          label={s.email}
          type="email"
          autoComplete="email"
          error={form.formState.errors.email?.message}
          {...form.register('email')}
        />
      )}
      <Button type="submit" variant="outline" disabled={form.formState.isSubmitting}>
        {s.signup.resend}
      </Button>
    </form>
  );
}
