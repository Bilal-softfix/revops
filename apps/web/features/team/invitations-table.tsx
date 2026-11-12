'use client';

import { canManageRole } from '@revops/shared';
import { toast } from 'sonner';
import { EmptyState, ErrorState, LoadingState } from '@/components/states/states';
import { Button } from '@/components/ui/button';
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
import { shellStrings } from '@/lib/strings/shell';
import { teamStrings as s } from '@/lib/strings/team';
import { useInvitations, useResendInvitation, useRevokeInvitation } from './queries';

/** Pending invitations (owners/admins only). */
export function InvitationsTable() {
  const { session } = useSession();
  const invitations = useInvitations(true);
  const resend = useResendInvitation();
  const revoke = useRevokeInvitation();
  const actor = session.tenant?.role;

  if (invitations.isPending) return <LoadingState rows={2} />;
  if (invitations.isError) {
    return <ErrorState error={invitations.error} onRetry={() => void invitations.refetch()} />;
  }
  if (invitations.data.items.length === 0) return <EmptyState title={s.invitations.empty} />;

  const act = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.success(done);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{s.invite.email}</TableHead>
            <TableHead>{s.invite.role}</TableHead>
            <TableHead>{s.invitations.expires}</TableHead>
            <TableHead className="text-right">{s.members.actions}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {invitations.data.items.map((inv) => {
            const manageable = !!actor && canManageRole(actor, inv.role);
            return (
              <TableRow key={inv.id} data-testid={`invitation-${inv.email}`}>
                <TableCell>{inv.email}</TableCell>
                <TableCell>{shellStrings.roles[inv.role]}</TableCell>
                <TableCell>{formatDate(inv.expiresAt)}</TableCell>
                <TableCell className="space-x-2 text-right">
                  {manageable ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={resend.isPending}
                        onClick={() =>
                          void act(
                            () => resend.mutateAsync(inv.id),
                            s.invitations.resent(inv.email),
                          )
                        }
                      >
                        {s.invitations.resend}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={revoke.isPending}
                        onClick={() =>
                          void act(
                            () => revoke.mutateAsync(inv.id),
                            s.invitations.revoked(inv.email),
                          )
                        }
                      >
                        {s.invitations.revoke}
                      </Button>
                    </>
                  ) : null}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
