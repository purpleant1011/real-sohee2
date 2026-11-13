/**
 * Sohee V0.8.9 Long-term Memory Service (ANI-654)
 * 
 * 3 Memory Classes:
 * 1. Episodic: 특정 thread/run/campaign/action에서 실제 발생한 사건 및 evidence 참조
 * 2. Semantic: 매장 정보, 시술 가격, FAQ, 고객·채널 관련 검증된 사실
 * 3. Procedural: 사장님이 승인한 운영 규칙, 자율성 정책, 콘텐츠 스타일/금지사항
 * 
 * Invariants:
 * - workspace-scoped 격리 (Cross-tenant 접근 0)
 * - Promotion Lifecycle: OBSERVED -> CANDIDATE -> APPROVED -> CANONICAL
 * - Prompt Injection 격리: 외부 입력은 시스템 권한을 수정할 수 없음
 */

import { createServerSupabaseClient } from '@/lib/supabase/server'

export type MemoryClass = 'episodic' | 'semantic' | 'procedural'
export type MemoryStatus = 'observed' | 'candidate' | 'conflicted' | 'approved' | 'canonical' | 'superseded'

export interface AgentMemoryItem {
  id: string
  workspaceId: string
  memoryClass: MemoryClass
  subject: string
  factContent: string
  confidenceScore: number
  provenanceType: string
  provenanceId?: string
  status: MemoryStatus
  createdAt: string
}

export class LongTermMemoryService {
  private static confidence(value: unknown): number {
    const score = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN
    return Number.isFinite(score) && score >= 0 && score <= 1 ? score : 0
  }

