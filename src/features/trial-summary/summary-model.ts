import { MINUTES_SAVED_BASIS, MINUTES_SAVED_PER_POST, type TrialEndPolicy } from './config'
import { CANONICAL_NUMBERS, hasCanonicalNumbers, type CanonicalNumbers } from './canonical-numbers'
import { daysLeft } from './trial-end'

/** 조회 결과: 실패(error)와 비어 있음(값 0/없음)을 구분한다. */
export type Loaded<T> = { status: 'ok'; value: T } | { status: 'error' }

export interface PublishedLink { url: string; channelLabel: string }
export interface VaultCounts { stored: number; needsReapproval: number; externalActions: number }

export interface TrialSummaryInput {
  now: Date
  endsAt: string | null
  posts: Loaded<number>
  vault: Loaded<VaultCounts>
  links: Loaded<PublishedLink[]>
  policy: TrialEndPolicy
  numbers?: CanonicalNumbers
}

export type Section<T> = { state: 'error' } | { state: 'empty' } | { state: 'ready'; data: T }

export interface TrialSummaryModel {
  daysLeft: number | null
  posts: Section<{ count: number }>
  vault: Section<VaultCounts>
  links: Section<PublishedLink[]>
  savedTime: Section<{ minutes: number; perPost: number; posts: number; basis: string }>
  policy: { decided: boolean; text: string }
  numbers: CanonicalNumbers | null
}

function policyText(p: TrialEndPolicy): { decided: boolean; text: string } {
  switch (p.kind) {
    case 'KEEP_ALL': return { decided: true, text: '체험이 끝나도 보관한 글은 그대로 남아 있어요.' }
    case 'KEEP_N_DAYS':
      return p.keepDays && p.keepDays > 0
        ? { decided: true, text: `체험이 끝나도 보관한 글은 ${p.keepDays}일 동안 남아 있어요.` }
        : { decided: false, text: '곧 안내드릴게요' }
    case 'EXPORT_THEN_DELETE':
      return { decided: true, text: '체험이 끝나기 전에 보관한 글을 내려받아 주세요. 이후에는 정리돼요.' }
    default: return { decided: false, text: '곧 안내드릴게요' }
  }
}

export function buildTrialSummary(input: TrialSummaryInput): TrialSummaryModel {
  const posts: TrialSummaryModel['posts'] = input.posts.status === 'error' ? { state: 'error' }
    : input.posts.value > 0 ? { state: 'ready', data: { count: input.posts.value } } : { state: 'empty' }

  const vault: TrialSummaryModel['vault'] = input.vault.status === 'error' ? { state: 'error' }
    : input.vault.value.stored + input.vault.value.needsReapproval > 0
      ? { state: 'ready', data: input.vault.value } : { state: 'empty' }

  const links: TrialSummaryModel['links'] = input.links.status === 'error' ? { state: 'error' }
    : input.links.value.length > 0 ? { state: 'ready', data: input.links.value } : { state: 'empty' }

  const savedTime: TrialSummaryModel['savedTime'] = posts.state === 'error' ? { state: 'error' }
    : posts.state === 'empty' ? { state: 'empty' }
      : { state: 'ready', data: { minutes: posts.data.count * MINUTES_SAVED_PER_POST, perPost: MINUTES_SAVED_PER_POST, posts: posts.data.count, basis: MINUTES_SAVED_BASIS } }

  const policy = policyText(input.policy)
  const numbers = input.numbers ?? CANONICAL_NUMBERS
  return {
    daysLeft: daysLeft(input.endsAt, input.now),
    posts, vault, links, savedTime, policy,
    // 정책 미확정이거나 정본 숫자가 비어 있으면 숫자 섹션을 만들지 않는다.
    numbers: policy.decided && hasCanonicalNumbers(numbers) ? numbers : null,
  }
}
