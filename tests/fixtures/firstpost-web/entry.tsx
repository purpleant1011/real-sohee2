import React from 'react'
import { createRoot } from 'react-dom/client'
import { FirstPostEntry } from '../../../src/features/mobile-firstpost/first-post-entry'
import '../../../src/app/globals.css'
import { MobileLayoutHarness } from './mobile-layout'

const workspaceId = 'a7920000-0000-4000-8000-000000000001'
const post = new URLSearchParams(location.search).get('post') || undefined
createRoot(document.getElementById('root')!).render(<><aside className="border-b border-border bg-muted px-4 py-2 text-xs text-muted-foreground">로컬 격리 검증 · 신원/AI/준비 데이터 fixture · 실제 PostgreSQL/업로드 바이트 · 외부 게시 차단</aside>{location.pathname === '/app/work/new' ? <FirstPostEntry workspaceId={workspaceId} restoreMissionId={post} /> : <MobileLayoutHarness />}</>)
