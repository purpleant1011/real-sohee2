import { notFound } from 'next/navigation'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { FirstPostEntry } from '@/features/mobile-firstpost/first-post-entry'
import { isFirstPostR2Enabled } from '@/features/mobile-firstpost/first-post-flag'

/** 복원 식별자만 허용한다. URL 에는 초안 내용·발화·사진 경로·지문을 싣지 않는다. */
const MISSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 첫 포스팅 R2 레인. 플래그(NEXT_PUBLIC_MOBILE_R2_FIRSTPOST=on)가 꺼져 있으면 존재하지 않는 페이지다.
 *
 * 플래그 판정은 서버에서 한다 — 서버 컴포넌트는 `'use client'` 모듈의 함수를 부를 수 없다.
 * 사진 범위 검증에 쓸 워크스페이스도 서버가 소속을 확인한 값만 넘긴다(추측 금지).
 * 확인할 수 없으면 초안 없이 화면을 열지 않는다(fail-closed).
 *
 * `?post=<missionId>` 는 새로고침·깊은 링크 복원용 식별자다. 형식이 틀리면 무시하고
 * 입력 화면에서 시작한다(조회 자체를 시도하지 않는다).
 */
export default async function FirstPostR2Page({
  searchParams,
}: Readonly<{ searchParams?: Promise<Record<string, string | string[] | undefined>> }> = {}) {
  if (!isFirstPostR2Enabled()) notFound()

  const workspace = await getCurrentWorkspaceContext()
  if (!workspace) notFound()

  const params = searchParams ? await searchParams : {}
  const rawPost = params.post
  const restoreMissionId = typeof rawPost === 'string' && MISSION_UUID.test(rawPost) ? rawPost : undefined

  return <FirstPostEntry workspaceId={workspace.workspaceId} restoreMissionId={restoreMissionId} />
}
