import type { MobileHomeDto } from '../mobile-decision/contracts'
import { confirmedEmpty, selectDecisions } from '../mobile-decision/selectors'

export type FirstAction =
  | { kind: 'review'; itemId: string; title: string; targetLabel: string; href: string; stale: boolean }
  | { kind: 'delegate' }
  | { kind: 'retry' }
  | { kind: 'checking' }
  | { kind: 'partial'; href: string }

/** 오늘 홈 폴드 안의 주 CTA 1개. 조회 오류·미확인은 "할 일 없음"으로 바꾸지 않는다. */
export function pickFirstAction(view: Pick<MobileHomeDto, 'decisions'>): FirstAction {
  const { decisions } = view
  if (decisions.state === 'error') return { kind: 'retry' }
  const [first] = selectDecisions(decisions.data?.items ?? [])
  if ((decisions.state === 'ready' || decisions.state === 'stale') && first) {
    return { kind: 'review', itemId: first.id, title: first.title, targetLabel: first.targetLabel,
      href: `/app/approvals?item=${encodeURIComponent(first.id)}`, stale: decisions.state === 'stale' }
  }
  if (confirmedEmpty(decisions)) return { kind: 'delegate' }
  // 조회가 끝났는데 일부를 읽지 못한 경우: 계속 '확인 중'이라 하지 않고 사장님이 직접 볼 곳을 알려 준다.
  if (decisions.state === 'ready' && decisions.data?.complete === false) return { kind: 'partial', href: '/app/engagement' }
  return { kind: 'checking' }
}
