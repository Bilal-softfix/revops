'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { resetPasswordRequestSchema } from '@revops/shared';
import Link from 'next/link';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { FormError, TextField } from '@/components/form/text-field';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api/client';
import { applyApiError } from '@/lib/forms';
import { authStrings as s } from '@/lib/strings/auth';
import { AuthCard } from './auth-card';

const resetFormSchema = resetPasswordRequestSchema
  .extend({ confirm: z.string() })
  .refine((v) => v.password === v.confirm, {
    path: ['confirm'],
    message: 'Passwords don’t match',
  });
type ResetForm = z.infer<typeof resetFormSchema>;

export function ResetPasswordForm({ token }: { token: string }) {
  const [done, setDone] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof resetFormSchema>, unknown, ResetForm>({
    resolver: zodResolver(resetFormSchema),
    defaultValues: { token, password: '', confirm: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async ({ token: t, password }) => {
    setFormError(null);
    try {
      await api('/v1/auth/reset-password', { method: 'POST', body: { token: t, password } });
      setDone(true);
    } catch (error) {
      setFormError(applyApiError(error, form.setError, ['password']));
    }
  });

  if (done) {
    return (
      <AuthCard title={s.reset.doneTitle} description={s.reset.doneBody}>
        <Button asChild>
          <Link href="/login">{s.toLogin}</Link>
        </Button>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={s.reset.title} description={s.reset.body}>
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="grid gap-4">
        <FormError message={formError} />
        <input type="hidden" {...form.register('token')} />
        <TextField
          label={s.newPassword}
          type="password"
          autoComplete="new-password"
          hint={s.passwordHint}
          error={errors.password?.message}
          {...form.register('password')}
        />
        <TextField
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          error={errors.confirm?.message}
          {...form.register('confirm')}
        />
        <Button type="submit" disabled={isSubmitting}>
          {s.reset.submit}
        </Button>
      </form>
    </AuthCard>
  );
}
