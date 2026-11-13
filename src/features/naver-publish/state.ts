import type { NaverPublishState } from './types'

const TRANSITIONS: Readonly<Record<NaverPublishState, readonly NaverPublishState[]>> = {
  QUEUED: ['AWAITING_LOGIN', 'RUNNING', 'FAILED'],
  AWAITING_LOGIN: ['RUNNING', 'FAILED'],
  RUNNING: ['HANDOFF_REQUIRED', 'PUBLISHED_REPORTED', 'UNKNOWN', 'FAILED'],
  HANDOFF_REQUIRED: ['RUNNING', 'FAILED'],
  // Only a readback may turn a reported publish into a verified one.
  PUBLISHED_REPORTED: ['VERIFIED', 'MISMATCH', 'UNKNOWN'],
  // UNKNOWN is resolved by the reconcile queue, never by a blind retry.
  UNKNOWN: ['VERIFIED', 'MISMATCH'],
  VERIFIED: [],
  MISMATCH: [],
  FAILED: [],
}

export function canTransition(from: NaverPublishState, to: NaverPublishState): boolean {
  return TRANSITIONS[from].includes(to)
}

export function isTerminal(state: NaverPublishState): boolean {
  return TRANSITIONS[state].length === 0
}
