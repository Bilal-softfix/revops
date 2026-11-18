'use client';

import {
  type AssignmentConfig,
  LEAD_SOURCE_TYPES,
  type LeadSource,
  type LeadSourceType,
} from '@revops/shared';
import { useState } from 'react';
import { toast } from 'sonner';
import { SimpleSelect } from '@/components/form/simple-select';
import { FormError, TextField } from '@/components/form/text-field';
import { EmptyState, ErrorState, LoadingState } from '@/components/states/states';
import { Badge } from '@/components/ui/badge';
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
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useMembers } from '@/features/team/queries';
import { errorMessage } from '@/lib/api/messages';
import { common } from '@/lib/strings/common';
import { leadSourceStrings as s } from '@/lib/strings/lead-sources';
import { FormSettingsDialog } from './form-settings-dialog';
import {
  useCreateLeadSource,
  useDeleteLeadSource,
  useLeadSources,
  useRotateKey,
  useRotateSecret,
  useUpdateLeadSource,
} from './queries';

type Confirm = { kind: 'rotateKey' | 'rotateSecret' | 'delete'; source: LeadSource };

const ROUND_ROBIN = 'round_robin';
const UNASSIGNED = 'unassigned';

/** Who gets new leads from this source (M2-T6): round-robin, a fixed active member, or nobody. */
function AssignmentPicker({ source }: { source: LeadSource }) {
  const update = useUpdateLeadSource();
  const members = (useMembers().data?.pages.flatMap((p) => p.items) ?? []).filter(
    (m) => m.status === 'active',
  );
  const { assignment } = source.config;
  const value = assignment.strategy === 'user' ? assignment.userId : assignment.strategy;
  const toAssignment = (v: string): AssignmentConfig =>
    v === ROUND_ROBIN || v === UNASSIGNED ? { strategy: v } : { strategy: 'user', userId: v };
  return (
    <SimpleSelect
      label={s.assignment.label}
      value={value}
      disabled={update.isPending}
      className="max-w-sm"
      options={[
        { value: ROUND_ROBIN, label: s.assignment.roundRobin },
        { value: UNASSIGNED, label: s.assignment.unassigned },
        ...members.map((m) => ({ value: m.userId, label: m.name })),
      ]}
      onChange={(v) =>
        void update
          .mutateAsync({
            id: source.id,
            config: { ...source.config, assignment: toAssignment(v) },
          })
          .then(() => toast.success(s.saved))
          .catch((error: unknown) => toast.error(errorMessage(error)))
      }
    />
  );
}

/** Settings → Lead sources (M2-T1, owners/admins; assignment M2-T6; capture config M2-T2). */
export function LeadSourcesView() {
  const sources = useLeadSources();
  const update = useUpdateLeadSource();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<LeadSource | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [formSettings, setFormSettings] = useState<LeadSource | null>(null);

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{s.title}</h1>
          <p className="text-sm text-muted-foreground">{s.description}</p>
        </div>
        <Button onClick={() => setCreating(true)}>{s.newSource}</Button>
      </div>

      {sources.isPending ? (
        <LoadingState rows={4} />
      ) : sources.isError ? (
        <ErrorState error={sources.error} onRetry={() => void sources.refetch()} />
      ) : sources.data.items.length === 0 ? (
        <EmptyState title={s.empty} />
      ) : (
        <ul className="grid gap-3" aria-label={s.title}>
          {sources.data.items.map((source) => (
            <li key={source.id} className="grid gap-2 rounded-md border p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{source.name}</span>
                <Badge variant="outline">{s.types[source.type]}</Badge>
                <Badge variant={source.isActive ? 'secondary' : 'outline'}>
                  {source.isActive ? s.active : s.inactive}
                </Badge>
              </div>
              {source.type === 'web_form' || source.type === 'api' ? (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-muted-foreground">{s.columns.publicKey}:</span>
                  <code className="rounded bg-muted px-1.5 py-0.5 text-xs break-all">
                    {source.publicKey}
                  </code>
                  <CopyButton value={source.publicKey} />
                </div>
              ) : null}
              <AssignmentPicker source={source} />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={update.isPending}
                  onClick={() =>
                    void update
                      .mutateAsync({ id: source.id, isActive: !source.isActive })
                      .then(() => toast.success(s.saved))
                      .catch((error: unknown) => toast.error(errorMessage(error)))
                  }
                >
                  {source.isActive ? s.deactivate : s.activate}
                </Button>
                {source.type === 'web_form' ? (
                  <Button size="sm" variant="outline" onClick={() => setFormSettings(source)}>
                    {s.form.open}
                  </Button>
                ) : null}
                <Button size="sm" variant="outline" onClick={() => setRenaming(source)}>
                  {s.rename}
                </Button>
                {source.type === 'web_form' || source.type === 'api' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirm({ kind: 'rotateKey', source })}
                  >
                    {s.rotateKey}
                  </Button>
                ) : null}
                {source.type === 'api' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setConfirm({ kind: 'rotateSecret', source })}
                  >
                    {s.rotateSecret}
                  </Button>
                ) : null}
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirm({ kind: 'delete', source })}
                >
                  {s.delete}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <CreateDialog open={creating} onOpenChange={setCreating} onSecret={setSecret} />
      <RenameDialog source={renaming} onClose={() => setRenaming(null)} />
      <ConfirmDialog confirm={confirm} onClose={() => setConfirm(null)} onSecret={setSecret} />
      <SecretDialog secret={secret} onClose={() => setSecret(null)} />
      <FormSettingsDialog source={formSettings} onClose={() => setFormSettings(null)} />
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={() =>
        void navigator.clipboard
          .writeText(value)
          .then(() => toast.success(s.copied))
          .catch(() => undefined)
      }
    >
      {s.copy}
    </Button>
  );
}