  private static searchTerms(text: string): string[] {
    return (text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      .map(term => /^[가-힣]+$/.test(term)
        ? term.replace(/(?:에서는|으로는|에서|으로|은|는|이|가|을|를|에|만|도|로)$/u, '')
        : term)
      .filter(term => term.length >= 2)
  }

  private static rankMemories(
    memories: AgentMemoryItem[], workspaceId: string, terms: string[], limit: number
  ): AgentMemoryItem[] {
    return memories
      .filter(item => item.workspaceId === workspaceId && ['approved', 'canonical'].includes(item.status))
      .map(item => {
        const tokens = this.searchTerms(`${item.subject} ${item.factContent}`)
        const relevance = terms.filter(term => tokens.includes(term)).length
        return { item, relevance }
      })
      .filter(entry => entry.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance || b.item.confidenceScore - a.item.confidenceScore)
      .slice(0, limit)
      .map(entry => entry.item)
  }

  /**
   * 1. Rank a bounded recent candidate window by lexical relevance (not vector search).
   */
  public static async retrieveRelevantMemories(
    workspaceId: string,
    queryKeywords: string[],
    limit = 5,
    signal?: AbortSignal,
    options?: { client?: Awaited<ReturnType<typeof createServerSupabaseClient>>; strict?: boolean }
  ): Promise<AgentMemoryItem[]> {
    signal?.throwIfAborted()
    const resultLimit = Number.isFinite(limit) ? Math.max(0, Math.min(20, Math.floor(limit))) : 5
    const terms = [...new Set(queryKeywords.flatMap(keyword => this.searchTerms(keyword)))]
    if (resultLimit === 0 || terms.length === 0) return []
    const fallback = () => process.env.NEXT_PUBLIC_DATASET_MODE === 'DEMO'
      ? this.rankMemories(this.getWorkspaceSeedMemories(workspaceId), workspaceId, terms, resultLimit)
      : []
    try {
      const supabase = options?.client ?? await createServerSupabaseClient()
      signal?.throwIfAborted()
      const db = supabase as any

      // Primary query: workspace scoped active approved/canonical memories
      const query = db
        .from('agent_memories')
        .select('*')
        .eq('workspace_id', workspaceId)
        .in('status', ['approved', 'canonical'])
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .limit(100)

      const { data, error } = await (signal ? query.abortSignal(signal) : query)
      signal?.throwIfAborted()

      if (error || !Array.isArray(data)) {
        if (options?.strict) throw new Error('KNOWLEDGE_READ_UNAVAILABLE')
        if (error) console.warn('[LongTermMemoryService] Retrieval warning:', error)
        return fallback()
      }
      if (data.length === 0) return options?.strict ? [] : fallback()

      const memories: AgentMemoryItem[] = data.map((item: any) => ({
        id: item.id,
        workspaceId: item.workspace_id,
        memoryClass: item.memory_class,
        subject: item.subject,
        factContent: item.fact_content,
        confidenceScore: this.confidence(item.confidence_score),
        provenanceType: item.provenance_type,
        provenanceId: item.provenance_id,
        status: item.status,
        createdAt: item.created_at
      }))
      return this.rankMemories(memories, workspaceId, terms, resultLimit)
    } catch (err) {
      signal?.throwIfAborted()
      if (options?.strict) throw new Error('KNOWLEDGE_READ_UNAVAILABLE')
      console.error('[LongTermMemoryService] Error querying memory:', err)
      return fallback()
    }
  }

  /**
   * 2. Store or update long-term memory item
   */
  public static async storeMemory(
    workspaceId: string,
    memory: {
      memoryClass: MemoryClass
      subject: string
      factContent: string
      confidenceScore?: number
      provenanceType?: string
      provenanceId?: string
      status?: MemoryStatus
    }
  ): Promise<string> {
    const supabase = await createServerSupabaseClient()
    const db = supabase as any
    const mutation = await db
      .from('agent_memories')
      .insert({
        workspace_id: workspaceId,
        memory_class: memory.memoryClass,
        subject: memory.subject,
        fact_content: memory.factContent,
        confidence_score: memory.confidenceScore === undefined ? 1 : this.confidence(memory.confidenceScore),
        provenance_type: memory.provenanceType || 'manual',
        provenance_id: memory.provenanceId,
        status: memory.status ?? 'candidate'
      })
      .select('id')
      .single()

    const { assertSupabaseSuccess } = await import('@/lib/supabase/require-success')
    const inserted = assertSupabaseSuccess<{ id?: string }>(mutation, 'LongTermMemoryService.storeMemory')
    if (!inserted || Array.isArray(inserted) || typeof inserted.id !== 'string' || !inserted.id.trim()) {
      throw new Error('기억 저장 결과를 확인하지 못했습니다.')
    }
    return inserted.id
  }

  /**
   * Seed memories for workspace (바이름 청라점 정본 지식)
   */
  private static getWorkspaceSeedMemories(workspaceId: string): AgentMemoryItem[] {
    return [
      {
        id: 'mem-seed-1',
        workspaceId,
        memoryClass: 'semantic',
        subject: '매장 기본 정보 및 주소',
        factContent: '바이름 청라점(@studio_by.reum): 인천 서구 청라 커넬웨이 위치, 1:1 맞춤 자연눈썹 및 속눈썹 펌 전문 뷰티 스튜디오.',
        confidenceScore: 1.0,
        provenanceType: 'canonical_seed',
        status: 'canonical',
        createdAt: new Date().toISOString()
      },
      {
        id: 'mem-seed-2',
        workspaceId,
        memoryClass: 'semantic',
        subject: '시그니처 시술 및 특징',
        factContent: '원래 내 눈썹처럼 자연스러운 모류 결 맞춤 디자인. 쌩얼에도 입체감 유지, 당일 일상 복귀 가능 기법.',
        confidenceScore: 1.0,
        provenanceType: 'canonical_seed',
        status: 'canonical',
        createdAt: new Date().toISOString()
      },
      {
        id: 'mem-seed-3',
        workspaceId,
        memoryClass: 'procedural',
        subject: '프로모션 정책',
        factContent: '평일(화/수) 유휴 슬롯 예약 시 첫 방문 15% 특별 혜택 및 노쇼 방지 예약금 2만원 제도 운영.',
        confidenceScore: 1.0,
        provenanceType: 'canonical_seed',
        status: 'canonical',
        createdAt: new Date().toISOString()
      }
    ]
  }

  /**
   * 3. Propose Candidate Memory (ANI-654 Promotion Pipeline Step 1)
   * OBSERVED -> CANDIDATE
   */
  public static async proposeCandidate(
    workspaceId: string,
    params: {
      memoryClass: MemoryClass
      subject: string
      factContent: string
      confidenceScore?: number
      provenanceType: string
      provenanceId?: string
    }
  ): Promise<string> {
    return this.storeMemory(workspaceId, {
      ...params,
      status: 'candidate'
    })
  }

  /**
   * 4. Promote Memory Status (ANI-654 State Machine)
   * Lifecycle: OBSERVED -> CANDIDATE -> REVIEW_REQUIRED -> APPROVED -> CANONICAL
   */
  public static async promoteMemoryStatus(
    workspaceId: string,
    memoryId: string,
    nextStatus: MemoryStatus,
    reason?: string
  ): Promise<{ success: boolean; memoryId: string; status: MemoryStatus; message: string }> {
    try {
      const supabase = await createServerSupabaseClient()
      const db = supabase as any

      const { data, error } = await db
        .from('agent_memories')
        .update({
          status: nextStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', memoryId)
        .eq('workspace_id', workspaceId)
        .select('id, workspace_id, status')
        .maybeSingle()

      if (error || !data || data.id !== memoryId || data.workspace_id !== workspaceId || data.status !== nextStatus) {
        throw new Error('Memory promotion was not confirmed')
      }

      return {
        success: true,
        memoryId,
        status: nextStatus,
        message: `메모리 상태가 ${nextStatus}(으)로 성공적으로 승격되었습니다. ${reason ? `(사유: ${reason})` : ''}`
      }
    } catch (err) {
      console.error('[LongTermMemoryService] Error in promoteMemoryStatus:', err)
      return {
        success: false,
        memoryId,
        status: nextStatus,
        message: '기억 상태 변경을 확인하지 못했습니다. 잠시 후 다시 확인해 주세요.'
      }
    }
  }

  /**
   * 5. List Pending Memory Candidates for Owner Review
   */
  public static async listCandidates(
    workspaceId: string
  ): Promise<AgentMemoryItem[]> {
    try {
      const supabase = await createServerSupabaseClient()
      const db = supabase as any

      const { data, error } = await db
        .from('agent_memories')
        .select('*')
        .eq('workspace_id', workspaceId)
        .in('status', ['observed', 'candidate', 'conflicted'])
        .order('created_at', { ascending: false })

      if (error || !data) return []

      return data.map((item: any) => ({
        id: item.id,
        workspaceId: item.workspace_id,
        memoryClass: item.memory_class,
        subject: item.subject,
        factContent: item.fact_content,
        confidenceScore: this.confidence(item.confidence_score),
        provenanceType: item.provenance_type,
        provenanceId: item.provenance_id,
        status: item.status,
        createdAt: item.created_at
      }))
    } catch (err) {
      console.error('[LongTermMemoryService] Error listing candidates:', err)
      return []
    }
  }
}

