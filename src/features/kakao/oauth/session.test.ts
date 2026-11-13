import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isKakaoIdentityMatch,
  resolveKakaoUser,
  issueKakaoSupabaseSession,
  type KakaoAuthProfile,
} from './session'

describe('Kakao OAuth Session Management', () => {
  const mockCreateUser = vi.fn()
  const mockGenerateLink = vi.fn()
  const mockVerifyOtp = vi.fn()

  const adminClient = {
    auth: {
      admin: {
        createUser: mockCreateUser,
        generateLink: mockGenerateLink,
      },
    },
  }

  const serverSupabase = {
    auth: {
      verifyOtp: mockVerifyOtp,
    },
  } as any

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('isKakaoIdentityMatch', () => {
    it('user_metadata.kakao_id 는 카카오 신원으로 인정하지 않는다 (보안 규칙)', () => {
      const attacker = {
        id: 'attacker',
        email: 'attacker@example.com',
        app_metadata: { provider: 'email' },
        user_metadata: { kakao_id: '12345' },
        identities: [],
      } as any

      expect(isKakaoIdentityMatch(attacker, '12345')).toBe(false)
    })

    it('app_metadata 에 kakao_id 가 있는 서버 발급 계정을 신원으로 인정한다', () => {
      const real = {
        id: 'real',
        email: 'real@example.com',
        app_metadata: { provider: 'kakao', kakao_id: '12345' },
        user_metadata: {},
        identities: [],
      } as any

      expect(isKakaoIdentityMatch(real, '12345')).toBe(true)
    })

    it('identities 에 kakao provider 및 일치하는 id 가 있으면 인정한다', () => {
      const real = {
        id: 'real',
        email: 'real@example.com',
        app_metadata: {},
        user_metadata: {},
        identities: [{ provider: 'kakao', id: '12345' }],
      } as any

      expect(isKakaoIdentityMatch(real, 12345)).toBe(true)
    })

    it('identities 에 identity_data.sub 로 매칭되어도 인정한다', () => {
      const real = {
        id: 'real',
        email: 'real@example.com',
        app_metadata: {},
        user_metadata: {},
        identities: [{ provider: 'kakao', id: 'other', identity_data: { sub: '12345' } }],
      } as any

      expect(isKakaoIdentityMatch(real, '12345')).toBe(true)
    })

    it('카카오 id가 일치하지 않거나 다른 provider 인 경우 불인정한다', () => {
      const googleUser = {
        id: 'google-user',
        email: 'user@example.com',
        app_metadata: { provider: 'google' },
        identities: [{ provider: 'google', id: '12345' }],
      } as any

      expect(isKakaoIdentityMatch(googleUser, '12345')).toBe(false)
    })
  })

  describe('resolveKakaoUser', () => {
    const profile: KakaoAuthProfile = {
      id: 12345,
      email: 'user@example.com',
      nickname: '소희테스트',
      avatarUrl: 'https://example.com/avatar.png',
    }

    it('신규 사용자 생성 시 createUser가 성공하면 isNew: true 를 반환한다', async () => {
      mockCreateUser.mockResolvedValueOnce({
        data: {
          user: {
            id: 'new-kakao-user',
            email: 'user@example.com',
            user_metadata: { kakao_id: '12345' },
          },
        },
        error: null,
      })

      const result = await resolveKakaoUser(adminClient, profile)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.user.id).toBe('new-kakao-user')
        expect(result.isNew).toBe(true)
      }
      expect(mockCreateUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'user@example.com',
          email_confirm: true,
          user_metadata: expect.objectContaining({
            kakao_id: '12345',
            name: '소희테스트',
          }),
          app_metadata: expect.objectContaining({
            provider: 'kakao',
            kakao_id: '12345',
          }),
        }),
      )
      expect(mockGenerateLink).not.toHaveBeenCalled()
    })

    it('프로필에 이메일이 없는 경우 kakao_<id>@kakao.internal 형식의 이메일로 생성한다', async () => {
      const noEmailProfile: KakaoAuthProfile = {
        id: 99999,
        nickname: '이메일없음',
      }

      mockCreateUser.mockResolvedValueOnce({
        data: {
          user: {
            id: 'internal-user',
            email: 'kakao_99999@kakao.internal',
          },
        },
        error: null,
      })

      const result = await resolveKakaoUser(adminClient, noEmailProfile)
      expect(result.ok).toBe(true)
      expect(mockCreateUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'kakao_99999@kakao.internal',
        }),
      )
    })

    it('createUser 실패 시 email_exists 에러면 generateLink로 사용자를 조회하여 카카오 신원 일치 시 isNew: false 를 반환한다', async () => {
      mockCreateUser.mockResolvedValueOnce({
        data: null,
        error: { code: 'email_exists', message: 'User already exists' },
      })

      mockGenerateLink.mockResolvedValueOnce({
        data: {
          user: {
            id: 'existing-kakao-user',
            email: 'user@example.com',
            identities: [{ provider: 'kakao', id: '12345' }],
          },
        },
        error: null,
      })

      const result = await resolveKakaoUser(adminClient, profile)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.user.id).toBe('existing-kakao-user')
        expect(result.isNew).toBe(false)
      }
      expect(mockGenerateLink).toHaveBeenCalledWith({
        type: 'magiclink',
        email: 'user@example.com',
      })
    })

    it('createUser 실패 시 message에 "already been registered"가 포함되어도 email_exists 로 처리한다', async () => {
      mockCreateUser.mockResolvedValueOnce({
        data: null,
        error: { message: 'A user with this email address has already been registered' },
      })

      mockGenerateLink.mockResolvedValueOnce({
        data: {
          user: {
            id: 'existing-kakao-user',
            email: 'user@example.com',
            app_metadata: { provider: 'kakao', kakao_id: '12345' },
          },
        },
        error: null,
      })

      const result = await resolveKakaoUser(adminClient, profile)
      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.user.id).toBe('existing-kakao-user')
        expect(result.isNew).toBe(false)
      }
    })

    it('동일 이메일 계정이 카카오 신원이 아닌 경우 account_linking_prohibited 에러를 반환한다', async () => {
      mockCreateUser.mockResolvedValueOnce({
        data: null,
        error: { code: 'email_exists', message: 'User already exists' },
      })

      mockGenerateLink.mockResolvedValueOnce({
        data: {
          user: {
            id: 'google-user',
            email: 'user@example.com',
            app_metadata: { provider: 'google' },
            identities: [{ provider: 'google', id: 'g-123' }],
          },
        },
        error: null,
      })

      const result = await resolveKakaoUser(adminClient, profile)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('account_linking_prohibited')
      }
    })

    it('email_exists 에러 후 generateLink가 실패하거나 user가 없으면 user_creation_failed 를 반환한다', async () => {
      mockCreateUser.mockResolvedValueOnce({
        data: null,
        error: { code: 'email_exists', message: 'User already exists' },
      })

      mockGenerateLink.mockResolvedValueOnce({
        data: null,
        error: { message: 'Failed to generate link' },
      })

      const result = await resolveKakaoUser(adminClient, profile)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('user_creation_failed')
      }
    })

    it('createUser가 일반 에러(DB오류 등)인 경우 user_creation_failed 를 반환한다', async () => {
      mockCreateUser.mockResolvedValueOnce({
        data: null,
        error: { code: 'unexpected_failure', message: 'Database failure' },
      })

      const result = await resolveKakaoUser(adminClient, profile)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('user_creation_failed')
      }
      expect(mockGenerateLink).not.toHaveBeenCalled()
    })
  })

  describe('issueKakaoSupabaseSession', () => {
    it('generateLink로 토큰을 생성하고 verifyOtp로 세션을 발급한다', async () => {
      mockGenerateLink.mockResolvedValueOnce({
        data: {
          properties: {
            hashed_token: 'hashed_token_xyz',
          },
        },
        error: null,
      })

      mockVerifyOtp.mockResolvedValueOnce({
        data: {
          session: {
            access_token: 'valid_access_token',
            refresh_token: 'valid_refresh_token',
          },
          user: { id: 'user-1' },
        },
        error: null,
      })

      const user = { id: 'user-1', email: 'user@example.com' } as any
      const result = await issueKakaoSupabaseSession(adminClient, serverSupabase, user)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.session.access_token).toBe('valid_access_token')
      }
      expect(mockGenerateLink).toHaveBeenCalledWith({
        type: 'magiclink',
        email: 'user@example.com',
      })
      expect(mockVerifyOtp).toHaveBeenCalledWith({
        token_hash: 'hashed_token_xyz',
        type: 'magiclink',
      })
    })

    it('generateLink 실패 시 session_failed 에러를 반환한다', async () => {
      mockGenerateLink.mockResolvedValueOnce({
        data: null,
        error: { message: 'rate limit exceeded' },
      })

      const user = { id: 'user-1', email: 'user@example.com' } as any
      const result = await issueKakaoSupabaseSession(adminClient, serverSupabase, user)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('generate_link_failed')
      }
      expect(mockVerifyOtp).not.toHaveBeenCalled()
    })

    it('verifyOtp 실패 시 verify_otp_failed 에러를 반환한다', async () => {
      mockGenerateLink.mockResolvedValueOnce({
        data: {
          properties: {
            hashed_token: 'hashed_token_xyz',
          },
        },
        error: null,
      })

      mockVerifyOtp.mockResolvedValueOnce({
        data: { session: null },
        error: { message: 'token expired' },
      })

      const user = { id: 'user-1', email: 'user@example.com' } as any
      const result = await issueKakaoSupabaseSession(adminClient, serverSupabase, user)

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('verify_otp_failed')
      }
    })
  })
  it('GoTrue 가 provider 를 email 로 덮어써도 app_metadata.kakao_id 로 기존 카카오 회원을 알아본다', async () => {
    const existing = {
      id: 'kakao-user',
      email: 'kakao_777@kakao.internal',
      app_metadata: { provider: 'email', providers: ['email'], kakao_id: '777' },
      user_metadata: {},
      identities: [],
    }
    const admin = {
      auth: {
        admin: {
          createUser: vi.fn().mockResolvedValue({ data: null, error: { code: 'email_exists', message: 'A user with this email address has already been registered' } }),
          generateLink: vi.fn().mockResolvedValue({ data: { user: existing, properties: {} }, error: null }),
        },
      },
    }
    const result = await resolveKakaoUser(admin, { id: 777 })
    expect(result).toMatchObject({ ok: true, isNew: false })
  })
})