function CreateDialog({
  open,
  onOpenChange,
  onSecret,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSecret: (secret: string) => void;
}) {
  const create = useCreateLeadSource();
  const [name, setName] = useState('');
  const [type, setType] = useState<LeadSourceType>('web_form');
  const [error, setError] = useState<string | null>(null);
  const close = () => {
    setName('');
    setType('web_form');
    setError(null);
    onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <form
          noValidate
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            create
              .mutateAsync({ name: name.trim(), type })
              .then(({ source, webhookSecret }) => {
                toast.success(s.created(source.name));
                close();
                if (webhookSecret) onSecret(webhookSecret);
              })
              .catch((e: unknown) => setError(errorMessage(e)));
          }}
        >
          <DialogHeader>
            <DialogTitle>{s.newSourceTitle}</DialogTitle>
          </DialogHeader>
          <FormError message={error} />
          <TextField
            label={s.fields.name}
            value={name}
            maxLength={80}
            required
            onChange={(event) => setName(event.target.value)}
          />
          <div className="grid gap-1.5">
            <Label htmlFor="source-type">{s.fields.type}</Label>
            <Select value={type} onValueChange={(v) => setType(v as LeadSourceType)}>
              <SelectTrigger id="source-type" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LEAD_SOURCE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {s.types[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                {common.cancel}
              </Button>
            </DialogClose>
            <Button type="submit" disabled={create.isPending || name.trim() === ''}>
              {s.newSource}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RenameDialog({ source, onClose }: { source: LeadSource | null; onClose: () => void }) {
  const update = useUpdateLeadSource();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      open={source !== null}
      onOpenChange={(open) => {
        if (open) return;
        setError(null);
        onClose();
      }}
    >
      <DialogContent>
        {source ? (
          <form
            key={source.id}
            noValidate
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              setError(null);
              update
                .mutateAsync({ id: source.id, name: (name || source.name).trim() })
                .then(() => {
                  toast.success(s.saved);
                  setName('');
                  onClose();
                })
                .catch((e: unknown) => setError(errorMessage(e)));
            }}
          >
            <DialogHeader>
              <DialogTitle>{s.renameTitle(source.name)}</DialogTitle>
            </DialogHeader>
            <FormError message={error} />
            <TextField
              label={s.fields.name}
              defaultValue={source.name}
              maxLength={80}
              onChange={(event) => setName(event.target.value)}
            />
            <DialogFooter>
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {common.cancel}
                </Button>
              </DialogClose>
              <Button type="submit" disabled={update.isPending}>
                {common.save}
              </Button>
            </DialogFooter>
          </form>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ConfirmDialog({
  confirm,
  onClose,
  onSecret,
}: {
  confirm: Confirm | null;
  onClose: () => void;
  onSecret: (secret: string) => void;
}) {
  const rotateKey = useRotateKey();
  const rotateSecret = useRotateSecret();
  const remove = useDeleteLeadSource();
  const pending = rotateKey.isPending || rotateSecret.isPending || remove.isPending;
  if (!confirm) return null;
  const { kind, source } = confirm;
  const title =
    kind === 'delete'
      ? s.deleteConfirmTitle(source.name)
      : kind === 'rotateKey'
        ? s.rotateKey
        : s.rotateSecret;
  const body =
    kind === 'delete'
      ? s.deleteConfirmBody
      : kind === 'rotateKey'
        ? s.rotateKeyConfirm
        : s.rotateSecretConfirm;
  const run = (): Promise<void> => {
    if (kind === 'delete') {
      return remove.mutateAsync(source.id).then(() => {
        toast.success(s.deleted(source.name));
      });
    }
    if (kind === 'rotateKey') {
      return rotateKey.mutateAsync(source.id).then(() => {
        toast.success(s.keyRotated);
      });
    }
    return rotateSecret.mutateAsync(source.id).then(({ webhookSecret }) => {
      if (webhookSecret) onSecret(webhookSecret);
    });
  };
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{body}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">{common.cancel}</Button>
          </DialogClose>
          <Button
            variant={kind === 'delete' ? 'destructive' : 'default'}
            disabled={pending}
            onClick={() =>
              void run()
                .then(onClose)
                .catch((error: unknown) => toast.error(errorMessage(error)))
            }
          >
            {kind === 'delete' ? s.delete : s.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SecretDialog({ secret, onClose }: { secret: string | null; onClose: () => void }) {
  return (
    <Dialog open={secret !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{s.secretTitle}</DialogTitle>
          <DialogDescription>{s.secretBody}</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2">
          <code
            data-testid="webhook-secret"
            className="flex-1 rounded bg-muted px-2 py-1 text-xs break-all"
          >
            {secret}
          </code>
          {secret ? <CopyButton value={secret} /> : null}
        </div>
        <DialogFooter>
          <Button onClick={onClose}>{s.secretDone}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
