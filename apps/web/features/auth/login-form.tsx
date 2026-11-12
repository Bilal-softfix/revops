'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type LoginRequest, loginRequestSchema, sessionResponseSchema } from '@revops/shared';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import type { z } from 'zod';
import { FormError, TextField } from '@/components/form/text-field';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api/client';
import { ApiError } from '@/lib/api/problem';
import { applyApiError } from '@/lib/forms';
import { authStrings as s } from '@/lib/strings/auth';
import { AuthCard } from './auth-card';

export function LoginForm({ next, email }: { next: string; email?: string | undefined }) {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const [unverifiedHint, setUnverifiedHint] = useState(false);
  const form = useForm<z.input<typeof loginRequestSchema>, unknown, LoginRequest>({
    resolver: zodResolver(loginRequestSchema),
    defaultValues: { email: email ?? '', password: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await api('/v1/auth/login', {
        method: 'POST',
        body: values,
        schema: sessionResponseSchema,
      });
      router.replace(next);
      router.refresh();
    } catch (error) {
      // An unverified account gets the same 401 as a wrong password (no account oracle); the
      // API re-sends its verification link, so point people at their inbox too.
      setUnverifiedHint(error instanceof ApiError && error.code === 'invalid_credentials');
      setFormError(applyApiError(error, form.setError, ['email', 'password']));
    }
  });

  return (
    <AuthCard
      title={s.login.title}
      footer={
        <>
          {s.login.noAccount}{' '}
          <Link className="font-medium text-foreground underline" href="/signup">
            {s.login.signupLink}
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="grid gap-4">
        <FormError message={formError} />
        {unverifiedHint ? (
          <p className="text-xs text-muted-foreground">{s.login.unverifiedHint}</p>
        ) : null}
        <TextField
          label={s.email}
          type="email"
          autoComplete="email"
          error={errors.email?.message}
          {...form.register('email')}
        />
        <TextField
          label={s.password}
          type="password"
          autoComplete="current-password"
          error={errors.password?.message}
          {...form.register('password')}
        />
        <div className="flex items-center justify-between">
          <Link className="text-sm underline" href="/forgot-password">
            {s.login.forgot}
          </Link>
          <Button type="submit" disabled={isSubmitting}>
            {s.login.submit}
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}
