import { describe, expect, it, vi } from 'vitest'
import {
  createCustomFact,
  expireFact,
  listWorkspaceFacts,
  updateFactContent,
} from '../facts-service'

const WS_ID = 'ws-test-1111-2222-3333-444455556666'
const USER_ID = 'usr-test-1111-2222-3333-444455556666'

describe('facts-service', () => {
  describe('listWorkspaceFacts', () => {
    it('active 상태 팩트들을 조회하고 source_location에 따라 올바른 source를 분류한다', async () => {
      const mockFacts = [
        {
          id: 'fact-1',
          category: 'MENU',
          content: '시그니처 라떼 5,000원',
          created_at: '2026-10-15T10:00:00Z',
          source_candidate_id: 'cand-1',
          knowledge_candidates: {
            source_location: 'interview:q1',
          },
        },
        {
          id: 'fact-2',
          category: 'HOURS',
          content: '영업시간 매일 10:00-22:00',
          created_at: '2026-10-15T09:00:00Z',
          source_candidate_id: 'cand-2',
          knowledge_candidates: {
            source_location: 'file:menu_info.pdf',
          },
        },
        {
          id: 'fact-3',
          category: 'MANUAL',
          content: '화장실 비밀번호 1234*',
          created_at: '2026-10-15T08:00:00Z',
          source_candidate_id: 'cand-3',
          knowledge_candidates: {
            source_location: 'manual',
          },
        },
      ]

      const mockCandidates = [
        { id: 'cand-1', source_location: 'interview:q_menu' },
        { id: 'cand-2', source_location: 'file:menu_info.pdf' },
        { id: 'cand-3', source_location: 'manual' },
      ]

      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'knowledge_facts') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({
                data: mockFacts,
                error: null,
              }),
            }
          }
          if (table === 'knowledge_candidates') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              in: vi.fn().mockResolvedValue({
                data: mockCandidates,
                error: null,
              }),
            }
          }
          return {}
        }),
      }

      const result = await listWorkspaceFacts(WS_ID, mockClient as any)

      expect(result).toHaveLength(3)
      expect(result[0]).toEqual({
        id: 'fact-1',
        category: 'MENU',
        content: '시그니처 라떼 5,000원',
        createdAt: '2026-10-15T10:00:00Z',
        source: 'interview',
      })
      expect(result[1].source).toBe('file')
      expect(result[2].source).toBe('manual')
    })

    it('쿼리 실패 시 에러를 throw한다', async () => {
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Database connection failed' },
          }),
        }),
      }

      await expect(listWorkspaceFacts(WS_ID, mockClient as any)).rejects.toThrow(
        'Database connection failed',
      )
    })

    describe('production 기본 RPC 경로 및 fallback 보안 검증', () => {
      it('RPC get_approved_learning_context 성공 시 items=[]이면 table 접근 없이 즉시 []를 반환한다', async () => {
        const mockClient = {
          rpc: vi.fn().mockResolvedValue({
            data: { items: [] },
            error: null,
          }),
          from: vi.fn(),
        }

        const result = await listWorkspaceFacts(WS_ID, mockClient as any)

        expect(result).toEqual([])
        expect(mockClient.rpc).toHaveBeenCalledWith('get_approved_learning_context', {
          p_workspace_id: WS_ID,
          p_purpose: 'conversation',
          p_max_facts: 200,
          p_query: '',
        })
        expect(mockClient.from).not.toHaveBeenCalled()
      })

      it('RPC 결과가 배열 직렬화 형태([])로 올 때도 table 접근 없이 즉시 []를 반환한다', async () => {
        const mockClient = {
          rpc: vi.fn().mockResolvedValue({
            data: [],
            error: null,
          }),
          from: vi.fn(),
        }

        const result = await listWorkspaceFacts(WS_ID, mockClient as any)

        expect(result).toEqual([])
        expect(mockClient.from).not.toHaveBeenCalled()
      })

      it('RPC 정상 성공 시 승인된 지식(manual/file/channel)을 올바르게 포함한다', async () => {
        const originalEnv = process.env.SOHEE_CHANNEL_LEARNING_ENABLED
        process.env.SOHEE_CHANNEL_LEARNING_ENABLED = '1'
        try {
          const mockItems = [
            {
              id: 'fact-m',
              category: 'HOURS',
              content: '매일 10시-22시',
              source_type: 'manual',
              created_at: '2026-11-10T00:00:00Z',
            },
            {
              id: 'fact-f',
              category: 'MENU',
              content: '라떼 5000원',
              source_type: 'file',
              created_at: '2026-11-10T01:00:00Z',
            },
            {
              id: 'fact-c',
              category: 'PROMOTION',
              content: '인스타 이벤트 진행중',
              source_type: 'channel',
              created_at: '2026-11-10T02:00:00Z',
            },
          ]

          const mockClient = {
            rpc: vi.fn().mockResolvedValue({
              data: { items: mockItems },
              error: null,
            }),
            from: vi.fn(),
          }

          const result = await listWorkspaceFacts(WS_ID, mockClient as any)

          expect(result).toHaveLength(3)
          expect(result[0]).toEqual({
            id: 'fact-m',
            category: 'HOURS',
            content: '매일 10시-22시',
            createdAt: '2026-11-10T00:00:00Z',
            source: 'manual',
          })
          expect(result[1].source).toBe('file')
          expect(result[2].source).toBe('channel')
          expect(mockClient.from).not.toHaveBeenCalled()
        } finally {
          process.env.SOHEE_CHANNEL_LEARNING_ENABLED = originalEnv
        }
      })

      it('RPC 오류 시 fallback에서 revoked SNS 지식이 되살아나지 않고(fail-closed), 수동/file 지식은 보존된다', async () => {
        const originalEnv = process.env.SOHEE_CHANNEL_LEARNING_ENABLED
        process.env.SOHEE_CHANNEL_LEARNING_ENABLED = '1'
        try {
          const mockFacts = [
            {
              id: 'fact-manual',
              category: 'HOURS',
              content: '수동 영업시간',
              created_at: '2026-11-10T00:00:00Z',
              source_candidate_id: 'cand-manual',
            },
            {
              id: 'fact-file',
              category: 'MENU',
              content: '파일 메뉴',
              created_at: '2026-11-10T01:00:00Z',
              source_candidate_id: 'cand-file',
            },
            {
              id: 'fact-revoked-sns',
              category: 'PROMOTION',
              content: '철회된 인스타 지식',
              created_at: '2026-11-10T02:00:00Z',
              source_candidate_id: 'cand-sns',
            },
          ]

          const mockCandidates = [
            { id: 'cand-manual', source_location: 'manual' },
            { id: 'cand-file', source_location: 'file:menu.pdf' },
            { id: 'cand-sns', source_location: 'channel:instagram:post_1' },
          ]

          const mockClient = {
            rpc: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'RPC_UNAVAILABLE' },
            }),
            from: vi.fn().mockImplementation((table: string) => {
              if (table === 'knowledge_facts') {
                return {
                  select: vi.fn().mockReturnThis(),
                  eq: vi.fn().mockReturnThis(),
                  order: vi.fn().mockReturnThis(),
                  limit: vi.fn().mockResolvedValue({
                    data: mockFacts,
                    error: null,
                  }),
                }
              }
              if (table === 'knowledge_candidates') {
                return {
                  select: vi.fn().mockReturnThis(),
                  eq: vi.fn().mockReturnThis(),
                  in: vi.fn().mockResolvedValue({
                    data: mockCandidates,
                    error: null,
                  }),
                }
              }
              return {}
            }),
          }

          const result = await listWorkspaceFacts(WS_ID, mockClient as any)

          // 수동 및 파일 지식은 보존
          const ids = result.map((r) => r.id)
          expect(ids).toContain('fact-manual')
          expect(ids).toContain('fact-file')
          // 오류 fallback 시 권위 있는 RPC 검증이 없으므로 revoked SNS 지식은 절대 되살아나지 않아야 함 (fail-closed)
          expect(ids).not.toContain('fact-revoked-sns')
          expect(result.find((r) => (r.source as string) === 'channel')).toBeUndefined()
        } finally {
          process.env.SOHEE_CHANNEL_LEARNING_ENABLED = originalEnv
        }
      })

      it('fallback 시 source_location이 누락/불확실한 채널 후보(evidence_document_id 등)는 manual로 우회되지 않고 fail-closed된다', async () => {
        const originalEnv = process.env.SOHEE_CHANNEL_LEARNING_ENABLED
        process.env.SOHEE_CHANNEL_LEARNING_ENABLED = '1'
        try {
          const mockFacts = [
            {
              id: 'fact-manual',
              category: 'HOURS',
              content: '정상 수동 지식',
              created_at: '2026-11-10T00:00:00Z',
              source_candidate_id: 'cand-manual',
            },
            {
              id: 'fact-channel-no-loc',
              category: 'INFO',
              content: 'source_location 없는 채널 학습 지식',
              created_at: '2026-11-10T03:00:00Z',
              source_candidate_id: 'cand-channel-no-loc',
            },
          ]

          // 채널 학습 후보는 source_location이 null이고 evidence_document_id가 설정됨
          const mockCandidates = [
            { id: 'cand-manual', source_location: 'manual', evidence_document_id: null },
            { id: 'cand-channel-no-loc', source_location: null, evidence_document_id: 'doc-1234' },
          ]

          const mockClient = {
            rpc: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'RPC_ERROR' },
            }),
            from: vi.fn().mockImplementation((table: string) => {
              if (table === 'knowledge_facts') {
                return {
                  select: vi.fn().mockReturnThis(),
                  eq: vi.fn().mockReturnThis(),
                  order: vi.fn().mockReturnThis(),
                  limit: vi.fn().mockResolvedValue({
                    data: mockFacts,
                    error: null,
                  }),
                }
              }
              if (table === 'knowledge_candidates') {
                return {
                  select: vi.fn().mockReturnThis(),
                  eq: vi.fn().mockReturnThis(),
                  in: vi.fn().mockResolvedValue({
                    data: mockCandidates,
                    error: null,
                  }),
                }
              }
              return {}
            }),
          }

          const result = await listWorkspaceFacts(WS_ID, mockClient as any)

          const ids = result.map((r) => r.id)
          expect(ids).toContain('fact-manual')
          // evidence_document_id가 있는 채널 학습 후보가 manual로 우회 승격되지 않고 fail-closed 되어야 함
          expect(ids).not.toContain('fact-channel-no-loc')
        } finally {
          process.env.SOHEE_CHANNEL_LEARNING_ENABLED = originalEnv
        }
      })

      it('(A) fallback 시 후보 쿼리 오류/행 누락으로 메타를 얻지 못한 팩트는 불확실로 제외(fail-closed)된다', async () => {
        const mockFacts = [
          {
            id: 'fact-orphan-candidate',
            category: 'INFO',
            content: '후보 메타를 잃어버린 불확실한 팩트 (채널일 위험)',
            created_at: '2026-11-10T00:00:00Z',
            source_candidate_id: 'cand-missing',
          },
          {
            id: 'fact-legacy-pure-manual',
            category: 'HOURS',
            content: 'candidate_id 자체가 없는 순수 레거시 수동 팩트',
            created_at: '2026-11-10T01:00:00Z',
            source_candidate_id: null,
          },
        ]

        const mockClient = {
          rpc: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'RPC_UNAVAILABLE' },
          }),
          from: vi.fn().mockImplementation((table: string) => {
            if (table === 'knowledge_facts') {
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue({
                  data: mockFacts,
                  error: null,
                }),
              }
            }
            if (table === 'knowledge_candidates') {
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                in: vi.fn().mockResolvedValue({
                  data: [], // 후보 행 누락 또는 쿼리 빈 결과
                  error: null,
                }),
              }
            }
            return {}
          }),
        }

        const result = await listWorkspaceFacts(WS_ID, mockClient as any)

        const ids = result.map((r) => r.id)
        // 후보 메타를 얻지 못한 불확실 팩트는 채널 우회 방지를 위해 fail-closed
        expect(ids).not.toContain('fact-orphan-candidate')
        // candidate_id 자체가 없는 순수 레거시 수동 팩트는 보존
        expect(ids).toContain('fact-legacy-pure-manual')
      })

      it('(B) fallback 시 v08 온보딩 후보(source_location=null, evidence_document_id=null)는 manual로 정상 보존된다', async () => {
        const mockFacts = [
          {
            id: 'fact-onboarding',
            category: 'BUSINESS_ITEM',
            content: '디저트 카페',
            created_at: '2026-11-10T00:00:00Z',
            source_candidate_id: 'cand-onboarding-1',
          },
        ]

        // v08 온보딩 스키마 기준: source_location=null, evidence_document_id=null
        const mockCandidates = [
          {
            id: 'cand-onboarding-1',
            source_location: null,
            evidence_document_id: null,
          },
        ]

        const mockClient = {
          rpc: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'RPC_ERROR' },
          }),
          from: vi.fn().mockImplementation((table: string) => {
            if (table === 'knowledge_facts') {
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                order: vi.fn().mockReturnThis(),
                limit: vi.fn().mockResolvedValue({
                  data: mockFacts,
                  error: null,
                }),
              }
            }
            if (table === 'knowledge_candidates') {
              return {
                select: vi.fn().mockReturnThis(),
                eq: vi.fn().mockReturnThis(),
                in: vi.fn().mockResolvedValue({
                  data: mockCandidates,
                  error: null,
                }),
              }
            }
            return {}
          }),
        }

        const result = await listWorkspaceFacts(WS_ID, mockClient as any)

        expect(result).toHaveLength(1)
        expect(result[0]).toEqual({
          id: 'fact-onboarding',
          category: 'BUSINESS_ITEM',
          content: '디저트 카페',
          createdAt: '2026-11-10T00:00:00Z',
          source: 'manual',
        })
      })

      it('(C) RPC 경로에서 source_type=manual로 온 항목의 file/interview 라벨을 복원한다', async () => {
        const mockItems = [
          {
            id: 'fact-interview',
            category: 'HOURS',
            content: '영업시간 인터뷰 답변',
            source_type: 'manual', // SQL RPC는 source_type을 'manual'로만 반환
            source_location: 'interview:q_hours',
            created_at: '2026-11-10T00:00:00Z',
          },
          {
            id: 'fact-file',
            category: 'MENU',
            content: '메뉴 파일 추출',
            source_type: 'manual',
            source_location: 'file:menu.pdf',
            created_at: '2026-11-10T01:00:00Z',
          },
          {
            id: 'fact-pure-manual',
            category: 'POLICY',
            content: '직접 적은 정책',
            source_type: 'manual',
            created_at: '2026-11-10T02:00:00Z',
          },
        ]

        const mockClient = {
          rpc: vi.fn().mockResolvedValue({
            data: { items: mockItems },
            error: null,
          }),
          from: vi.fn(),
        }

        const result = await listWorkspaceFacts(WS_ID, mockClient as any)

        expect(result).toHaveLength(3)
        expect(result.find((r) => r.id === 'fact-interview')?.source).toBe('interview')
        expect(result.find((r) => r.id === 'fact-file')?.source).toBe('file')
        expect(result.find((r) => r.id === 'fact-pure-manual')?.source).toBe('manual')
      })
    })
  })

  describe('createCustomFact', () => {
    it('신규 소스 생성 및 candidate, fact 레코드를 active 상태로 등록한다', async () => {
      let sourceChecked = false
      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'knowledge_sources') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockImplementation(() => {
                sourceChecked = true
                return Promise.resolve({ data: null, error: null })
              }),
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { id: 'src-manual-1' },
                    error: null,
                  }),
                }),
              }),
            }
          }
          if (table === 'knowledge_candidates') {
            return {
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { id: 'cand-manual-1' },
                    error: null,
                  }),
                }),
              }),
            }
          }
          if (table === 'knowledge_facts') {
            return {
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: 'fact-new-1',
                      category: 'DIFFERENTIATOR',
                      content: '디카페인 원두 변경 무료',
                      created_at: '2026-10-15T11:00:00Z',
                      status: 'active',
                    },
                    error: null,
                  }),
                }),
              }),
            }
          }
          return {}
        }),
      }

      const result = await createCustomFact(
        {
          workspaceId: WS_ID,
          userId: USER_ID,
          category: 'DIFFERENTIATOR',
          content: '디카페인 원두 변경 무료',
        },
        mockClient as any,
      )

      expect(sourceChecked).toBe(true)
      expect(result).toEqual({
        id: 'fact-new-1',
        category: 'DIFFERENTIATOR',
        content: '디카페인 원두 변경 무료',
        createdAt: '2026-10-15T11:00:00Z',
        source: 'manual',
      })
    })
  })

  describe('updateFactContent', () => {
    it('기존 fact를 superseded 처리하고 새로운 fact를 active 상태로 등록한다', async () => {
      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'knowledge_facts') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  id: 'fact-old-1',
                  workspace_id: WS_ID,
                  category: 'HOURS',
                  content: '매일 10:00-22:00',
                  source_candidate_id: 'cand-old-1',
                  status: 'active',
                  knowledge_candidates: {
                    knowledge_source_id: 'src-1',
                    source_location: 'interview:q2',
                  },
                },
                error: null,
              }),
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnThis(),
              }),
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: {
                      id: 'fact-superseded-new-1',
                      category: 'HOURS',
                      content: '매일 11:00-23:00',
                      created_at: '2026-10-15T12:00:00Z',
                    },
                    error: null,
                  }),
                }),
              }),
            }
          }
          if (table === 'knowledge_candidates') {
            return {
              insert: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { id: 'cand-new-2' },
                    error: null,
                  }),
                }),
              }),
            }
          }
          return {}
        }),
      }

      const result = await updateFactContent(
        {
          workspaceId: WS_ID,
          userId: USER_ID,
          factId: 'fact-old-1',
          content: '매일 11:00-23:00',
        },
        mockClient as any,
      )

      expect(result).toEqual({
        id: 'fact-superseded-new-1',
        category: 'HOURS',
        content: '매일 11:00-23:00',
        createdAt: '2026-10-15T12:00:00Z',
        source: 'interview',
      })
    })

    it('존재하지 않는 factId 수정 시 에러를 던진다', async () => {
      const mockClient = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: null,
          }),
        }),
      }

      await expect(
        updateFactContent(
          {
            workspaceId: WS_ID,
            userId: USER_ID,
            factId: 'not-found-id',
            content: '내용 변경',
          },
          mockClient as any,
        ),
      ).rejects.toThrow('Fact not found')
    })
  })

  describe('expireFact', () => {
    it('대상 fact의 상태를 expired로 변경한다', async () => {
      const mockClient = {
        from: vi.fn().mockImplementation((table: string) => {
          if (table === 'knowledge_facts') {
            return {
              update: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({
                    data: null,
                    error: null,
                  }),
                }),
              }),
            }
          }
          return {}
        }),
      }

      const res = await expireFact(
        {
          workspaceId: WS_ID,
          userId: USER_ID,
          factId: 'fact-to-delete',
        },
        mockClient as any,
      )

      expect(res).toEqual({ success: true })
    })
  })
})
