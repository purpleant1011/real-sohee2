import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  UnifiedMissionAuditWriter,
  redactSensitiveData,
} from '../unified-mission-audit-writer'

describe('Unified Mission Audit Writer & PII/Secret Redaction (ANI-1197, ANI-1224)', () => {
  const workspaceId = '00000000-0000-4000-8000-0000000000a2'
  const missionId = 'msn-byreum-audit-001'
  const traceId = 'trc-audit-test-001'

  let mockAuditEventsDb: any[] = []

  const mockSupabaseClient = {
    from: (table: string) => {
      if (table === 'audit_events') {
        return {
          insert: vi.fn().mockImplementation((row: any) => {
            mockAuditEventsDb.push(row)
            return {
              select: () => ({
                single: async () => ({ data: row, error: null }),
              }),
            }
          }),
          select: vi.fn().mockImplementation(() => {
            const filters: Array<{ col: string; val: any }> = []
            const chain = {
              eq: (col: string, val: any) => {
                filters.push({ col, val })
                return chain
              },
              order: () => chain,
              limit: () => ({
                then: (cb: any) => {
                  const filtered = mockAuditEventsDb.filter(r =>
                    filters.every(f => r[f.col] === f.val)
                  )
                  return cb({ data: filtered, error: null })
                },
              }),
            }
            return chain
          }),
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  } as any

  beforeEach(() => {
    mockAuditEventsDb = []
  })

  describe('1. PII and Secret Redaction Engine', () => {
    it('MUST redact OpenAI/Gemini/Meta API keys and Bearer tokens', () => {
      const raw = {
        apiKey: 'sk-proj-test-dummy-abc1234567890abcdef',
        geminiKey: 'AIzaSyD-1234567890abcdef1234567890',
        metaToken: 'EAAQW1234567890abcdef1234567890',
        authHeader: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0',
      }

      const redacted = redactSensitiveData(raw)

      expect(redacted.apiKey).toBe('[REDACTED_API_KEY]')
      expect(redacted.geminiKey).toBe('[REDACTED_API_KEY]')
      expect(redacted.metaToken).toBe('[REDACTED_TOKEN]')
      expect(redacted.authHeader).toBe('Bearer [REDACTED_TOKEN]')
    })

    it('MUST redact Korean phone numbers and personal emails', () => {
      const raw = {
        customer: {
          name: '김서연',
          phone: '010-9999-8888',
          phoneAlt: '01012345678',
          email: 'customer@gmail.com',
        },
      }

      const redacted = redactSensitiveData(raw)

      expect(redacted.customer.phone).toBe('010-****-8888')
      expect(redacted.customer.phoneAlt).toBe('010-****-5678')
      expect(redacted.customer.email).toBe('c***r@gmail.com')
      expect(redacted.customer.name).toBe('김서연') // preserve display name
    })

    it('MUST deeply traverse nested arrays and objects without mutating original input', () => {
      const original = {
        items: [
          { secret: 'sk-1234567890abcdef', phone: '010-1111-2222' },
          { token: 'Bearer topsecrettokenhere' },
        ],
      }

      const copy = JSON.parse(JSON.stringify(original))
      const redacted = redactSensitiveData(original)

      // Original should NOT be mutated
      expect(original).toEqual(copy)
      // Redacted must mask values
      expect(redacted.items[0].secret).toBe('[REDACTED_API_KEY]')
      expect(redacted.items[0].phone).toBe('010-****-2222')
      expect(redacted.items[1].token).toBe('Bearer [REDACTED_TOKEN]')
    })
  })

  describe('2. Unified Mission Audit Writer Invariants', () => {
    it('MUST record append-only audit event with strict metadata, evidence refs, and redacted payload', async () => {
      const writer = new UnifiedMissionAuditWriter(mockSupabaseClient)

      await writer.writeAuditEvent({
        workspaceId,
        actorType: 'agent',
        actorId: '00000000-0000-4000-a000-000000000001',
        eventType: 'MISSION_NEXT_ACTION_PROPOSED',
        entityType: 'marketing_mission',
        entityId: '00000000-0000-4000-a000-000000000002',
        missionId,
        traceId,
        target: 'instagram_post',
        result: 'SUCCESS',
        evidenceRefs: ['post:18029384729102938', 'booking:bk_123'],
        details: {
          suggestedText: '자연눈썹 주말 슬롯 마감 임박!',
          customerPhone: '010-5555-6666',
          secretKey: 'sk-secret-token-value',
        },
      })

      expect(mockAuditEventsDb.length).toBe(1)
      const recorded = mockAuditEventsDb[0]

      expect(recorded.workspace_id).toBe(workspaceId)
      expect(recorded.event_type).toBe('MISSION_NEXT_ACTION_PROPOSED')
      expect(recorded.entity_type).toBe('marketing_mission')
      expect(recorded.metadata.actor_type).toBe('agent')
      expect(recorded.metadata.mission_id).toBe(missionId)
      expect(recorded.metadata.trace_id).toBe(traceId)
      expect(recorded.metadata.result).toBe('SUCCESS')
      expect(recorded.metadata.evidence_refs).toEqual(['post:18029384729102938', 'booking:bk_123'])

      // Ensure PII & Secret in details were redacted before writing
      expect(recorded.metadata.details.customerPhone).toBe('010-****-6666')
      expect(recorded.metadata.details.secretKey).toBe('[REDACTED_API_KEY]')
    })

    it('MUST export evidence bundle for a mission with all chronological audit records', async () => {
      const writer = new UnifiedMissionAuditWriter(mockSupabaseClient)

      // Add two sequential events
      await writer.writeAuditEvent({
        workspaceId,
        actorType: 'user',
        eventType: 'MISSION_CREATED',
        entityType: 'marketing_mission',
        missionId,
        traceId,
        result: 'SUCCESS',
        evidenceRefs: ['msg:msg_001'],
      })

      await writer.writeAuditEvent({
        workspaceId,
        actorType: 'provider',
        eventType: 'PROVIDER_POST_PUBLISHED',
        entityType: 'content_version',
        missionId,
        traceId,
        result: 'SUCCESS',
        evidenceRefs: ['post:18029384729102938'],
      })

      const bundle = await writer.exportEvidenceBundle(workspaceId, missionId)

      expect(bundle.workspaceId).toBe(workspaceId)
      expect(bundle.missionId).toBe(missionId)
      expect(bundle.eventsCount).toBe(2)
      expect(bundle.events[0].event_type).toBe('MISSION_CREATED')
      expect(bundle.events[1].event_type).toBe('PROVIDER_POST_PUBLISHED')
      expect(bundle.allEvidenceRefs).toContain('msg:msg_001')
      expect(bundle.allEvidenceRefs).toContain('post:18029384729102938')
    })
  })
})
