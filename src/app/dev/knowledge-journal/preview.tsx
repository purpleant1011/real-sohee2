'use client'

import { WorkspaceProvider } from '@/components/workspace/workspace-provider'
import { ThemeProvider, useTheme } from '@/components/theme-provider'
import { Button } from '@/components/ui/button'
import { KnowledgeJournalPanel } from '@/features/sohee-studio/components/knowledge-journal-panel'
import { journalSourceTypes, journalSourceKinds, KNOWLEDGE_JOURNAL_NOTICE, type KnowledgeJournal } from '@/features/sohee-studio/knowledge-journal'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const journal: KnowledgeJournal = {
  workspaceId, observedAt: '2026-10-30T00:00:00Z', partial: true, notice: KNOWLEDGE_JOURNAL_NOTICE,
  sources: journalSourceTypes.map(sourceType => ({ sourceType, kind: journalSourceKinds[sourceType],
    state: sourceType === 'agent_memory' ? 'unavailable' : 'ready', returnedCount: sourceType === 'agent_memory' ? null : 1 })),
  entries: journalSourceTypes.filter(sourceType => sourceType !== 'agent_memory').map((sourceType, index) => ({
    id: `${sourceType}:22222222-2222-4222-8222-22222222222${index}`, sourceId: `22222222-2222-4222-8222-22222222222${index}`,
    sourceType, kind: journalSourceKinds[sourceType], title: sourceType === 'message' ? '대화 지시·요청' : '검증용 원본 기록',
    summary: sourceType === 'message' ? '매주 월요일 오전에 지난주 성과를 보고해줘. 합성 기록이며 실제 자동화 설정이 아닙니다.' : '현재 설정과 검토 후보를 구분하는 합성 예시입니다. 외부 실행이나 승인 결과가 아닙니다.',
    statusLabel: sourceType === 'message' ? '원문 기록됨' : '검토 상태 예시', occurredAt: '2026-10-30T00:00:00Z', href: '/app/sohee?tab=studio',
  })),
}
function Preview() {
  const { resolvedTheme, setTheme } = useTheme()
  return <div className="flex min-w-0 flex-col gap-4">
    <Button variant="outline" className="min-h-11 self-end" onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}>테마 전환</Button>
    <KnowledgeJournalPanel workspaceId={workspaceId} initialJournal={journal} />
  </div>
}
export function KnowledgeJournalPreview() {
  return <ThemeProvider storageKey="sohee-journal-preview-theme"><WorkspaceProvider value={{ workspaceId, workspaceName: '검증용 가게', workspaceKind: null, membershipRole: 'owner', actorId: '99999999-9999-4999-8999-999999999999', resolutionSource: 'membership' }}><Preview /></WorkspaceProvider></ThemeProvider>
}
