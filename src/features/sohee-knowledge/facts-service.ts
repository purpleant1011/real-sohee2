import type {
  CreateFactInput,
  ExpireFactInput,
  FactItem,
  FactSource,
  UpdateFactInput,
} from './types'

export interface FactsClientDeps {
  from(table: string): any
}

function determineFactSource(
  sourceLocation?: string | null,
  evidenceDocumentId?: string | null,
): FactSource | 'channel' {
  if (evidenceDocumentId) {
    return 'channel'
  }
  if (!sourceLocation) return 'manual'
  const loc = sourceLocation.toLowerCase()
  if (loc.includes('interview:')) {
    return 'interview'
  }
  if (
    loc.includes('file:') ||
    /\.(pdf|png|jpe?g|webp|csv|xlsx?|docx?|txt|hwp)$/i.test(loc) ||
    loc.includes('파일')
  ) {
    return 'file'
  }
  if (loc.includes('channel:') || loc.includes('instagram') || loc.includes('threads')) {
    return 'channel'
  }
  return 'manual'
}

async function resolveClient(client?: FactsClientDeps): Promise<FactsClientDeps> {
  if (client) return client
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  return createAdminSupabaseClient() as unknown as FactsClientDeps
}

/**
 * 내용이 정확히 같은 최신 팩트 1건 조회 (상태 무관).
 *
 * 카탈로그 서비스 행이 어떤 팩트를 근거로 삼는지 잃어버렸을 때(예: link 기록 이전에 저장된 행)
 * 다음 저장이 새 팩트를 하나 더 만들지 않고 기존 팩트를 supersede 하도록 되찾는 용도다.
 * 조회 실패는 조용히 null 로 감추지 않고 던진다 — 호출자가 저장을 계속할지는 호출자가 정한다.
 */
export async function findFactByContent(
  input: { workspaceId: string; category: string; content: string },
  client?: FactsClientDeps,
): Promise<{ id: string } | null> {
  const { workspaceId, category, content } = input
  if (!workspaceId?.trim()) throw new Error('workspaceId is required')
  if (!category?.trim()) throw new Error('category is required')
  if (!content?.trim()) throw new Error('content is required')

  const supabase = await resolveClient(client)
  const { data, error } = await supabase
    .from('knowledge_facts')
    .select('id')
    .eq('workspace_id', workspaceId.trim())
    .eq('category', category.trim())
    .eq('content', content.trim())
    .order('approved_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) throw new Error(error.message || 'KNOWLEDGE_FACT_LOOKUP_FAILED')
  return data?.id ? { id: data.id } : null
}

/**
 * 워크스페이스의 활성 상태 팩트 목록 조회
 */
export async function listWorkspaceFacts(
  workspaceId: string,
  client?: FactsClientDeps,
): Promise<FactItem[]> {
  if (!workspaceId?.trim()) {
    throw new Error('workspaceId is required')
  }

  const supabase = await resolveClient(client)

  // 1. If RPC get_approved_learning_context is available, use authoritative source authority
  if (typeof (supabase as any).rpc === 'function') {
    try {
      const { data: rpcData, error: rpcError } = await (supabase as any).rpc('get_approved_learning_context', {
        p_workspace_id: workspaceId.trim(),
        p_purpose: 'conversation',
        p_max_facts: 200,
        p_query: '',
      })
      if (!rpcError && rpcData !== null && rpcData !== undefined) {
        const items = Array.isArray(rpcData.items)
          ? rpcData.items
          : Array.isArray(rpcData)
            ? rpcData
            : null
        if (items !== null) {
          const channelEnabled = process.env.SOHEE_CHANNEL_LEARNING_ENABLED === '1'
          const facts: FactItem[] = []
          for (const item of items) {
            if (item.source_type === 'channel' && !channelEnabled) continue

            // (C) RPC SQL은 source_type으로 'channel' / 'manual'만 제공하므로,
            // item에 source_location 접두사가 포함된 경우 file/interview 라벨을 복원한다.
            let source: FactSource | 'channel' =
              item.source_type === 'file'
                ? 'file'
                : item.source_type === 'channel'
                  ? 'channel'
                  : 'manual'

            const rawLocation = (item as any).source_location || (item as any).sourceLocation
            if (rawLocation && typeof rawLocation === 'string') {
              const determined = determineFactSource(rawLocation)
              if (determined === 'file' || determined === 'interview') {
                source = determined
              }
            }

            facts.push({
              id: item.id,
              category: item.category,
              content: item.content,
              createdAt: item.created_at || new Date().toISOString(),
              source: source as FactSource,
            })
          }
          return facts
        }
      }
    } catch {
      // safe fallback to table query
    }
  }

  const { data: factsData, error } = await supabase
    .from('knowledge_facts')
    .select('id, category, content, created_at, source_candidate_id, valid_until')
    .eq('workspace_id', workspaceId.trim())
    .eq('status', 'active')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    throw new Error(error.message || 'KNOWLEDGE_FACTS_QUERY_FAILED')
  }

  const now = Date.now()
  const candidateIds = (factsData ?? [])
    .filter((f: any) => {
      if (f.valid_until) {
        const until = new Date(f.valid_until).getTime()
        if (!Number.isNaN(until) && until <= now) return false
      }
      return true
    })
    .map((f: any) => f.source_candidate_id)
    .filter(Boolean)

  const candidateMetaMap = new Map<
    string,
    { sourceLocation?: string | null; evidenceDocId?: string | null }
  >()
  if (candidateIds.length > 0) {
    try {
      const { data: candRows, error: candError } = await supabase
        .from('knowledge_candidates')
        .select('id, source_location, evidence_document_id')
        .eq('workspace_id', workspaceId.trim())
        .in('id', candidateIds)
      if (!candError && Array.isArray(candRows)) {
        for (const c of candRows) {
          if (c?.id) {
            candidateMetaMap.set(c.id, {
              sourceLocation: c.source_location,
              evidenceDocId: c.evidence_document_id,
            })
          }
        }
      } else if (candError) {
        // Fallback for older schemas lacking evidence_document_id column
        const { data: fallbackRows } = await supabase
          .from('knowledge_candidates')
          .select('id, source_location')
          .eq('workspace_id', workspaceId.trim())
          .in('id', candidateIds)
        if (Array.isArray(fallbackRows)) {
          for (const c of fallbackRows) {
            if (c?.id) {
              candidateMetaMap.set(c.id, {
                sourceLocation: c.source_location,
              })
            }
          }
        }
      }
    } catch {
      // safe fallback
    }
  }

  const facts: FactItem[] = []

  for (const row of factsData ?? []) {
    if (row.valid_until) {
      const until = new Date(row.valid_until).getTime()
      if (!Number.isNaN(until) && until <= now) continue
    }

    let source: FactSource = 'manual'

    if (row.source_candidate_id) {
      const candMeta = candidateMetaMap.get(row.source_candidate_id)
      // (A) 후보 조회 예외/오류 또는 후보 행 누락으로 메타를 얻지 못한 팩트는 불확실하므로 fail-closed (제외)
      if (!candMeta) {
        continue
      }

      // (B) 채널 학습은 evidence_document_id가 필수(NOT NULL)이거나 source_location에 채널 키워드가 포함됨.
      // v08 온보딩 및 수동 등록 후보(source_location: null, evidence_document_id: null)는 채널이 아니므로 보존됨.
      const determined = determineFactSource(candMeta.sourceLocation, candMeta.evidenceDocId)

      // Fallback 경로에서는 권위 있는 RPC 검증이 없으므로 채널 지식은 fail-closed
      if (determined === 'channel') {
        continue
      }

      source = determined as FactSource
    } else {
      // source_candidate_id가 아예 없는 순수 레거시 수동 팩트는 보존
      source = 'manual'
    }

    facts.push({
      id: row.id,
      category: row.category,
      content: row.content,
      createdAt: row.created_at,
      source,
    })
  }
  return facts
}

