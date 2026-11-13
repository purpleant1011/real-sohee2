import { describe, expect, it, vi } from 'vitest'
import { resolveWorkspaceBusinessInfo, sourceToKorean } from './business-info-resolver'

const workspaceId = 'e1559000-0000-4000-8000-000000000001'
const otherWorkspaceId = 'e1559000-0000-4000-8000-000000000099'
const ownerUserId = 'e1559000-0000-4000-8000-000000000002'
const strangerUserId = 'e1559000-0000-4000-8000-000000000088'

function createMockClient(options: {
  verification?: { data: any; error: any }
  signupApp?: { data: any; error: any }
  members?: { data: any; error: any }
  profile?: { data: any; error: any }
  agreements?: { data: any; error: any }
  naverPlace?: { data: any; error: any }
  businessDetails?: { data: any; error: any }
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'business_verifications') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue(options.verification ?? { data: null, error: null }),
            }),
          }),
        }
      }
      if (table === 'workspace_members') {
        const eqSecond = vi.fn().mockResolvedValue(options.members ?? { data: [{ user_id: ownerUserId }], error: null })
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: eqSecond,
            }),
          }),
        }
      }
      if (table === 'signup_applications') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue(options.signupApp ?? { data: null, error: null }),
            }),
          }),
        }
      }
      if (table === 'business_profiles') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue(options.profile ?? { data: null, error: null }),
            }),
          }),
        }
      }
      if (table === 'user_agreements') {
        const eqSecond = vi.fn().mockResolvedValue(options.agreements ?? { data: [], error: null })
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: eqSecond,
            }),
          }),
        }
      }
      if (table === 'channel_connections') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue(options.naverPlace ?? { data: null, error: null }),
              }),
            }),
          }),
        }
      }
      if (table === 'workspace_business_details') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue(options.businessDetails ?? { data: null, error: null }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    }),
  } as any
}

