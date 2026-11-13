'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { WorkspaceProvider, type WorkspaceContextValue } from '@/components/workspace/workspace-provider'
import { MobileR2Provider } from '@/features/mobile-shell/r2-gate'
import { MagicPhotoDropzone } from '@/components/home-today/magic-photo-dropzone'

const FIXED_WORKSPACE_ID = '10000000-0000-4000-8000-000000000001'

const MOCK_WORKSPACE_VALUE: WorkspaceContextValue = {
  workspaceId: FIXED_WORKSPACE_ID,
  workspaceName: '사진 글 하네스',
  workspaceKind: 'restaurant',
  membershipRole: 'owner',
  actorId: 'dev-user-owner',
  resolutionSource: 'explicit-selection',
  workspaceCanSwitch: false,
}

const MOCK_SAVED_PHOTOS = [
  {
    id: '10000000-0000-4000-8000-000000000011',
    rights_status: 'confirmed',
    publish_eligibility: true,
  },
  {
    id: '10000000-0000-4000-8000-000000000012',
    rights_status: 'confirmed',
    publish_eligibility: true,
  },
  {
    id: '10000000-0000-4000-8000-000000000013',
    rights_status: 'pending',
    publish_eligibility: false,
  },
]

export function PhotoPostMobilePreview() {
  const searchParams = useSearchParams()
  const state = searchParams?.get('state') ?? 'saved'
  const containerRef = useRef<HTMLDivElement>(null)

  const mockFetcher = useMemo<typeof fetch>(() => {
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const method = init?.method?.toUpperCase() || 'GET'
      const parsedUrl = new URL(rawUrl, 'http://localhost')

      if (parsedUrl.pathname === '/api/onboarding/media') {
        if (method === 'POST') {
          return Response.json({ ok: true, selected: true })
        }
        const items = state === 'empty' ? [] : MOCK_SAVED_PHOTOS
        return Response.json({ items })
      }

      if (parsedUrl.pathname.includes('/quick-post')) {
        if (method === 'POST') {
          let requestId = '10000000-0000-4000-8000-000000000099'
          try {
            if (init?.body && typeof init.body === 'string') {
              const parsed = JSON.parse(init.body)
              if (parsed.requestId) requestId = parsed.requestId
            }
          } catch {
            // fallback
          }
          return Response.json({ item: { missionId: requestId } })
        }

        if (parsedUrl.pathname.endsWith('/quick-post')) {
          return Response.json({ credits: { photoDraftCost: 100 } })
        }

        const parts = parsedUrl.pathname.split('/')
        const missionId = parts[parts.length - 1]
        return Response.json({
          item: {
            missionId,
            imageIds: ['10000000-0000-4000-8000-000000000011'],
          },
        })
      }

      return Response.json({ error: 'not found' }, { status: 404 })
    }
  }, [state])

  useEffect(() => {
    const trigger =
      containerRef.current?.querySelector<HTMLButtonElement>('button[aria-expanded="false"]') ??
      document.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')
    if (trigger) {
      trigger.click()
    }
  }, [])

  return (
    <MobileR2Provider enabled forceMobile>
      <WorkspaceProvider value={MOCK_WORKSPACE_VALUE}>
        <div className="min-h-screen bg-background text-foreground flex justify-center py-4 px-2 sm:px-4">
          <div
            ref={containerRef}
            className="w-full max-w-[390px] min-w-[320px] flex flex-col bg-background border border-border/70 rounded-2xl shadow-sm overflow-hidden"
          >
            {/* 모바일 셸 모의 헤더 */}
            <header className="flex h-14 items-center justify-between border-b border-border/60 px-3 bg-card/80 backdrop-blur sticky top-0 z-30">
              <Link
                href="/dev/mobile-r2/app"
                className="inline-flex size-10 items-center justify-center rounded-xl text-foreground hover:bg-muted active:scale-95 transition-all"
                aria-label="오늘 탭으로 돌아가기"
              >
                <ChevronLeft className="size-6" />
              </Link>
              <h1 className="text-base font-semibold tracking-tight text-foreground">사진으로 글 만들기</h1>
              <div className="size-10" aria-hidden="true" />
            </header>

            {/* 본문 */}
            <main className="flex-1 p-4">
              <MagicPhotoDropzone
                workspaceId={FIXED_WORKSPACE_ID}
                fetcher={mockFetcher}
              />
            </main>
          </div>
        </div>
      </WorkspaceProvider>
    </MobileR2Provider>
  )
}
