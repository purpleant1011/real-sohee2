import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { ConversationWorkContext } from './conversation-work-context'
it('shows the selected version and exact direct return without exposing internal fingerprint', () => {
  render(<ConversationWorkContext work={{ workspaceId: 'workspace', contentId: 'content', versionId: 'version', versionNumber: 3,
    fingerprint: 'a'.repeat(64), title: '선택한 안내 원고', channel: 'threads', summary: '저장된 문장', readOnly: true, returnHref: '/app/work/content' }} />)
  expect(screen.getByRole('region', { name: '선택한 원고 맥락' })).toHaveTextContent('v3 · 읽기 전용 검토')
  expect(screen.getByRole('link', { name: '원래 원고 화면에서 직접 수정' })).toHaveAttribute('href', '/app/work/content')
  expect(screen.queryByText('a'.repeat(64))).not.toBeInTheDocument()
})
