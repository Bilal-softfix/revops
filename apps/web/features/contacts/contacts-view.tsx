'use client';

import { formatPhone } from '@revops/shared';
import { Plus, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { EmptyState, ErrorState, LoadingState } from '@/components/states/states';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { common } from '@/lib/strings/common';
import { contactStrings as s } from '@/lib/strings/contacts';
import { ContactForm } from './contact-form';
import { useContacts, useCreateContact } from './queries';

/** Debounced search value: the list refetches 300 ms after typing stops. */
function useDebounced(value: string, ms = 300): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

function NewContactDialog() {
  const [open, setOpen] = useState(false);
  const create = useCreateContact();
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus aria-hidden />
          {s.new}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{s.createTitle}</DialogTitle>
          <DialogDescription>{s.description}</DialogDescription>
        </DialogHeader>
        <ContactForm
          submitLabel={s.save}
          onSubmit={async (values) => {
            const contact = await create.mutateAsync(values);
            toast.success(s.created(contact.name));
            setOpen(false);
            router.push(`/contacts/${contact.id}`);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

export function ContactsView() {
  const { can } = useSession();
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const contacts = useContacts(q);
  const rows = contacts.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{s.title}</h1>
          <p className="text-sm text-muted-foreground">{s.description}</p>
        </div>
        {can('contact.write') ? <NewContactDialog /> : null}
      </div>
      <div className="relative max-w-sm">
        <Search
          className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          aria-label={s.searchLabel}
          placeholder={s.searchPlaceholder}
          className="pl-8"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>

      {contacts.isPending ? (
        <LoadingState rows={5} />
      ) : contacts.isError ? (
        <ErrorState error={contacts.error} onRetry={() => void contacts.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState title={q ? s.emptySearch : s.empty} body={q ? undefined : s.emptyBody} />
      ) : (
        <div className="grid gap-3">
          <div className="overflow-x-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{s.columns.name}</TableHead>
                  <TableHead>{s.columns.phone}</TableHead>
                  <TableHead>{s.columns.email}</TableHead>
                  <TableHead>{s.columns.city}</TableHead>
                  <TableHead>{s.columns.added}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((contact) => (
                  <TableRow key={contact.id} data-testid={`contact-${contact.id}`}>
                    <TableCell className="font-medium">
                      <Link className="hover:underline" href={`/contacts/${contact.id}`}>
                        {contact.name}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {formatPhone(contact.phoneE164)}
                    </TableCell>
                    <TableCell>{contact.email}</TableCell>
                    <TableCell>{contact.city}</TableCell>
                    <TableCell>{formatDate(contact.createdAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {contacts.hasNextPage ? (
            <Button
              variant="outline"
              className="justify-self-center"
              disabled={contacts.isFetchingNextPage}
              onClick={() => void contacts.fetchNextPage()}
            >
              {contacts.isFetchingNextPage ? common.loading : s.loadMore}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}
