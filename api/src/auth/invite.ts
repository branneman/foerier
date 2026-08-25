import type { Clock } from '@foerier/shared'

import type { InvitePurpose } from '../db/schema.ts'

/**
 * The Invite state machine (`auth-design.md` §3.1).
 *
 * Pure, and deliberately separate from the database: whether a link still
 * works is a rule, not a query, and it is the rule that carries the security
 * weight of enrolment.
 */

export const INVITE_LIFETIME_MS: Record<InvitePurpose, number> = {
  /** Handed over at leisure, over whatever the household already uses. */
  join: 7 * 24 * 60 * 60 * 1000,
  /** Used while both people are standing there. */
  device: 60 * 60 * 1000,
}

export type InviteState = 'fresh' | 'used' | 'expired' | 'revoked'

/** The fields the state machine reads. Anything else about the row is irrelevant. */
export interface InviteRecord {
  purpose: InvitePurpose
  expires_at: Date
  used_at: Date | null
  revoked_at: Date | null
}

/**
 * Order matters only for the log line. To the client, every non-`fresh` state
 * returns one indistinguishable response — there is nothing to enumerate and
 * no reason to tell an attacker which of the four they hit
 * (`auth-design.md` §9.4).
 */
export function inviteState(invite: InviteRecord, clock: Clock): InviteState {
  if (invite.revoked_at !== null) return 'revoked'
  if (invite.used_at !== null) return 'used'
  if (invite.expires_at.getTime() <= clock.now()) return 'expired'
  return 'fresh'
}

export function isRedeemable(invite: InviteRecord, clock: Clock): boolean {
  return inviteState(invite, clock) === 'fresh'
}

export function inviteExpiry(purpose: InvitePurpose, clock: Clock): Date {
  return new Date(clock.now() + INVITE_LIFETIME_MS[purpose])
}
