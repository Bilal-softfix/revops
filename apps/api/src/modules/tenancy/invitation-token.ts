import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';

const tenantIdSchema = z.uuid();

/**
 * `<tenant_id>.<32 random bytes, base64url>`. The tenant part is not secret: it only tells accept
 * which tenant context to look the (hashed) token up in, since invitations are FORCE RLS.
 */
export function newInvitationToken(tenantId: string): string {
  return `${tenantId}.${randomBytes(32).toString('base64url')}`;
}

export function hashInvitationToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The tenant id embedded in a (shape-validated) token, or null if it isn't a real UUID. */
export function tenantOfInvitationToken(token: string): string | null {
  const parsed = tenantIdSchema.safeParse(token.slice(0, token.indexOf('.')));
  return parsed.success ? parsed.data : null;
}
