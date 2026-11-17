'use client';

import { type Contact, type MergePick, formatPhone } from '@revops/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { FormError } from '@/components/form/text-field';
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
import { Input } from '@/components/ui/input';
import { errorMessage } from '@/lib/api/messages';
import { common } from '@/lib/strings/common';
import { contactStrings } from '@/lib/strings/contacts';
import { useContacts, useMergeContact } from './queries';

const s = contactStrings.merge;
const FIELDS = ['name', 'phone', 'email', 'city'] as const;
type Field = (typeof FIELDS)[number];

const valueOf = (contact: Contact, field: Field): string | null =>
  field === 'phone' ? (contact.phoneE164 ? formatPhone(contact.phoneE164) : null) : contact[field];

/**
 * Merge another contact into this one (M2-T4): pick the duplicate, then, for each field where the
 * two differ, whose value to keep. Leads, notes, tasks and history move to this contact.
 */
export function MergeContactDialog({
  contact,
  open,
  onOpenChange,
}: {
  contact: Contact;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [q, setQ] = useState('');
  const [other, setOther] = useState<Contact | null>(null);
  const [pick, setPick] = useState<Partial<Record<Field, MergePick>>>({});
  const [error, setError] = useState<string | null>(null);
  const search = useContacts(q.trim());
  const merge = useMergeContact(contact.id);
  const candidates = (search.data?.pages.flatMap((p) => p.items) ?? [])
    .filter((c) => c.id !== contact.id)
    .slice(0, 8);
  const differing = other
    ? FIELDS.filter((f) => valueOf(contact, f) !== valueOf(other, f) && valueOf(other, f) !== null)
    : [];

  const close = () => {
    setQ('');
    setOther(null);
    setPick({});
    setError(null);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{s.title(contact.name)}</DialogTitle>
          <DialogDescription>{s.description}</DialogDescription>
        </DialogHeader>
        <FormError message={error} />
        {other === null ? (
          <div className="grid gap-2">
            <Input
              aria-label={s.searchLabel}
              placeholder={s.searchPlaceholder}
              value={q}
              onChange={(event) => setQ(event.target.value)}
            />
            <ul className="grid gap-1" aria-label={s.candidates}>
              {candidates.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => setOther(c)}
                  >
                    <span className="font-medium">{c.name}</span>{' '}
                    <span className="text-muted-foreground">
                      {[c.phoneE164 ? formatPhone(c.phoneE164) : null, c.email]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </button>
                </li>
              ))}
              {q.trim() && !search.isPending && candidates.length === 0 ? (
                <li className="text-sm text-muted-foreground">{s.noMatches}</li>
              ) : null}
            </ul>
          </div>
        ) : (
          <div className="grid gap-3">
            <p className="text-sm">{s.mergingFrom(other.name)}</p>
            {differing.length === 0 ? (
              <p className="text-sm text-muted-foreground">{s.nothingToPick}</p>
            ) : (
              differing.map((field) => (
                <fieldset key={field} className="grid gap-1 rounded-md border p-3 text-sm">
                  <legend className="px-1 font-medium">{s.fields[field]}</legend>
                  {(['this', 'other'] as const).map((side) => {
                    const value = valueOf(side === 'this' ? contact : other, field);
                    const checked =
                      (pick[field] ?? (valueOf(contact, field) ? 'this' : 'other')) === side;
                    return (
                      <label key={side} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={`merge-${field}`}
                          className="size-4 accent-primary"
                          checked={checked}
                          onChange={() => setPick((p) => ({ ...p, [field]: side }))}
                        />
                        <span>{value ?? s.empty}</span>
                      </label>
                    );
                  })}
                </fieldset>
              ))
            )}
            <p className="text-xs text-muted-foreground">{s.consequence}</p>
          </div>
        )}
        <DialogFooter>
          {other ? (
            <Button type="button" variant="ghost" onClick={() => setOther(null)}>
              {s.back}
            </Button>
          ) : null}
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {common.cancel}
            </Button>
          </DialogClose>
          <Button
            type="button"
            disabled={!other || merge.isPending}
            onClick={() => {
              if (!other) return;
              setError(null);
              merge
                .mutateAsync({ otherContactId: other.id, pick, customFields: {} })
                .then(() => {
                  toast.success(s.done(other.name));
                  close();
                })
                .catch((e: unknown) => setError(errorMessage(e)));
            }}
          >
            {s.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
