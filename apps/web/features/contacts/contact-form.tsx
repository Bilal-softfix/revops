'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  type Contact,
  type ContactConflict,
  contactConflictSchema,
  createContactRequestSchema,
  formatPhone,
  normalizePhone,
} from '@revops/shared';
import Link from 'next/link';
import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import { FormError, TextField } from '@/components/form/text-field';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api/problem';
import { applyApiError } from '@/lib/forms';
import { contactStrings as s } from '@/lib/strings/contacts';

/** The form edits plain strings; the shared schemas normalise them (E.164, lower-case email). */
const formSchema = z.object({
  name: z.string(),
  phone: z.string(),
  email: z.string(),
  city: z.string(),
});
type FormValues = z.infer<typeof formSchema>;

export interface ContactFormValues {
  name: string;
  phone: string;
  email?: string | undefined;
  city?: string | undefined;
}

/** A conflict the user can act on: open the existing contact, or ask its owner/a manager. */
function ConflictNotice({ conflict }: { conflict: ContactConflict }) {
  const field = conflict.field === 'phone' ? 'phone number' : 'email';
  if (!conflict.contact) {
    return (
      <p role="alert" className="rounded-md bg-amber-500/10 px-3 py-2 text-sm">
        {s.conflict.hidden(field, conflict.ownerName)}
      </p>
    );
  }
  return (
    <p role="alert" className="rounded-md bg-amber-500/10 px-3 py-2 text-sm">
      {s.conflict.visible.replace('{field}', field)}{' '}
      <Link className="font-medium underline" href={`/contacts/${conflict.contact.id}`}>
        {conflict.contact.name}
      </Link>
    </p>
  );
}

export function ContactForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: Contact;
  submitLabel: string;
  onSubmit: (values: ContactFormValues) => Promise<unknown>;
}) {
  const [formError, setFormError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<ContactConflict | null>(null);
  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: initial?.name ?? '',
      phone: initial?.phoneE164 ? formatPhone(initial.phoneE164) : '',
      email: initial?.email ?? '',
      city: initial?.city ?? '',
    },
  });
  const phone = useWatch({ control: form.control, name: 'phone' });
  const normalised = phone ? normalizePhone(phone) : null;

  const submit = form.handleSubmit(async (values) => {
    setFormError(null);
    setConflict(null);
    // Validate with the shared request schema, so the browser and the API agree on every rule.
    const parsed = createContactRequestSchema.safeParse({
      name: values.name,
      phone: values.phone,
      ...(values.email.trim() ? { email: values.email } : {}),
      ...(values.city.trim() ? { city: values.city } : {}),
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0];
        if (key === 'name' || key === 'phone' || key === 'email' || key === 'city') {
          form.setError(key, { message: issue.message });
        }
      }
      return;
    }
    try {
      await onSubmit({
        name: values.name,
        phone: values.phone,
        email: values.email.trim() || undefined,
        city: values.city.trim() || undefined,
      });
    } catch (error) {
      const found =
        error instanceof ApiError && error.code === 'contact_exists'
          ? contactConflictSchema.safeParse(error.problem.conflict)
          : null;
      if (found?.success) {
        setConflict(found.data);
        return;
      }
      setFormError(applyApiError(error, form.setError, ['name', 'phone', 'email', 'city']));
    }
  });

  const { errors, isSubmitting } = form.formState;
  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="grid gap-4">
      <FormError message={formError} />
      {conflict ? <ConflictNotice conflict={conflict} /> : null}
      <TextField
        label={s.fields.name}
        autoComplete="off"
        error={errors.name?.message}
        {...form.register('name')}
      />
      <TextField
        label={s.fields.phone}
        type="tel"
        inputMode="tel"
        autoComplete="off"
        hint={normalised ? s.fields.phonePreview(formatPhone(normalised)) : s.fields.phoneHint}
        error={errors.phone?.message}
        {...form.register('phone')}
      />
      <TextField
        label={s.fields.email}
        type="email"
        autoComplete="off"
        error={errors.email?.message}
        {...form.register('email')}
      />
      <TextField
        label={s.fields.city}
        autoComplete="off"
        error={errors.city?.message}
        {...form.register('city')}
      />
      <Button type="submit" disabled={isSubmitting} className="justify-self-start">
        {submitLabel}
      </Button>
    </form>
  );
}
