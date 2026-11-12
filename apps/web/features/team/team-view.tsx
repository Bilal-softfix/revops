'use client';

import { useSession } from '@/lib/session';
import { teamStrings as s } from '@/lib/strings/team';
import { InvitationsTable } from './invitations-table';
import { InviteDialog } from './invite-dialog';
import { MembersTable } from './members-table';

/**
 * Settings → Team. Everyone with member.read sees the members; invite + pending invitations need
 * member.invite; role/status controls need member.manage (and only for roles the actor may grant).
 */
export function TeamView() {
  const { session, can } = useSession();
  const role = session.tenant?.role;
  const canInvite = can('member.invite');
  return (
    <div className="mx-auto grid max-w-5xl gap-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{s.title}</h1>
          <p className="text-sm text-muted-foreground">{s.description}</p>
        </div>
        {canInvite && role ? <InviteDialog actorRole={role} /> : null}
      </div>
      {!canInvite ? <p className="text-sm text-muted-foreground">{s.readOnly}</p> : null}
      <section aria-labelledby="members-heading" className="grid gap-3">
        <h2 id="members-heading" className="text-lg font-medium">
          {s.members.heading}
        </h2>
        <MembersTable />
      </section>
      {canInvite ? (
        <section aria-labelledby="invitations-heading" className="grid gap-3">
          <h2 id="invitations-heading" className="text-lg font-medium">
            {s.invitations.heading}
          </h2>
          <InvitationsTable />
        </section>
      ) : null}
    </div>
  );
}