/**
 * 수동 등록용 소스 ID를 조회하거나 생성
 */
async function getOrCreateManualSourceId(
  supabase: FactsClientDeps,
  workspaceId: string,
  userId: string,
): Promise<string> {
  const { data: existingSource } = await supabase
    .from('knowledge_sources')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('display_name', '사장님 직접 등록')
    .maybeSingle()

  if (existingSource?.id) {
    return existingSource.id
  }

  const now = new Date().toISOString()
  const { data: newSource, error: insertSourceError } = await supabase
    .from('knowledge_sources')
    .insert({
      workspace_id: workspaceId,
      display_name: '사장님 직접 등록',
      source_type: 'manual',
      status: 'approved',
      created_by_user_id: userId,
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single()

  if (insertSourceError || !newSource?.id) {
    throw new Error(
      insertSourceError?.message || 'FAILED_TO_CREATE_MANUAL_KNOWLEDGE_SOURCE',
    )
  }

  return newSource.id
}

/**
 * 사장님 직접 등록 팩트 신규 생성
 */
export async function createCustomFact(
  input: CreateFactInput,
  client?: FactsClientDeps,
): Promise<FactItem> {
  const { workspaceId, userId, category, content } = input

  if (!workspaceId?.trim()) throw new Error('workspaceId is required')
  if (!userId?.trim()) throw new Error('userId is required')
  if (!category?.trim()) throw new Error('category is required')
  if (!content?.trim()) throw new Error('content is required')

  const safeCategory = category.trim().slice(0, 120)
  const safeContent = content.trim().slice(0, 12000)
  const supabase = await resolveClient(client)

  const sourceId = await getOrCreateManualSourceId(
    supabase,
    workspaceId.trim(),
    userId.trim(),
  )
  const now = new Date().toISOString()

  // 1. knowledge_candidates 등록
  const { data: candidate, error: candidateError } = await supabase
    .from('knowledge_candidates')
    .insert({
      workspace_id: workspaceId.trim(),
      knowledge_source_id: sourceId,
      category: safeCategory,
      content: safeContent,
      source_location: 'manual',
      confidence: 1.0,
      status: 'approved',
      reviewed_by_user_id: userId.trim(),
      reviewed_at: now,
      created_by_user_id: userId.trim(),
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single()

  if (candidateError || !candidate?.id) {
    throw new Error(candidateError?.message || 'FAILED_TO_CREATE_CANDIDATE')
  }

  // 2. knowledge_facts 등록
  const { data: fact, error: factError } = await supabase
    .from('knowledge_facts')
    .insert({
      workspace_id: workspaceId.trim(),
      source_candidate_id: candidate.id,
      category: safeCategory,
      content: safeContent,
      status: 'active',
      approved_by_user_id: userId.trim(),
      approved_at: now,
      valid_from: now,
      created_at: now,
    })
    .select('id, category, content, created_at')
    .single()

  if (factError || !fact) {
    throw new Error(factError?.message || 'FAILED_TO_CREATE_FACT')
  }

  return {
    id: fact.id,
    category: fact.category,
    content: fact.content,
    createdAt: fact.created_at,
    source: 'manual',
  }
}

/**
 * 기존 팩트 내용 인라인 수정 (기존 supersede 처리 후 신규 active 팩트 생성)
 */
export async function updateFactContent(
  input: UpdateFactInput,
  client?: FactsClientDeps,
): Promise<FactItem> {
  const { workspaceId, userId, factId, content } = input

  if (!workspaceId?.trim()) throw new Error('workspaceId is required')
  if (!userId?.trim()) throw new Error('userId is required')
  if (!factId?.trim()) throw new Error('factId is required')
  if (!content?.trim()) throw new Error('content is required')

  const safeContent = content.trim().slice(0, 12000)
  const supabase = await resolveClient(client)

  // 1. 기존 사실 조회
  const { data: existingFact, error: fetchError } = await supabase
    .from('knowledge_facts')
    .select(`
      id,
      workspace_id,
      category,
      content,
      source_candidate_id,
      status,
      knowledge_candidates!knowledge_facts_source_candidate_fkey (
        knowledge_source_id,
        source_location
      )
    `)
    .eq('workspace_id', workspaceId.trim())
    .eq('id', factId.trim())
    .maybeSingle()

  if (fetchError || !existingFact) {
    throw new Error('Fact not found')
  }

  const candidateData = Array.isArray(existingFact.knowledge_candidates)
    ? existingFact.knowledge_candidates[0]
    : existingFact.knowledge_candidates

  const sourceLocation = candidateData?.source_location ?? 'manual'
  let sourceId = candidateData?.knowledge_source_id

  if (!sourceId) {
    sourceId = await getOrCreateManualSourceId(
      supabase,
      workspaceId.trim(),
      userId.trim(),
    )
  }

  const now = new Date().toISOString()

  // 2. 새 candidate 레코드 생성
  const { data: newCandidate, error: candError } = await supabase
    .from('knowledge_candidates')
    .insert({
      workspace_id: workspaceId.trim(),
      knowledge_source_id: sourceId,
      category: existingFact.category,
      content: safeContent,
      source_location: sourceLocation,
      confidence: 1.0,
      status: 'approved',
      reviewed_by_user_id: userId.trim(),
      reviewed_at: now,
      created_by_user_id: userId.trim(),
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single()

  if (candError || !newCandidate?.id) {
    throw new Error(candError?.message || 'FAILED_TO_CREATE_UPDATED_CANDIDATE')
  }

  // 3. 기존 fact supersede 처리
  await supabase
    .from('knowledge_facts')
    .update({
      status: 'superseded',
      valid_until: now,
    })
    .eq('workspace_id', workspaceId.trim())
    .eq('id', factId.trim())

  // 4. 새 active fact 등록 (supersedes_fact_id 연결)
  const { data: newFact, error: factError } = await supabase
    .from('knowledge_facts')
    .insert({
      workspace_id: workspaceId.trim(),
      source_candidate_id: newCandidate.id,
      supersedes_fact_id: factId.trim(),
      category: existingFact.category,
      content: safeContent,
      status: 'active',
      approved_by_user_id: userId.trim(),
      approved_at: now,
      valid_from: now,
      created_at: now,
    })
    .select('id, category, content, created_at')
    .single()

  if (factError || !newFact) {
    throw new Error(factError?.message || 'FAILED_TO_CREATE_SUPERSEDING_FACT')
  }

  return {
    id: newFact.id,
    category: newFact.category,
    content: newFact.content,
    createdAt: newFact.created_at,
    source: determineFactSource(sourceLocation) as FactSource,
  }
}

/**
 * 팩트 만료 (삭제 처리)
 */
export async function expireFact(
  input: ExpireFactInput,
  client?: FactsClientDeps,
): Promise<{ success: true }> {
  const { workspaceId, factId } = input

  if (!workspaceId?.trim()) throw new Error('workspaceId is required')
  if (!factId?.trim()) throw new Error('factId is required')

  const supabase = await resolveClient(client)
  const now = new Date().toISOString()

  const { error } = await supabase
    .from('knowledge_facts')
    .update({
      status: 'expired',
      valid_until: now,
    })
    .eq('workspace_id', workspaceId.trim())
    .eq('id', factId.trim())

  if (error) {
    throw new Error(error.message || 'FAILED_TO_EXPIRE_FACT')
  }

  return { success: true }
}