describe('resolveWorkspaceBusinessInfo', () => {
  it('canonical verifications가 VERIFIED면 승인됨으로 판정하고 provenance를 기록한다', async () => {
    const client = createMockClient({
      verification: {
        data: {
          company_name: '정식사업자',
          representative_name: '홍길동',
          business_number: '1234567890',
          status: 'VERIFIED',
          updated_at: '2026-10-20T10:00:00Z',
          rejection_reason: null,
        },
        error: null,
      },
    })

    const result = await resolveWorkspaceBusinessInfo(workspaceId, client)
    expect(result.status).toBe('VERIFIED')
    expect(result.statusLabel).toBe('승인됨')
    expect(result.companyName.value).toBe('정식사업자')
    expect(result.companyName.source).toBe('business_verifications')
    expect(result.businessNumber.value).toBe('1234567890')
    expect(result.businessNumber.source).toBe('business_verifications')
  })

  it('verifications가 없어도 signup_applications에 워크스페이스와 제출자가 일치하면 사업자 정보 제출됨·인증 대기로 판정한다 (신청서로 승인 추론 금지)', async () => {
    const client = createMockClient({
      verification: { data: null, error: null },
      members: { data: [{ user_id: ownerUserId }], error: null },
      signupApp: {
        data: {
          workspace_id: workspaceId,
          user_id: ownerUserId,
          company_name: '해드림물류',
          representative_name: '김대표',
          business_number: '2208199999',
          state: 'COMPLETED', // COMPLETED 상태여도 VERIFIED로 추론하면 안 됨!
          updated_at: '2026-10-18T12:00:00Z',
        },
        error: null,
      },
    })

    const result = await resolveWorkspaceBusinessInfo(workspaceId, client)
    expect(result.status).toBe('SUBMITTED_PENDING')
    expect(result.statusLabel).toBe('사업자 정보 제출됨·인증 대기')
    expect(result.companyName.value).toBe('해드림물류')
    expect(result.companyName.source).toBe('signup_applications')
    expect(result.businessNumber.value).toBe('2208199999')
    expect(result.businessNumber.source).toBe('signup_applications')
  })

  it('상호명만 있고 사업자번호가 없는 신청서는 사업자 제출 완료로 추정하지 않고 미제출로 판정한다', async () => {
    const client = createMockClient({
      verification: { data: null, error: null },
      members: { data: [{ user_id: ownerUserId }], error: null },
      signupApp: {
        data: {
          workspace_id: workspaceId,
          user_id: ownerUserId,
          company_name: '상호명만있는매장',
          business_number: null,
          state: 'FORM_REQUIRED',
        },
        error: null,
      },
    })

    const result = await resolveWorkspaceBusinessInfo(workspaceId, client)
    expect(result.status).toBe('NOT_SUBMITTED')
    expect(result.statusLabel).toBe('미제출')
    expect(result.companyName.value).toBe('상호명만있는매장')
    expect(result.companyName.source).toBe('signup_applications')
    expect(result.businessNumber.value).toBeNull()
  })

  it('signup_applications의 제출자(user_id)가 워크스페이스 멤버가 아니면 타인 정보 누출 방지로 무시한다', async () => {
    const client = createMockClient({
      verification: { data: null, error: null },
      members: { data: [{ user_id: ownerUserId }], error: null },
      signupApp: {
        data: {
          workspace_id: workspaceId,
          user_id: strangerUserId, // 워크스페이스 멤버가 아님!
          company_name: '해킹상호',
          representative_name: '타인',
          business_number: '9999999999',
          state: 'FORM_REQUIRED',
        },
        error: null,
      },
    })

    const result = await resolveWorkspaceBusinessInfo(workspaceId, client)
    expect(result.status).toBe('NOT_SUBMITTED')
    expect(result.statusLabel).toBe('미제출')
    expect(result.companyName.value).toBeNull()
    expect(result.businessNumber.value).toBeNull()
  })

  it('signup_applications의 workspace_id가 다른 워크스페이스면 타인 정보 누출 방지로 무시한다', async () => {
    const client = createMockClient({
      verification: { data: null, error: null },
      members: { data: [{ user_id: ownerUserId }], error: null },
      signupApp: {
        data: {
          workspace_id: otherWorkspaceId, // 다른 워크스페이스
          user_id: ownerUserId,
          company_name: '타사상호',
          business_number: '8888888888',
        },
        error: null,
      },
    })

    const result = await resolveWorkspaceBusinessInfo(workspaceId, client)
    expect(result.status).toBe('NOT_SUBMITTED')
    expect(result.companyName.value).toBeNull()
  })

  it('DB 조회 실패 시 에러 상태를 반환하며 절대로 미제출로 조용히 fallback하지 않는다', async () => {
    const client = createMockClient({
      verification: { data: null, error: { message: 'DB connection timeout' } },
    })

    const result = await resolveWorkspaceBusinessInfo(workspaceId, client)
    expect(result.status).toBe('QUERY_ERROR')
    expect(result.statusLabel).toBe('조회 실패')
    expect(result.error).toBeDefined()
  })

  it('정보가 전혀 없으면 미제출로 반환한다', async () => {
    const client = createMockClient({
      verification: { data: null, error: null },
      signupApp: { data: null, error: null },
      profile: { data: null, error: null },
    })

    const result = await resolveWorkspaceBusinessInfo(workspaceId, client)
    expect(result.status).toBe('NOT_SUBMITTED')
    expect(result.statusLabel).toBe('미제출')
  })

  it('sourceToKorean이 올바른 한국어 명칭을 반환한다', () => {
    expect(sourceToKorean('business_verifications')).toBe('사업자 인증 신청서')
    expect(sourceToKorean('signup_applications')).toBe('회원가입 신청서')
    expect(sourceToKorean('business_profiles')).toBe('매장 프로필')
    expect(sourceToKorean('channel_connections')).toBe('채널 연동')
    expect(sourceToKorean('none')).toBe('미등록')
  })

  it('소셜 가입 완료자(사업자 정보 미제출)는 identityState=COMPLETED, businessSubmissionState=NOT_SUBMITTED로 명확히 분리 투영된다', async () => {
    const client = createMockClient({
      verification: { data: null, error: null },
      members: { data: [{ user_id: ownerUserId }], error: null },
      signupApp: {
        data: {
          workspace_id: workspaceId,
          user_id: ownerUserId,
          company_name: null,
          business_number: null,
          representative_name: null,
          state: 'COMPLETED',
          agreements_completed: false,
          created_at: '2026-10-15T09:00:00Z',
        },
        error: null,
      },
    })

    const result = await resolveWorkspaceBusinessInfo(workspaceId, client)
    expect(result.identityState).toBe('COMPLETED')
    expect(result.identityStateLabel).toBe('가입 완료')
    expect(result.businessSubmissionState).toBe('NOT_SUBMITTED')
    expect(result.businessSubmissionStateLabel).toBe('사업자 정보 미제출')
    expect(result.status).toBe('NOT_SUBMITTED')
    expect(result.statusLabel).toBe('미제출')
  })

  it('개업일자 및 증빙 서류 유무를 안전하게 투영한다', async () => {
    const client = createMockClient({
      verification: {
        data: {
          company_name: '테스트매장',
          representative_name: '대표자',
          business_number: '1234567890',
          start_date: '20230501',
          document_url: 'e1559000-0000-4000-8000-000000000001/doc.pdf',
          status: 'PENDING',
          updated_at: '2026-10-21T00:00:00Z',
        },
        error: null,
      },
      members: { data: [{ user_id: ownerUserId }], error: null },
    })

    const result = await resolveWorkspaceBusinessInfo(workspaceId, client)
    expect(result.startDate.value).toBe('20230501')
    expect(result.startDate.source).toBe('business_verifications')
    expect(result.hasDocument).toBe(true)
    expect(result.submittedAt).toBe('2026-10-21T00:00:00Z')
    expect(result.businessSubmissionState).toBe('SUBMITTED')
  })

  it('user_agreements에 마케팅 동의가 기록되어 있으면 marketingConsent를 안전하게 반환한다', async () => {
    const client = createMockClient({
      verification: { data: null, error: null },
      members: { data: [{ user_id: ownerUserId }], error: null },
      signupApp: {
        data: {
          workspace_id: workspaceId,
          user_id: ownerUserId,
          state: 'COMPLETED',
        },
        error: null,
      },
      agreements: {
        data: [
          { agreement_type: 'TERMS_OF_SERVICE', version: '2026.09-v1', agreed: true, agreed_at: '2026-10-21T01:00:00Z' },
          { agreement_type: 'MARKETING_NOTIFICATIONS', version: '2026.09-v1', agreed: false, agreed_at: '2026-10-21T01:00:00Z' },
        ],
        error: null,
      },
    })

    const result = await resolveWorkspaceBusinessInfo(workspaceId, client)
    expect(result.marketingConsent).toEqual({
      agreed: false,
      agreedAt: '2026-10-21T01:00:00Z',
      version: '2026.09-v1',
    })
  })

  it('signup_applications가 없거나 타인 제출물이면 다른 멤버의 약관/동의를 유출하지 않는다 (다중 멤버 격리)', async () => {
    const client = createMockClient({
      verification: { data: null, error: null },
      members: { data: [{ user_id: ownerUserId }, { user_id: strangerUserId }], error: null },
      signupApp: {
        data: null, // 신청서 없음
        error: null,
      },
      agreements: {
        data: [
          { agreement_type: 'MARKETING_NOTIFICATIONS', version: '2026.09-v1', agreed: true, agreed_at: '2026-10-21T01:00:00Z' },
        ],
        error: null,
      },
    })

    const result = await resolveWorkspaceBusinessInfo(workspaceId, client)
    expect(result.agreements).toEqual([])
    expect(result.marketingConsent).toBeNull()
  })

  it('사장님 자가 입력 사업자·운영 정보를 selfReported 로 반환하되 인증 상태는 바꾸지 않는다', async () => {
    const client = createMockClient({
      verification: { data: null, error: null },
      businessDetails: {
        data: {
          business_number: '0000000000',
          representative_name: '홍길동',
          business_start_date: '20190301',
          business_type: '서비스업',
          business_item: '속눈썹증모',
          phone: '010-1234-5678',
          business_hours: '평일 10:00~19:00',
          closed_days: '매주 월요일',
          parking_info: '매장 앞 2대',
          reservation_method: '네이버 예약',
          website_url: 'https://blog.naver.com/bairm',
          price_range: '1인 3~5만원',
          naver_place_url: 'https://naver.me/abc',
          intake_source: 'manual',
          updated_at: '2026-10-22T05:00:00Z',
        },
        error: null,
      },
    })

    const result = await resolveWorkspaceBusinessInfo(workspaceId, client)

    // 자가 입력은 표시용으로만 쓰이고, 인증 상태를 승격시키지 않는다.
    expect(result.status).toBe('NOT_SUBMITTED')
    expect(result.statusLabel).toBe('미제출')

    expect(result.selfReported).toMatchObject({
      businessNumber: '0000000000',
      representativeName: '홍길동',
      businessHours: '평일 10:00~19:00',
      closedDays: '매주 월요일',
      parkingInfo: '매장 앞 2대',
      priceRange: '1인 3~5만원',
      intakeSource: 'manual',
      updatedAt: '2026-10-22T05:00:00Z',
    })
  })

  it('자가 입력이 없으면 selfReported 는 null 이다', async () => {
    const client = createMockClient({ verification: { data: null, error: null } })
    const result = await resolveWorkspaceBusinessInfo(workspaceId, client)
    expect(result.selfReported).toBeNull()
  })

  it('빈 문자열 자가 입력 필드는 null 로 정규화한다 (폼이 빈 값을 보낸 경우)', async () => {
    const client = createMockClient({
      verification: { data: null, error: null },
      businessDetails: {
        data: { business_hours: '', parking_info: '   ', intake_source: 'naver_sync', updated_at: '2026-10-22T05:00:00Z' },
        error: null,
      },
    })
    const result = await resolveWorkspaceBusinessInfo(workspaceId, client)
    expect(result.selfReported?.businessHours).toBeNull()
    expect(result.selfReported?.parkingInfo).toBeNull()
    expect(result.selfReported?.intakeSource).toBe('naver_sync')
  })
})
