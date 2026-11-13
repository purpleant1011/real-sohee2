import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { extractFactsFromContent } from '@/features/sohee-materials/extraction-service'
import type { ExtractedSuggestion } from '@/features/sohee-materials/types'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ workspaceId: string; materialId: string }> },
) {
  try {
    const { workspaceId, materialId } = await props.params

    const auth = await requireWorkspaceMembership(workspaceId)
    if (!auth.ok) {
      return NextResponse.json(
        { success: false, error: auth.error, message: auth.message },
        { status: auth.status, headers: NO_STORE },
      )
    }

    const supabase = createAdminSupabaseClient()

    // 1. knowledge_items에서 조회
    const { data: itemData, error: itemError } = await supabase
      .from('knowledge_items')
      .select('id, name, evidence')
      .eq('id', materialId)
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (itemError) {
      console.error('[knowledge-materials-suggestions] query knowledge_items error:', itemError)
    }

    let materialName = itemData?.name
    let suggestions: ExtractedSuggestion[] = []

    if (itemData) {
      const evidence = (itemData.evidence as Record<string, any>) || {}
      if (Array.isArray(evidence.suggestions) && evidence.suggestions.length > 0) {
        suggestions = evidence.suggestions
      } else {
        const textToExtract =
          typeof evidence.extractedText === 'string' && evidence.extractedText.trim()
            ? evidence.extractedText
            : itemData.name
        suggestions = extractFactsFromContent(textToExtract, itemData.name)
      }
    } else {
      // 2. knowledge_sources에서 조회
      const { data: sourceData, error: sourceError } = await supabase
        .from('knowledge_sources')
        .select('id, display_name')
        .eq('id', materialId)
        .eq('workspace_id', workspaceId)
        .maybeSingle()

      if (sourceError) {
        console.error('[knowledge-materials-suggestions] query knowledge_sources error:', sourceError)
      }

      if (!sourceData) {
        return NextResponse.json(
          {
            success: false,
            error: 'MATERIAL_NOT_FOUND',
            message: '자료를 찾을 수 없습니다.',
          },
          { status: 404, headers: NO_STORE },
        )
      }

      materialName = sourceData.display_name
      suggestions = extractFactsFromContent(sourceData.display_name, sourceData.display_name)
    }

    return NextResponse.json(
      {
        success: true,
        data: {
          materialId,
          materialName,
          suggestions,
        },
      },
      { headers: NO_STORE },
    )
  } catch (error) {
    console.error(
      '[knowledge-materials-suggestions] unexpected error:',
      error instanceof Error ? error.name : 'unknown',
    )
    return NextResponse.json(
      {
        success: false,
        error: 'SUGGESTIONS_UNAVAILABLE',
        message: '추천 지식을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
      },
      { status: 500, headers: NO_STORE },
    )
  }
}
