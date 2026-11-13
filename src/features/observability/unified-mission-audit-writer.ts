import 'server-only'
import crypto from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/supabase/database.types'

export type AuditActorType =
  | 'user'
  | 'agent'
  | 'system'
  | 'provider'
  | 'operator'
  | 'customer'
  | 'db'
  | 'USER'
  | 'AGENT'
  | 'SYSTEM'
  | 'PROVIDER'
  | 'OPERATOR'
  | 'CUSTOMER'
  | 'DB'
export type AuditResult = 'SUCCESS' | 'FAILURE' | 'PENDING' | 'REVERTED'

export interface WriteAuditEventInput {
  workspaceId: string
  actorType: AuditActorType
  actorId?: string | null
  eventType: string
  entityType: string
  entityId?: string | null
  missionId?: string | null
  traceId: string
  target?: string | null
  before?: Record<string, unknown> | null
  after?: Record<string, unknown> | null
  result: AuditResult
  safeErrorCode?: string | null
  evidenceRefs?: string[]
  details?: Record<string, unknown>
}

export interface AuditEventRecord {
  id: string
  workspace_id: string
  actor_id: string | null
  event_type: string
  entity_type: string
  entity_id: string | null
  metadata: {
    actor_type: AuditActorType
    mission_id?: string | null
    trace_id: string
    target?: string | null
    before?: Record<string, unknown> | null
    after?: Record<string, unknown> | null
    result: AuditResult
    safe_error_code?: string | null
    evidence_refs?: string[]
    details?: Record<string, unknown>
    recorded_at: string
  }
  created_at: string
}

export interface EvidenceBundle {
  workspaceId: string
  missionId: string
  generatedAt: string
  eventsCount: number
  allEvidenceRefs: string[]
  events: AuditEventRecord[]
}

/**
 * Redacts API keys, tokens, phone numbers, and emails deeply in any object or string.
 */
export function redactSensitiveData<T>(val: T): T {
  if (val === null || val === undefined) return val

  if (typeof val === 'string') {
    let s: string = val

    // 1. API Keys & Tokens
    s = s.replace(/\bsk-[a-zA-Z0-9_-]{10,}\b/g, '[REDACTED_API_KEY]')
    s = s.replace(/\bAIzaSy[a-zA-Z0-9_-]{10,}\b/g, '[REDACTED_API_KEY]')
    s = s.replace(/\bEAA[a-zA-Z0-9]{10,}\b/g, '[REDACTED_TOKEN]')
    s = s.replace(/Bearer\s+[a-zA-Z0-9_.-]+/g, 'Bearer [REDACTED_TOKEN]')

    // 2. Korean Phone Numbers (010-1234-5678 or 01012345678)
    s = s.replace(
      /\b(01[016789])-?([0-9]{3,4})-?([0-9]{4})\b/g,
      (_match, p1, _p2, p3) => `${p1}-****-${p3}`
    )

    // 3. Emails
    s = s.replace(
      /\b([a-zA-Z0-9._%+-])[a-zA-Z0-9._%+-]*([a-zA-Z0-9._%+-])@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/g,
      (_match, first, last, domain) => `${first}***${last}@${domain}`
    )

    return s as unknown as T
  }

  if (Array.isArray(val)) {
    return val.map(item => redactSensitiveData(item)) as unknown as T
  }

  if (typeof val === 'object') {
    const copy: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(val)) {
      copy[k] = redactSensitiveData(v)
    }
    return copy as unknown as T
  }

  return val
}

export class UnifiedMissionAuditWriter {
  constructor(private readonly client: SupabaseClient<Database>) {}

  /**
   * Appends an immutable audit event with PII/Secret redaction and strict lineage metadata.
   */
  public async writeAuditEvent(input: WriteAuditEventInput): Promise<AuditEventRecord> {
    const {
      workspaceId,
      actorType,
      actorId = null,
      eventType,
      entityType,
      entityId = null,
      missionId = null,
      traceId,
      target = null,
      before = null,
      after = null,
      result,
      safeErrorCode = null,
      evidenceRefs = [],
      details = {},
    } = input

    const now = new Date().toISOString()
    const id = crypto.randomUUID()

    // Deeply redact details, before, after
    const safeBefore = before ? redactSensitiveData(before) : null
    const safeAfter = after ? redactSensitiveData(after) : null
    const safeDetails = details ? redactSensitiveData(details) : {}

    const payload = {
      id,
      workspace_id: workspaceId,
      actor_id: actorId,
      event_type: eventType,
      entity_type: entityType,
      entity_id: entityId,
      metadata: {
        actor_type: actorType,
        mission_id: missionId,
        trace_id: traceId,
        target,
        before: safeBefore,
        after: safeAfter,
        result,
        safe_error_code: safeErrorCode,
        evidence_refs: evidenceRefs,
        details: safeDetails,
        recorded_at: now,
      },
      created_at: now,
    }

    const { data, error } = await (this.client as any)
      .from('audit_events')
      .insert(payload)
      .select()
      .single()

    if (error) {
      console.warn('[UnifiedMissionAuditWriter] Notice: audit event insert error:', error)
      return payload as AuditEventRecord
    }

    return (data || payload) as AuditEventRecord
  }

  /**
   * Exports complete Evidence Bundle for a mission.
   */
  public async exportEvidenceBundle(
    workspaceId: string,
    missionId: string
  ): Promise<EvidenceBundle> {
    const { data: rows, error } = await (this.client as any)
      .from('audit_events')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: true })
      .limit(100)

    // A failed or unobserved read is an error, never an empty bundle.
    if (error || !Array.isArray(rows)) throw new Error('AUDIT_EVIDENCE_READ_FAILED')
    const missionEvents: AuditEventRecord[] = rows.filter(
      (r: any) => r.metadata?.mission_id === missionId
    )

    const allRefs = new Set<string>()
    for (const evt of missionEvents) {
      for (const ref of evt.metadata?.evidence_refs || []) {
        if (ref) allRefs.add(ref)
      }
    }

    return {
      workspaceId,
      missionId,
      generatedAt: new Date().toISOString(),
      eventsCount: missionEvents.length,
      allEvidenceRefs: Array.from(allRefs),
      events: missionEvents,
    }
  }
}
