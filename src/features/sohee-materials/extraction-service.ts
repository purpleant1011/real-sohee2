import type { ExtractedSuggestion, PromoteSuggestionsInput } from './types'

export interface ExtractionClientDeps {
  from(table: string): any
}

async function resolveClient(client?: ExtractionClientDeps): Promise<ExtractionClientDeps> {
  if (client) return client
  const { createAdminSupabaseClient } = await import('@/lib/supabase/admin')
  return createAdminSupabaseClient() as unknown as ExtractionClientDeps
}

/**
 * 자료 텍스트에서 매장 정보(메뉴, 가격, 영업시간, 차별점, FAQ 등)를 추출
 */
export function extractFactsFromContent(
  rawText: string,
  materialName: string,
): ExtractedSuggestion[] {
  if (!rawText || !rawText.trim()) {
    return []
  }

  const lines = rawText
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length === 0) {
    return []
  }

  const hoursLines: string[] = []
  const menuLines: string[] = []
  const priceLines: string[] = []
  const faqLines: string[] = []
  const diffLines: string[] = []
  const prohibitedLines: string[] = []

  const hoursRegex = /(영업시간|운영시간|브레이크타임|라스트오더|정기\s*휴무|휴무일|매주\s*[월화수목금토일]|매일\s*\d{1,2}[:시]|\d{1,2}:\d{2}\s*[~-]\s*\d{1,2}:\d{2})/i
  const priceOnlyRegex = /(가격\s*:|1인\s*\d|단가\s*:|비용\s*:|금액\s*:)/i
  const menuPriceRegex = /([0-9,]{3,}\s*원|메뉴\s*:|대표\s*메뉴|추천\s*메뉴|인기\s*메뉴|정식|세트|찌개|구이|볶음|탕|면|밥|디저트)/i
  const faqRegex = /(주차|주차장|오시는\s*길|위치\s*:|찾아오시는|지하철|출구|도보|예약\s*:|포장\s*:|와이파이|화장실)/i
  const diffRegex = /(특징\s*:|비법|차별점|직접\s+|수제|국내산|원산지|숙성|특제|고집|엄선|1등급|당일\s*공수)/i
  const prohibitedRegex = /(주의사항|주의\s*:|금지|불가|알레르기|제한|외부\s*음식|노키즈)/i

  for (const line of lines) {
    let matched = false

    if (prohibitedRegex.test(line)) {
      prohibitedLines.push(line)
      matched = true
    }

    if (hoursRegex.test(line)) {
      hoursLines.push(line)
      matched = true
    }

    if (faqRegex.test(line)) {
      faqLines.push(line)
      matched = true
    }

    if (diffRegex.test(line)) {
      diffLines.push(line)
      matched = true
    }

    if (priceOnlyRegex.test(line)) {
      priceLines.push(line)
      matched = true
    } else if (menuPriceRegex.test(line)) {
      menuLines.push(line)
      matched = true
    }
  }

  const suggestions: ExtractedSuggestion[] = []
  let suggestionIndex = 1

  function sanitizeContent(text: string): string {
    return text.replace(/\s+/g, ' ').trim().slice(0, 500)
  }

  // 1. MENU 추출
  if (menuLines.length > 0) {
    const content = sanitizeContent(menuLines.slice(0, 5).join('\n'))
    if (content) {
      suggestions.push({
        id: `sug-${suggestionIndex++}`,
        category: 'MENU',
        content,
        confidence: 0.95,
      })
    }
  }

  // 2. PRICE 추출 (별도 가격 정보가 있거나 메뉴와 분리된 경우)
  if (priceLines.length > 0) {
    const content = sanitizeContent(priceLines.slice(0, 3).join('\n'))
    if (content) {
      suggestions.push({
        id: `sug-${suggestionIndex++}`,
        category: 'PRICE',
        content,
        confidence: 0.9,
      })
    }
  }

  // 3. HOURS 추출
  if (hoursLines.length > 0) {
    const content = sanitizeContent(hoursLines.slice(0, 4).join('\n'))
    if (content) {
      suggestions.push({
        id: `sug-${suggestionIndex++}`,
        category: 'HOURS',
        content,
        confidence: 0.95,
      })
    }
  }

  // 4. DIFFERENTIATOR 추출
  if (diffLines.length > 0) {
    const content = sanitizeContent(diffLines.slice(0, 4).join('\n'))
    if (content) {
      suggestions.push({
        id: `sug-${suggestionIndex++}`,
        category: 'DIFFERENTIATOR',
        content,
        confidence: 0.85,
      })
    }
  }

  // 5. FAQ 추출
  if (faqLines.length > 0) {
    const content = sanitizeContent(faqLines.slice(0, 4).join('\n'))
    if (content) {
      suggestions.push({
        id: `sug-${suggestionIndex++}`,
        category: 'FAQ',
        content,
        confidence: 0.85,
      })
    }
  }

  // 6. PROHIBITED 추출
  if (prohibitedLines.length > 0) {
    const content = sanitizeContent(prohibitedLines.slice(0, 3).join('\n'))
    if (content) {
      suggestions.push({
        id: `sug-${suggestionIndex++}`,
        category: 'PROHIBITED',
        content,
        confidence: 0.9,
      })
    }
  }

  // 매칭된 패턴이 전혀 없으면 기본 일반 정보로 추출
  if (suggestions.length === 0 && lines.length > 0) {
    const fallbackContent = sanitizeContent(lines.slice(0, 3).join('\n'))
    suggestions.push({
      id: `sug-${suggestionIndex++}`,
      category: 'FAQ',
      content: fallbackContent,
      confidence: 0.7,
    })
  }

  // 최대 5개 반환
  return suggestions.slice(0, 5)
}

