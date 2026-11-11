'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { type SignupRequest, signupRequestSchema, signupResponseSchema } from '@revops/shared';
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
import { ResendVerification } from './resend-verification';

export function SignupForm() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<z.input<typeof signupRequestSchema>, unknown, SignupRequest>({
    resolver: zodResolver(signupRequestSchema),
    defaultValues: { name: '', email: '', password: '', tenantName: '' },
  });
  const { errors, isSubmitting } = form.formState;

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      // Always 202 "check your email" — the outcome only ever arrives by email.
      await api('/v1/auth/signup', { method: 'POST', body: values, schema: signupResponseSchema });
      setSentTo(values.email);
    } catch (error) {
      setFormError(
        applyApiError(error, form.setError, ['name', 'email', 'password', 'tenantName']),
      );
    }
  });

  if (sentTo) {
    return (
      <AuthCard title={s.signup.sentTitle} description={s.signup.sentBody(sentTo)}>
        <ResendVerification email={sentTo} />
      </AuthCard>
    );
  }

  return (
    <AuthCard
      title={s.signup.title}
      footer={
        <>
          {s.signup.haveAccount}{' '}
          <Link className="font-medium text-foreground underline" href="/login">
            {s.signup.loginLink}
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={(event) => void onSubmit(event)} className="grid gap-4">
        <FormError message={formError} />
        <TextField
          label={s.name}
          autoComplete="name"
          error={errors.name?.message}
          {...form.register('name')}
        />
        <TextField
          label={s.tenantName}
          autoComplete="organization"
          error={errors.tenantName?.message}
          {...form.register('tenantName')}
        />
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
          autoComplete="new-password"
          hint={s.passwordHint}
          error={errors.password?.message}
          {...form.register('password')}
        />
        <Button type="submit" disabled={isSubmitting}>
          {s.signup.submit}
        </Button>
      </form>
    </AuthCard>
  );
}
