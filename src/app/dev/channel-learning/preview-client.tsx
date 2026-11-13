'use client'

import { useMemo, useState } from 'react'
import { ChannelLearningPanel } from '@/features/channel-learning/components/channel-learning-panel'
import { getLearningCapabilities } from '@/features/channel-learning/capabilities'
import type { LearningCandidate, LearningSource } from '@/features/channel-learning/contracts'

const workspaceId = '10000000-0000-4000-8000-000000000001'
const sampleId = '20000000-0000-4000-8000-000000000001'

/** Synthetic UI fixture only. This transport never calls an API, a model or a real account. */
function createPreviewTransport(): typeof fetch {
  const now = new Date().toISOString()
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
  let sources: LearningSource[] = [{ workspaceId, sourceId: sampleId, revision: 1,
    platform: 'instagram', canonicalUrl: 'https://www.instagram.com/sohee_demo_shop/',
    canonicalIdentity: 'sohee_demo_shop', verification: 'verified', collection: 'review_required',
    consent: { text: true, images: false, revision: 1 }, deletedAt: null,
    lease: { workspaceId, sourceId: sampleId, revision: 1, providerAccountId: 'demo-account', method: 'oauth',
      verifiedAt: now, expiresAt, revokedAt: null, evidenceRevision: 1 } }]
  let candidates: LearningCandidate[] = [{ id: '40000000-0000-4000-8000-000000000001',
    source: { workspaceId, sourceId: sampleId, revision: 1 }, version: 1,
    category: 'hours', content: '평일 오전 10시부터 오후 7시까지 운영해요. (가상 자료)',
    evidence: { documentId: '30000000-0000-4000-8000-000000000001', excerpt: '평일 10:00–19:00', visionReceiptId: null },
    evidenceState: 'observed', status: 'review_required', conflictsWithFactId: null }]
  const response = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost').pathname
    const method = init?.method ?? 'GET'
    const root = `/api/workspaces/${workspaceId}/knowledge/channels`
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {}
    if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    if (path === root && method === 'GET') return response({ sources, capabilities: getLearningCapabilities() })
    if (path === root && method === 'POST') {
      const url = new URL(String(body.url))
      const sourceId = crypto.randomUUID()
      const source: LearningSource = { workspaceId, sourceId, revision: 1,
        platform: body.platform as LearningSource['platform'], canonicalUrl: url.href,
        canonicalIdentity: url.pathname.split('/').filter(Boolean)[0] ?? url.hostname,
        verification: 'pending', collection: 'blocked', consent: { ...body.consent as { text: boolean; images: boolean }, revision: 1 },
        lease: null, deletedAt: null }
      sources = [...sources, source]
      return response({ source }, 201)
    }
    const parts = path.slice(root.length + 1).split('/')
    const source = sources.find((item) => item.sourceId === parts[0])
    if (!source) return response({ error: 'NOT_FOUND', message: '출처를 찾을 수 없어요.' }, 404)
    if (method === 'GET') return response({ source, candidates: candidates.filter((item) => item.source.sourceId === source.sourceId), jobs: [] })
    if (body.revision !== source.revision) return response({ error: 'STALE_REVISION', message: '최신 상태를 다시 확인해 주세요.' }, 409)
    if (parts[1] === 'verify') {
      if (source.canonicalUrl.includes('unconnected') || source.canonicalIdentity.includes('unconnected')) {
        return response(
          {
            error: {
              code: 'CONNECTION_REQUIRED',
              message: 'Instagram account connection required for OAuth verification',
            },
          },
          409,
        )
      }
      source.verification = 'verified'
      source.collection = 'queued'
      source.lease = { workspaceId, sourceId: source.sourceId, revision: source.revision,
        providerAccountId: 'demo-account', method: 'oauth', verifiedAt: now, expiresAt, revokedAt: null, evidenceRevision: 1 }
      return response({ source })
    }
    if (parts[1] === 'collect') {
      source.collection = 'review_required'
      if (!candidates.some((item) => item.source.sourceId === source.sourceId)) {
        candidates.push({
          id: crypto.randomUUID(),
          source: { workspaceId, sourceId: source.sourceId, revision: source.revision },
          version: 1,
          category: 'hours',
          content: '평일 11시부터 20시까지 영업합니다.',
          evidence: {
            documentId: crypto.randomUUID(),
            excerpt: '영업시간 평일 11:00-20:00',
            visionReceiptId: null,
          },
          evidenceState: 'observed',
          status: 'review_required',
          conflictsWithFactId: null,
        })
      }
      return response({ jobId: crypto.randomUUID(), state: 'queued' }, 202)
    }
    if (parts[1] === 'review') {
      const decisions = body.decisions as { candidateId: string; decision: 'approved' | 'rejected'; editedContent?: string }[]
      candidates = candidates.map((candidate) => {
        const decision = decisions.find((item) => item.candidateId === candidate.id)
        return decision ? { ...candidate, status: decision.decision, content: decision.editedContent ?? candidate.content, version: candidate.version + 1 } : candidate
      })
      source.collection = 'partial'
      return response({ source })
    }
    if (method === 'DELETE') {
      sources = sources.filter((item) => item.sourceId !== source.sourceId)
      candidates = candidates.filter((item) => item.source.sourceId !== source.sourceId)
      return response({ deletionJobId: crypto.randomUUID(), status: 'pending' }, 202)
    }
    if (method === 'PATCH') {
      source.verification = 'revoked'
      source.collection = 'cancelled'
      source.revision++
      return response({ source })
    }
    return response({ error: 'CAPABILITY_BLOCKED', message: '지원되지 않는 동작이에요.' }, 409)
  }) as typeof fetch
}

export default function LearningPreviewClient() {
  const fetcher = useMemo(() => createPreviewTransport(), [])
  const [canManage] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search)
      return params.get('role') !== 'viewer'
    }
    return true
  })

  return (
    <main className="min-h-screen bg-background text-foreground px-4 py-6 sm:px-8 sm:py-10">
      <aside className="mx-auto mb-6 max-w-4xl rounded-lg border border-border bg-muted p-3 text-sm" role="note">
        <strong>로컬 UI 검증 · 가상 자료</strong>
        <p>실제 계정 연결·수집·AI 분석·DB 쓰기는 실행하지 않습니다.</p>
        {!canManage && <p className="text-xs text-destructive mt-1 font-semibold">현재 보기 전용(Viewer) 권한으로 표시 중입니다.</p>}
      </aside>
      <ChannelLearningPanel workspaceId={workspaceId} canManage={canManage} fetcher={fetcher} />
    </main>
  )
}
