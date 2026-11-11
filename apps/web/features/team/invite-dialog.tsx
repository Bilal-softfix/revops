'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import {
  type InviteRequest,
  type Role,
  assignableRoles,
  inviteRequestSchema,
} from '@revops/shared';
import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { applyApiError } from '@/lib/forms';
import { common } from '@/lib/strings/common';
import { shellStrings } from '@/lib/strings/shell';
import { teamStrings as s } from '@/lib/strings/team';
import { useInvite } from './queries';

export function InviteDialog({ actorRole }: { actorRole: Role }) {
  const [open, setOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const invite = useInvite();
  const roles = assignableRoles(actorRole);
  const form = useForm<z.input<typeof inviteRequestSchema>, unknown, InviteRequest>({
    resolver: zodResolver(inviteRequestSchema),
    defaultValues: { email: '', role: 'agent' },
  });

  const onSubmit = form.handleSubmit(async (values) => {
    setFormError(null);
    try {
      await invite.mutateAsync(values);
      toast.success(s.invite.sent(values.email));
      form.reset();
      setOpen(false);
    } catch (error) {
      setFormError(applyApiError(error, form.setError, ['email', 'role']));
    }
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setFormError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <UserPlus aria-hidden />
          {s.invite.open}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{s.invite.title}</DialogTitle>
          <DialogDescription>{s.invite.body}</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          onSubmit={(event) => void onSubmit(event)}
          className="grid gap-4"
          id="invite-form"
        >
          <FormError message={formError} />
          <TextField
            label={s.invite.email}
            type="email"
            autoComplete="off"
            error={form.formState.errors.email?.message}
            {...form.register('email')}
          />
          <div className="grid gap-1.5">
            <Label htmlFor="invite-role">{s.invite.role}</Label>
            <Controller
              control={form.control}
              name="role"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger id="invite-role" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((role) => (
                      <SelectItem key={role} value={role}>
                        {shellStrings.roles[role]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        </form>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{common.cancel}</Button>
          </DialogClose>
          <Button type="submit" form="invite-form" disabled={form.formState.isSubmitting}>
            {s.invite.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
