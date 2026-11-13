import { describe, it, expect, beforeEach } from 'vitest'
import {
  MySoheeSurfacesService,
} from '@/features/my-sohee-surfaces'

describe('HF-58 / ANI-1408 · My Sohee Connections & Permissions + Change History Surfaces', () => {
  const WORKSPACE_ID = 'ws-my-sohee-1'
  const OTHER_WORKSPACE_ID = 'ws-my-sohee-2'

  let service: MySoheeSurfacesService

  beforeEach(() => {
    service = new MySoheeSurfacesService()
  })

  // Test 1: Instagram CONNECTED but not VERIFIED -> 올바른 표현 (OAuth != VERIFIED)
  it('1. correctly distinguishes CONNECTED but not VERIFIED state from true VERIFIED', () => {
    service.registerChannelConnection({
      workspaceId: WORKSPACE_ID,
      channel: 'instagram',
      accountLabel: '@sohee_official',
      isConnected: true,
      isVerified: false, // OAuth 완료 후 아직 verification_runs 확인 전
      grantedScopes: ['instagram_basic'],
      requiredScopes: ['instagram_basic', 'instagram_content_publish'],
      lastVerifiedAt: null,
    })

    const view = service.getConnectionsSurface(WORKSPACE_ID)
    const ig = view.channels.find((c) => c.channel === 'instagram')

    expect(ig).toBeDefined()
    expect(ig?.statusBadge).toBe('CONNECTED_NOT_VERIFIED')
    expect(ig?.isVerified).toBe(false)
    expect(ig?.displayStatus).toContain('추가 권한 또는 확인 필요')
  })

  // Test 2: Threads token expired -> 재인증 CTA 및 needsReauth: true
  it('2. indicates token expiration with explicit re-authentication CTA', () => {
    service.registerChannelConnection({
      workspaceId: WORKSPACE_ID,
      channel: 'threads',
      accountLabel: '@sohee_threads',
      isConnected: true,
      isVerified: true,
      tokenExpired: true,
      grantedScopes: ['threads_basic', 'threads_content_publish'],
      requiredScopes: ['threads_basic', 'threads_content_publish'],
      lastVerifiedAt: '2026-09-01T00:00:00Z',
    })

    const view = service.getConnectionsSurface(WORKSPACE_ID)
    const th = view.channels.find((c) => c.channel === 'threads')

    expect(th?.needsReauth).toBe(true)
    expect(th?.statusBadge).toBe('REAUTH_REQUIRED')
    expect(th?.actionCta).toBe('재인증하기')
  })

  // Test 3: insufficient scope -> permission problem 표시
  it('3. highlights missing scopes in human-friendly language', () => {
    service.registerChannelConnection({
      workspaceId: WORKSPACE_ID,
      channel: 'instagram',
      accountLabel: '@my_biz',
      isConnected: true,
      isVerified: false,
      grantedScopes: ['instagram_basic'],
      requiredScopes: ['instagram_basic', 'instagram_content_publish', 'pages_read_engagement'],
      lastVerifiedAt: null,
    })

    const view = service.getConnectionsSurface(WORKSPACE_ID)
    const ig = view.channels.find((c) => c.channel === 'instagram')

    expect(ig?.hasMissingPermissions).toBe(true)
    expect(ig?.missingPermissions).toContain('instagram_content_publish')
    expect(ig?.missingPermissionsSummary).toContain('게시물 자동 발행 권한이 필요합니다')
  })

  // Test 4: raw token/secret response/log/UI 노출 0
  it('4. strictly omits raw access tokens, refresh tokens, and secrets from surface response', () => {
    service.registerChannelConnection({
      workspaceId: WORKSPACE_ID,
      channel: 'instagram',
      accountLabel: '@secure_shop',
      isConnected: true,
      isVerified: true,
      grantedScopes: ['instagram_basic'],
      requiredScopes: ['instagram_basic'],
      // Raw sensitive secrets in source
      rawAccessToken: 'EAABw...secret_access_token',
      rawRefreshToken: 'rfrsh_token_99999',
      encryptedIv: 'iv_value_secret',
    })

    const view = service.getConnectionsSurface(WORKSPACE_ID)
    const jsonStr = JSON.stringify(view)

    expect(jsonStr).not.toContain('secret_access_token')
    expect(jsonStr).not.toContain('rfrsh_token_99999')
    expect(jsonStr).not.toContain('iv_value_secret')
    expect((view.channels[0] as any).rawAccessToken).toBeUndefined()
  })

  // Test 5: Knowledge/Text/Image/Policy active versions와 history 일치
  it('5. aligns active version badges with confirmed version change history', () => {
    service.recordVersionChangeEvent({
      workspaceId: WORKSPACE_ID,
      domain: 'business_knowledge',
      versionNumber: 1,
      summary: '초기 사업 정보(영업시간, 주소) 확정',
      actorName: '원장님',
      actorType: 'user',
      isActive: true,
      changedAt: '2026-09-10T10:00:00Z',
    })

    service.recordVersionChangeEvent({
      workspaceId: WORKSPACE_ID,
      domain: 'text_harness',
      versionNumber: 2,
      summary: '친근한 말투 및 이모지 규칙 적용',
      actorName: '소희 매니저',
      actorType: 'user',
      isActive: true,
      changedAt: '2026-09-11T12:00:00Z',
    })

    const surface = service.getChangeHistorySurface(WORKSPACE_ID)
    expect(surface.activeVersions.business_knowledge).toBe(1)
    expect(surface.activeVersions.text_harness).toBe(2)
    expect(surface.historyItems).toHaveLength(2)
  })

  // Test 6: 새 confirmed version 생성 후 history에 추가되고 active 표시 갱신
  it('6. appends new confirmed version to history and updates active marker atomically', () => {
    service.recordVersionChangeEvent({
      workspaceId: WORKSPACE_ID,
      domain: 'operating_policy',
      versionNumber: 1,
      summary: '사전 승인 필수 정책 설정',
      actorName: '원장님',
      actorType: 'user',
      isActive: false, // 이전 버전
      changedAt: '2026-09-08T09:00:00Z',
    })

    service.recordVersionChangeEvent({
      workspaceId: WORKSPACE_ID,
      domain: 'operating_policy',
      versionNumber: 2,
      summary: '일일 발행 한도 2회로 증액 및 긴급정지 유지',
      actorName: '원장님',
      actorType: 'user',
      isActive: true, // 최신 버전
      changedAt: '2026-09-12T14:00:00Z',
    })

    const surface = service.getChangeHistorySurface(WORKSPACE_ID)
    expect(surface.activeVersions.operating_policy).toBe(2)

    const opHistory = surface.historyItems.filter((i) => i.domain === 'operating_policy')
    expect(opHistory).toHaveLength(2)
    expect(opHistory.find((i) => i.versionNumber === 1)?.isActive).toBe(false)
    expect(opHistory.find((i) => i.versionNumber === 2)?.isActive).toBe(true)
  })

  // Test 7: cross-tenant history/version/account 조회 deny
  it('7. denies cross-tenant access to connections and history surfaces', () => {
    service.registerChannelConnection({
      workspaceId: WORKSPACE_ID,
      channel: 'instagram',
      accountLabel: '@tenant_a_brand',
      isConnected: true,
      isVerified: true,
      grantedScopes: ['instagram_basic'],
      requiredScopes: ['instagram_basic'],
    })

    const otherSurface = service.getConnectionsSurface(OTHER_WORKSPACE_ID)
    expect(otherSurface.channels).toHaveLength(0) // 타 테넌트 채널 미노출

    expect(() => {
      service.getChannelDetail(OTHER_WORKSPACE_ID, 'instagram')
    }).toThrowError(/CROSS_TENANT_ACCESS_DENIED/)
  })

  // Test 8: owner/admin/agent canonical state와 사용자 surface 상태 불일치 0
  it('8. guarantees same-truth view across owner, admin, and agent readers', () => {
    service.registerChannelConnection({
      workspaceId: WORKSPACE_ID,
      channel: 'threads',
      accountLabel: '@same_truth_th',
      isConnected: true,
      isVerified: true,
      grantedScopes: ['threads_basic', 'threads_content_publish'],
      requiredScopes: ['threads_basic', 'threads_content_publish'],
      lastVerifiedAt: '2026-09-12T10:00:00Z',
    })

    const ownerView = service.getConnectionsSurface(WORKSPACE_ID, 'owner')
    const adminView = service.getConnectionsSurface(WORKSPACE_ID, 'admin')
    const agentView = service.getConnectionsSurface(WORKSPACE_ID, 'agent')

    expect(ownerView.channels[0].statusBadge).toBe(adminView.channels[0].statusBadge)
    expect(adminView.channels[0].statusBadge).toBe(agentView.channels[0].statusBadge)
    expect(ownerView.channels[0].statusBadge).toBe('VERIFIED')
  })

  // Test 9: 375/768/1024/1440 뷰포트 지원을 위한 반응형 메타데이터 제공
  it('9. provides responsive view hierarchy supporting 375, 768, 1024, and 1440 viewports', () => {
    service.registerChannelConnection({
      workspaceId: WORKSPACE_ID,
      channel: 'instagram',
      accountLabel: '@responsive_test',
      isConnected: true,
      isVerified: true,
      grantedScopes: ['instagram_basic'],
      requiredScopes: ['instagram_basic'],
    })

    const surface = service.getConnectionsSurface(WORKSPACE_ID)
    expect(surface.layoutConfig.supportedBreakpoints).toEqual(['375px', '768px', '1024px', '1440px'])
    expect(surface.layoutConfig.compactOnMobile).toBe(true)
  })
})
