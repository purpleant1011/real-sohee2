import { describe, it, expect, vi, beforeEach } from 'vitest'
import { persistTextHarness } from '@/features/text-harness/text-harness-server'
import { persistImageHarness } from '@/features/image-harness/image-harness-server'
import type { TextHarnessVersion, TextHarnessRules } from '@/features/text-harness/text-harness-manager'
import type { ImageHarnessVersion, ImageReferenceAsset } from '@/features/image-harness/image-harness-manager'

describe('ANI-1481: Text & Image Harness Durable Persistence Unit Tests', () => {
  const workspaceA = '11111111-1111-4111-8111-111111111111'
  const workspaceB = '22222222-2222-4222-8222-222222222222'
  const userId = '33333333-3333-4333-8333-333333333333'

  const sampleTextRules: TextHarnessRules = {
    toneAndManner: '다정하고 친근한 존댓말',
    targetAudience: '2030 직장인 여성',
    keyPhrases: ['100% 예약제', '시그니처 레이어드컷'],
    prohibitedWords: ['대박 할인', '전국 최저가'],
    positiveExamples: ['오늘도 찾아주셔서 감사합니다.'],
    negativeExamples: ['야 이거 완전 대박이야'],
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('1. persistTextHarness server function contract', () => {
    it('calls activate_harness_rule_version RPC with canonical text family key and returns DB truth', async () => {
      let rpcParams: any = null
      const mockClient = {
        rpc: vi.fn((fnName: string, params: any) => {
          if (fnName === 'activate_harness_rule_version') {
            rpcParams = params
            return {
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'rule-text-db-1',
                  workspace_id: params.p_workspace_id,
                  rule_key: params.p_rule_key,
                  rule_type: params.p_rule_type,
                  version: 1,
                  status: 'active',
                },
                error: null,
              }),
            }
          }
          throw new Error(`Unexpected RPC ${fnName}`)
        }),
      }

      const draft: TextHarnessVersion = {
        id: 'draft-client-1',
        workspaceId: workspaceA,
        versionNumber: 1,
        status: 'ACTIVE_CONFIRMED',
        rules: sampleTextRules,
        testRunsCount: 1,
        createdAt: new Date().toISOString(),
        confirmedAt: new Date().toISOString(),
        confirmedByUserId: userId,
      }

      const result = await persistTextHarness(draft, mockClient as any)

      expect(mockClient.rpc).toHaveBeenCalledTimes(1)
      expect(rpcParams.p_workspace_id).toBe(workspaceA)
      expect(rpcParams.p_rule_key).toBe('text-harness-v1')
      expect(rpcParams.p_rule_type).toBe('text_generation')
      expect(rpcParams.p_created_by_user_id).toBe(userId)
      // Must return DB truth with persisted version and id
      expect(result).toBeDefined()
      expect(result.id).toBe('rule-text-db-1')
      expect(result.version).toBe(1)
      expect(result.status).toBe('active')
      expect(result.rule_key).toBe('text-harness-v1')
    })

    it('reconfirming increments version to v2 without 23505 collision and preserves DB truth', async () => {
      let callCount = 0
      const mockClient = {
        rpc: vi.fn((fnName: string, params: any) => {
          callCount++
          return {
            single: vi.fn().mockResolvedValue({
              data: {
                id: `rule-text-db-${callCount}`,
                workspace_id: params.p_workspace_id,
                rule_key: params.p_rule_key,
                version: callCount, // 1 on first call, 2 on second
                status: 'active',
              },
              error: null,
            }),
          }
        }),
      }

      const draft: TextHarnessVersion = {
        id: 'draft-reconfirm',
        workspaceId: workspaceA,
        versionNumber: 1, // client still says 1
        status: 'ACTIVE_CONFIRMED',
        rules: { ...sampleTextRules, toneAndManner: '재확정 테스트' },
        testRunsCount: 2,
        createdAt: new Date().toISOString(),
      }

      const firstResult = await persistTextHarness(draft, mockClient as any)
      expect(firstResult.version).toBe(1)

      const secondResult = await persistTextHarness(draft, mockClient as any)
      expect(secondResult.version).toBe(2)
      expect(secondResult.id).toBe('rule-text-db-2')
    })

    it('throws human-safe error when RPC fails and does not expose secrets', async () => {
      const mockClient = {
        rpc: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: 'P0001', message: 'transaction deadlock' },
          }),
        }),
      }

      const draft: TextHarnessVersion = {
        id: 'draft-fail',
        workspaceId: workspaceA,
        versionNumber: 1,
        status: 'ACTIVE_CONFIRMED',
        rules: sampleTextRules,
        testRunsCount: 1,
        createdAt: new Date().toISOString(),
      }

      await expect(persistTextHarness(draft, mockClient as any)).rejects.toThrowError(
        /텍스트 하네스 영속화 실패/
      )
    })
  })

  describe('2. persistImageHarness server function contract', () => {
    const validGoldenAssets: ImageReferenceAsset[] = [
      {
        id: 'gold-1',
        workspaceId: workspaceA,
        storagePath: 'workspaces/ws/gold-1.jpg',
        publicUrl: 'https://cdn.example.com/gold-1.jpg',
        category: 'STORE_EXTERIOR',
        rightsStatus: 'OWNED',
        consentStatus: 'NOT_APPLICABLE',
        rightsConfirmedAt: new Date().toISOString(),
        mimeType: 'image/jpeg',
        sortOrder: 1,
        isGolden: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'gold-2',
        workspaceId: workspaceA,
        storagePath: 'workspaces/ws/gold-2.jpg',
        publicUrl: 'https://cdn.example.com/gold-2.jpg',
        category: 'SIGNATURE_MENU',
        rightsStatus: 'LICENSED',
        consentStatus: 'NOT_APPLICABLE',
        rightsConfirmedAt: new Date().toISOString(),
        mimeType: 'image/jpeg',
        sortOrder: 2,
        isGolden: true,
        createdAt: new Date().toISOString(),
      },
      {
        id: 'gold-3',
        workspaceId: workspaceA,
        storagePath: 'workspaces/ws/gold-3.jpg',
        publicUrl: 'https://cdn.example.com/gold-3.jpg',
        category: 'ATMOSPHERE',
        rightsStatus: 'USER_CONFIRMED',
        consentStatus: 'CONFIRMED',
        rightsConfirmedAt: new Date().toISOString(),
        mimeType: 'image/jpeg',
        sortOrder: 3,
        isGolden: true,
        createdAt: new Date().toISOString(),
      },
    ]

    it('persists canonical golden assets evidence along with visual rules', async () => {
      let rpcParams: any = null
      const mockClient = {
        rpc: vi.fn((fnName: string, params: any) => {
          if (fnName === 'activate_harness_rule_version') {
            rpcParams = params
            return {
              single: vi.fn().mockResolvedValue({
                data: {
                  id: 'rule-img-db-1',
                  workspace_id: params.p_workspace_id,
                  rule_key: params.p_rule_key,
                  version: 1,
                  status: 'active',
                },
                error: null,
              }),
            }
          }
          throw new Error(`Unexpected RPC ${fnName}`)
        }),
      }

      const version: ImageHarnessVersion = {
        id: 'img-v1-client',
        workspaceId: workspaceA,
        versionNumber: 1,
        status: 'ACTIVE_CONFIRMED',
        rules: {
          modelStyle: '정갈한 베이커리 톤',
          environment: '자연 채광',
        },
        referenceAssets: validGoldenAssets,
        goldenImageIds: ['gold-1', 'gold-2', 'gold-3'],
        testRunsCount: 1,
        createdAt: new Date().toISOString(),
        confirmedAt: new Date().toISOString(),
        confirmedByUserId: userId,
        provenance: 'USER_SUBMITTED',
      }

      const result = await persistImageHarness(version, mockClient as any)

      expect(mockClient.rpc).toHaveBeenCalledTimes(1)
      expect(rpcParams.p_workspace_id).toBe(workspaceA)
      expect(rpcParams.p_rule_key).toBe('image-harness-v1')
      expect(rpcParams.p_rule_type).toBe('image_generation')

      // Check durable payload
      const payload = rpcParams.p_structured_rule
      expect(payload).toBeDefined()
      expect(payload.goldenImageIds).toEqual(['gold-1', 'gold-2', 'gold-3'])
      expect(payload.rules.modelStyle).toBe('정갈한 베이커리 톤')
      expect(payload.goldenAssets).toBeDefined()
      expect(payload.goldenAssets.length).toBe(3)
      expect(payload.goldenAssets[0].id).toBe('gold-1')
      expect(payload.goldenAssets[0].rightsStatus).toBe('OWNED')
      expect(payload.goldenAssets[0].consentStatus).toBe('NOT_APPLICABLE')
      expect(payload.goldenAssets[2].rightsStatus).toBe('USER_CONFIRMED')
      expect(payload.goldenAssets[2].consentStatus).toBe('CONFIRMED')

      // Check returned DB truth
      expect(result).toBeDefined()
      expect(result.id).toBe('rule-img-db-1')
      expect(result.version).toBe(1)
    })
  })

  describe('3. Unrelated family preservation and tenant isolation contract', () => {
    it('does not touch or retire other rule_keys in the same workspace (e.g. byreum channel rules)', async () => {
      // In-memory simulation of the RPC contract
      const dbHarnessRules: any[] = [
        {
          id: 'byreum-ig-1',
          workspace_id: workspaceA,
          rule_key: 'byreum-instagram-text-v1',
          rule_type: 'text_generation',
          version: 1,
          status: 'active',
        },
        {
          id: 'byreum-th-1',
          workspace_id: workspaceA,
          rule_key: 'byreum-threads-text-v1',
          rule_type: 'text_generation',
          version: 1,
          status: 'active',
        },
        {
          id: 'byreum-blog-1',
          workspace_id: workspaceA,
          rule_key: 'byreum-naver-blog-text-v1',
          rule_type: 'text_generation',
          version: 1,
          status: 'active',
        },
        {
          id: 'text-onboard-1',
          workspace_id: workspaceA,
          rule_key: 'text-harness-v1',
          rule_type: 'text_generation',
          version: 1,
          status: 'active',
        },
      ]

      const mockClient = {
        rpc: vi.fn((fnName: string, params: any) => {
          if (fnName === 'activate_harness_rule_version') {
            // Lock and retire ONLY matching workspace_id AND matching rule_key
            for (const r of dbHarnessRules) {
              if (r.workspace_id === params.p_workspace_id && r.rule_key === params.p_rule_key && r.status === 'active') {
                r.status = 'retired'
              }
            }
            const nextVersion = Math.max(
              0,
              ...dbHarnessRules
                .filter(r => r.workspace_id === params.p_workspace_id && r.rule_key === params.p_rule_key)
                .map(r => r.version)
            ) + 1

            const newRow = {
              id: `text-onboard-${nextVersion}`,
              workspace_id: params.p_workspace_id,
              rule_key: params.p_rule_key,
              rule_type: params.p_rule_type,
              version: nextVersion,
              status: 'active',
            }
            dbHarnessRules.push(newRow)
            return {
              single: vi.fn().mockResolvedValue({ data: newRow, error: null }),
            }
          }
          throw new Error(`Unexpected RPC ${fnName}`)
        }),
      }

      const draft: TextHarnessVersion = {
        id: 'draft-reconfirm-family',
        workspaceId: workspaceA,
        versionNumber: 1,
        status: 'ACTIVE_CONFIRMED',
        rules: { ...sampleTextRules, toneAndManner: '새 기준' },
        testRunsCount: 1,
        createdAt: new Date().toISOString(),
      }

      const res = await persistTextHarness(draft, mockClient as any)
      expect(res.version).toBe(2)

      // Byreum channel rules must REMAIN ACTIVE!
      const byreumIg = dbHarnessRules.find(r => r.rule_key === 'byreum-instagram-text-v1')
      const byreumTh = dbHarnessRules.find(r => r.rule_key === 'byreum-threads-text-v1')
      const byreumBlog = dbHarnessRules.find(r => r.rule_key === 'byreum-naver-blog-text-v1')
      expect(byreumIg?.status).toBe('active')
      expect(byreumTh?.status).toBe('active')
      expect(byreumBlog?.status).toBe('active')

      // Old text-harness-v1 is retired, new one is active
      const oldOnboard = dbHarnessRules.find(r => r.id === 'text-onboard-1')
      const newOnboard = dbHarnessRules.find(r => r.id === 'text-onboard-2')
      expect(oldOnboard?.status).toBe('retired')
      expect(newOnboard?.status).toBe('active')
    })

    it('isolates sequence and state between workspace A and workspace B', async () => {
      const dbHarnessRules: any[] = [
        {
          id: 'ws-b-v1',
          workspace_id: workspaceB,
          rule_key: 'text-harness-v1',
          rule_type: 'text_generation',
          version: 5,
          status: 'active',
        },
      ]

      const mockClient = {
        rpc: vi.fn((fnName: string, params: any) => {
          const nextVersion = Math.max(
            0,
            ...dbHarnessRules
              .filter(r => r.workspace_id === params.p_workspace_id && r.rule_key === params.p_rule_key)
              .map(r => r.version)
          ) + 1

          const newRow = {
            id: `rule-${params.p_workspace_id}-${nextVersion}`,
            workspace_id: params.p_workspace_id,
            rule_key: params.p_rule_key,
            rule_type: params.p_rule_type,
            version: nextVersion,
            status: 'active',
          }
          dbHarnessRules.push(newRow)
          return {
            single: vi.fn().mockResolvedValue({ data: newRow, error: null }),
          }
        }),
      }

      const draftA: TextHarnessVersion = {
        id: 'draft-a',
        workspaceId: workspaceA,
        versionNumber: 1,
        status: 'ACTIVE_CONFIRMED',
        rules: sampleTextRules,
        testRunsCount: 1,
        createdAt: new Date().toISOString(),
      }

      // Workspace A has 0 rows, so it must start at v1 despite Workspace B having v5
      const resA = await persistTextHarness(draftA, mockClient as any)
      expect(resA.version).toBe(1)
      expect(resA.workspace_id).toBe(workspaceA)

      // Workspace B row is still v5 and active
      const wsB = dbHarnessRules.find(r => r.workspace_id === workspaceB)
      expect(wsB?.version).toBe(5)
      expect(wsB?.status).toBe('active')
    })
  })

  describe('4. Text runtime reuse with ContextAssembler after persistence', () => {
    it('loads newly persisted active text harness into ContextAssembler rules and system prompt', async () => {
      const { ContextAssembler } = await import('@/lib/agent/context-assembler')

      const mockSupabase = {
        from: vi.fn((table: string) => {
          if (table === 'business_profiles') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { business_name: '바이름 헤어' }, error: null }),
                }),
              }),
            }
          }
          if (table === 'brand_profiles') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
                }),
              }),
            }
          }
          if (table === 'knowledge_facts') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({ data: [], error: null }),
                }),
              }),
            }
          }
          if (table === 'harness_rules') {
            return {
              select: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  eq: vi.fn().mockResolvedValue({
                    data: [
                      {
                        id: 'rule-text-v2-uuid',
                        rule_key: 'text-harness-v1',
                        rule_type: 'text_generation',
                        title: '텍스트 하네스 v2',
                        description: '소상공인 텍스트 톤앤매너 기준',
                        structured_rule: { toneAndManner: '다정하고 친근한 존댓말' },
                        version: 2,
                        status: 'active',
                      },
                    ],
                    error: null,
                  }),
                }),
              }),
            }
          }
          throw new Error(`Unexpected table ${table}`)
        }),
      }

      const context = await ContextAssembler.assembleContext({
        workspaceId: workspaceA,
        datasetMode: 'TEST',
        client: mockSupabase as any,
      })

      expect(context.workspaceId).toBe(workspaceA)
      expect(context.rules.length).toBe(1)
      expect(context.rules[0].ruleKey).toBe('text-harness-v1')
      expect(context.rules[0].version).toBe(2)
      expect(context.rules[0].title).toBe('텍스트 하네스 v2')
      expect(context.systemPromptContext).toContain('텍스트 하네스 v2')
      expect(context.systemPromptContext).toContain('[text_generation]')
    })
  })
})
