'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { ErrorState, LoadingState } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { errorMessage } from '@/lib/api/messages';
import { ApiError } from '@/lib/api/problem';
import { useSession } from '@/lib/session';
import { common } from '@/lib/strings/common';
import { contactStrings as s } from '@/lib/strings/contacts';
import { ContactForm } from './contact-form';
import { useContact, useDeleteContact, useUpdateContact } from './queries';

export function ContactDetail({ id }: { id: string }) {
  const { can } = useSession();
  const router = useRouter();
  const contact = useContact(id);
  const update = useUpdateContact(id);
  const remove = useDeleteContact(id);
  const [confirmDelete, setConfirmDelete] = useState(false);

  if (contact.isPending) return <LoadingState rows={4} />;
  if (contact.isError) {
    // Not visible to this user or deleted: the same 404 either way (no existence oracle).
    if (contact.error instanceof ApiError && contact.error.status === 404) {
      return (
        <div className="mx-auto grid max-w-xl gap-3 text-center">
          <h1 className="text-xl font-semibold">{common.notFoundTitle}</h1>
          <p className="text-sm text-muted-foreground">{common.notFoundBody}</p>
          <Button asChild variant="outline" className="justify-self-center">
            <Link href="/contacts">{s.back}</Link>
          </Button>
        </div>
      );
    }
    return <ErrorState error={contact.error} onRetry={() => void contact.refetch()} />;
  }

  const data = contact.data;
  return (
    <div className="mx-auto grid max-w-2xl gap-6">
      <Link className="flex items-center gap-1 text-sm text-muted-foreground" href="/contacts">
        <ArrowLeft className="size-4" aria-hidden /> {s.back}
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{data.name}</h1>
        {can('contact.delete') ? (
          <Button variant="outline" onClick={() => setConfirmDelete(true)}>
            {s.delete}
          </Button>
        ) : null}
      </div>
      {can('contact.write') ? (
        <section aria-label={s.editTitle} className="rounded-lg border p-4">
          <ContactForm
            key={data.updatedAt}
            initial={data}
            submitLabel={s.save}
            onSubmit={async (values) => {
              await update.mutateAsync({
                name: values.name,
                phone: values.phone,
                email: values.email ?? null,
                city: values.city ?? null,
              });
              toast.success(s.saved);
            }}
          />
        </section>
      ) : null}

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{s.deleteConfirmTitle(data.name)}</DialogTitle>
            <DialogDescription>{s.deleteConfirmBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{common.cancel}</Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={remove.isPending}
              onClick={() =>
                void remove
                  .mutateAsync()
                  .then(() => {
                    toast.success(s.deleted(data.name));
                    router.push('/contacts');
                  })
                  .catch((error: unknown) => toast.error(errorMessage(error)))
              }
            >
              {s.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
