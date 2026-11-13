'use client'

import { R2Customers } from '@/features/mobile-customers/r2-customers'
import { R2Results } from '@/features/mobile-results/r2-results'
import { R2More } from '@/features/mobile-settings/r2-more'

const workspaceId = '00000000-0000-4000-8000-000000000001'

/** 실제 R2 컴포넌트를 연결한다. API 응답은 E2E에서 차단하고 테스트 응답으로 종결한다. */
export function TabReadWiringHarness({ tab }: { tab: 'customers' | 'results' | 'more' }) {
  if (tab === 'customers') return <R2Customers workspaceId={workspaceId} />
  if (tab === 'results') return <R2Results workspaceId={workspaceId} />
  return <R2More workspaceId={workspaceId} />
}
