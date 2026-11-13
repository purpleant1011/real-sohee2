import React from 'react'
import { createRoot } from 'react-dom/client'
import { ChannelConnections } from '../../../src/features/channels/ui/channel-connections'
import { MobileChannelsView } from '../../../src/features/mobile-channels/channels-view'
import { mapChannelsApi } from '../../../src/features/mobile-channels/channels-api-mapper'
import { parseConnectFlow } from '../../../src/features/mobile-channels/channels-connect'
import '../../../src/app/globals.css'

// Browser-only fixture: production components, synthetic read responses, no external OAuth or writes.
const query = new URLSearchParams(window.location.search)
const status = query.get('state') === 'expired' ? 'READY_DEGRADED' : 'VERIFIED'
const fixture = {
  extendedScopesAllowed: query.get('extended') === '1',
  instagram: { status, verified: status === 'VERIFIED', supportedPublish: true, username: 'fixture_instagram', lastCheckedAt: '2026-11-11T00:00:00Z' },
  threads: { status, verified: status === 'VERIFIED', supportedPublish: true, username: 'fixture_threads', lastCheckedAt: '2026-11-11T00:00:00Z' },
}
window.fetch = async (input) => {
  const url = String(input)
  const body = url === '/api/channels' ? fixture : url === '/api/channels/credentials' ? { connections: [
    { channel: 'instagram', status: 'connected', account_label: 'fixture_instagram', external_account_id: 'fixture-ig' },
    { channel: 'threads', status: 'connected', account_label: 'fixture_threads', external_account_id: 'fixture-th' },
  ] } : { items: [] }
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
}
document.addEventListener('click', (event) => {
  const anchor = (event.target as Element).closest('a')
  if (anchor?.getAttribute('href')?.startsWith('/api/channels/')) {
    event.preventDefault()
    const result = document.getElementById('fixture-result')!
    result.textContent = `외부 인증 차단 · 선택한 경로: ${anchor.getAttribute('href')}`
  }
})
createRoot(document.getElementById('root')!).render(
  <>
    <aside className="border-b border-border bg-muted p-3 text-sm">로컬 격리 검증 · 가상 연결 계정 · 외부 인증/계정 변경 차단</aside>
    <p id="fixture-result" role="status" className="break-all px-4 text-sm" />
    {query.get('view') === 'mobile'
      ? <main className="p-4"><MobileChannelsView snapshot={mapChannelsApi(fixture)} connectFlow={parseConnectFlow(window.location.search)} /></main>
      : <ChannelConnections />}
  </>,
)