/**
 * 출처용 knowledge_sources 조회 또는 신규 생성
 */
async function getOrCreateFileSourceId(
  supabase: ExtractionClientDeps,
  workspaceId: string,
  userId: string,
  materialName: string,
): Promise<string> {
  const { data: existingSource } = await supabase
    .from('knowledge_sources')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('display_name', materialName)
    .eq('source_type', 'file')
    .maybeSingle()

  if (existingSource?.id) {
    return existingSource.id
  }

  const now = new Date().toISOString()
  const { data: newSource, error: insertSourceError } = await supabase
    .from('knowledge_sources')
    .insert({
      workspace_id: workspaceId,
      display_name: materialName,
      source_type: 'file',
      status: 'approved',
      created_by_user_id: userId,
      created_at: now,
      updated_at: now,
    })
    .select('id')
    .single()

  if (insertSourceError || !newSource?.id) {
    throw new Error(
      insertSourceError?.message || 'FAILED_TO_CREATE_FILE_KNOWLEDGE_SOURCE',
    )
  }

  return newSource.id
}

/**
 * 사장님이 선택한 추출 추천 지식들을 active 상태의 knowledge_facts로 원자적 승격 저장
 */
export async function promoteSuggestionsToFacts(
  input: PromoteSuggestionsInput,
  client?: ExtractionClientDeps,
): Promise<{ promotedCount: number; factIds: string[] }> {
  const { workspaceId, userId, materialId, materialName, suggestions } = input

  if (!workspaceId?.trim()) throw new Error('workspaceId is required')
  if (!userId?.trim()) throw new Error('userId is required')
  if (!materialId?.trim()) throw new Error('materialId is required')
  if (!materialName?.trim()) throw new Error('materialName is required')

  if (!suggestions || suggestions.length === 0) {
    return { promotedCount: 0, factIds: [] }
  }

  const supabase = await resolveClient(client)
  const sourceId = await getOrCreateFileSourceId(
    supabase,
    workspaceId.trim(),
    userId.trim(),
    materialName.trim(),
  )

  const now = new Date().toISOString()
  const factIds: string[] = []

  for (const suggestion of suggestions) {
    const safeCategory = (suggestion.category || 'FAQ').trim().slice(0, 120)
    const safeContent = (suggestion.content || '').trim().slice(0, 12000)

    if (!safeContent) continue

    // 1. knowledge_candidates 생성 (approved)
    const { data: candidate, error: candidateError } = await supabase
      .from('knowledge_candidates')
      .insert({
        workspace_id: workspaceId.trim(),
        knowledge_source_id: sourceId,
        category: safeCategory,
        content: safeContent,
        source_location: `file:${materialName.trim()}`,
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
      throw new Error(
        candidateError?.message || 'FAILED_TO_CREATE_KNOWLEDGE_CANDIDATE',
      )
    }

    // 2. knowledge_facts 생성 (active)
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
      .select('id')
      .single()

    if (factError || !fact?.id) {
      throw new Error(
        factError?.message || 'FAILED_TO_CREATE_KNOWLEDGE_FACT',
      )
    }

    factIds.push(fact.id)
  }

  // 3. knowledge_items 테이블의 status를 'approved'로 갱신
  await supabase
    .from('knowledge_items')
    .update({
      status: 'approved',
      updated_at: now,
    })
    .eq('id', materialId.trim())
    .eq('workspace_id', workspaceId.trim())

  return {
    promotedCount: factIds.length,
    factIds,
  }
}
