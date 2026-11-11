'use client';

import { type Member, type Role, assignableRoles, canManageRole } from '@revops/shared';
import { useState } from 'react';
import { toast } from 'sonner';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { errorMessage } from '@/lib/api/messages';
import { formatDate } from '@/lib/format';
import { useSession } from '@/lib/session';
import { common } from '@/lib/strings/common';
import { shellStrings } from '@/lib/strings/shell';
import { teamStrings as s } from '@/lib/strings/team';
import { useMembers, useUpdateMember } from './queries';

export function MembersTable() {
  const { session, can } = useSession();
  const members = useMembers();
  const update = useUpdateMember();
  const [confirmDisable, setConfirmDisable] = useState<Member | null>(null);
  const actor = session.tenant?.role;
  const canManage = can('member.manage');

  const run = async (member: Member, body: { role?: Role; status?: Member['status'] }) => {
    try {
      await update.mutateAsync({ userId: member.userId, ...body });
      if (body.role)
        toast.success(s.members.roleChanged(member.name, shellStrings.roles[body.role]));
      else if (body.status === 'disabled') toast.success(s.members.disabled_(member.name));
      else toast.success(s.members.enabled(member.name));
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  if (members.isPending) return <LoadingState rows={4} />;
  if (members.isError)
    return <ErrorState error={members.error} onRetry={() => void members.refetch()} />;
  const rows = members.data.pages.flatMap((page) => page.items);
  if (rows.length === 0) return <EmptyState title={s.members.empty} />;

  return (
    <div className="grid gap-3">
      <div className="overflow-x-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{s.members.name}</TableHead>
              <TableHead>{s.members.email}</TableHead>
              <TableHead>{s.members.role}</TableHead>
              <TableHead>{s.members.status}</TableHead>
              <TableHead>{s.members.joined}</TableHead>
              {canManage ? <TableHead className="text-right">{s.members.actions}</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((member) => {
              const self = member.userId === session.user.id;
              const manageable = !!actor && canManage && !self && canManageRole(actor, member.role);
              return (
                <TableRow key={member.userId} data-testid={`member-${member.email}`}>
                  <TableCell className="font-medium">
                    {member.name}
                    {self ? (
                      <Badge variant="outline" className="ml-2">
                        {s.members.you}
                      </Badge>
                    ) : null}
                  </TableCell>
                  <TableCell>{member.email}</TableCell>
                  <TableCell>
                    {manageable && actor ? (
                      <Select
                        value={member.role}
                        disabled={update.isPending}
                        onValueChange={(role) => void run(member, { role: role as Role })}
                      >
                        <SelectTrigger
                          size="sm"
                          className="w-32"
                          aria-label={`${s.members.role}: ${member.name}`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {assignableRoles(actor).map((role) => (
                            <SelectItem key={role} value={role}>
                              {shellStrings.roles[role]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      shellStrings.roles[member.role]
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={member.status === 'active' ? 'secondary' : 'destructive'}>
                      {member.status === 'active' ? s.members.active : s.members.disabled}
                    </Badge>
                  </TableCell>
                  <TableCell>{formatDate(member.joinedAt)}</TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
                      {manageable ? (
                        member.status === 'active' ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={update.isPending}
                            onClick={() => setConfirmDisable(member)}
                          >
                            {s.members.disable}
                          </Button>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={update.isPending}
                            onClick={() => void run(member, { status: 'active' })}
                          >
                            {s.members.enable}
                          </Button>
                        )
                      ) : null}
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {members.hasNextPage ? (
        <Button
          variant="outline"
          className="justify-self-center"
          disabled={members.isFetchingNextPage}
          onClick={() => void members.fetchNextPage()}
        >
          {members.isFetchingNextPage ? common.loading : s.members.loadMore}
        </Button>
      ) : null}

      <Dialog
        open={confirmDisable !== null}
        onOpenChange={(open) => !open && setConfirmDisable(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{s.members.disableConfirmTitle(confirmDisable?.name ?? '')}</DialogTitle>
            <DialogDescription>{s.members.disableConfirmBody}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{common.cancel}</Button>
            </DialogClose>
            <Button
              variant="destructive"
              disabled={update.isPending}
              onClick={() => {
                const target = confirmDisable;
                setConfirmDisable(null);
                if (target) void run(target, { status: 'disabled' });
              }}
            >
              {s.members.disable}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
