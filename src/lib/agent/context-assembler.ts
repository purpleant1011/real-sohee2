/**
 * Canonical Employee Context Assembler (ANI-992)
 *
 * Assembles durable business context, brand voice, knowledge facts, and harness rules
 * from canonical database tables with exact source IDs and provenance.
 * Strictly avoids hardcoded seeds or synthetic business data in ACTUAL mode.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server'
import type {
  CanonicalBusinessProfile,
  CanonicalBrandProfile,
} from '@/lib/profile/workspace-profile-service'

export interface AssembledFact {
  id: string
  category: string
  content: string
  sourceId: string
  approvedAt: string
}

export interface AssembledRule {
  id: string
  ruleKey: string
  ruleType: string
  title: string
  description: string | null
  structuredRule: Record<string, any>
  sourceId: string
  version: number
}

export interface ProvenanceRecord {
  sourceId: string
  table: string
  recordId: string
  fetchedAt: string
}

export interface AssembledEmployeeContext {
  workspaceId: string
  datasetMode: 'ACTUAL' | 'DEMO' | 'TEST'
  business: CanonicalBusinessProfile | null
  brand: CanonicalBrandProfile | null
  facts: AssembledFact[]
  rules: AssembledRule[]
  provenance: ProvenanceRecord[]
  systemPromptContext: string
}

export class ContextAssembler {
  public static async assembleContext(params: {
    workspaceId: string
    datasetMode?: 'ACTUAL' | 'DEMO' | 'TEST'
    client?: any
  }): Promise<AssembledEmployeeContext> {
    const { workspaceId } = params
    const datasetMode =
      params.datasetMode ||
      ((process.env.NEXT_PUBLIC_DATASET_MODE || 'ACTUAL').toUpperCase() as
        | 'ACTUAL'
        | 'DEMO'
        | 'TEST')
    const supabase = params.client || (await createServerSupabaseClient())

    const now = new Date().toISOString()
    const provenance: ProvenanceRecord[] = []

    // 1. Fetch Business Profile
    let business: CanonicalBusinessProfile | null = null
    const businessRes = await supabase
      .from('business_profiles')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (businessRes.data) {
      business = businessRes.data
      provenance.push({
        sourceId: `business_profiles:${workspaceId}`,
        table: 'business_profiles',
        recordId: workspaceId,
        fetchedAt: now,
      })
    }

    // 2. Fetch Brand Profile
    let brand: CanonicalBrandProfile | null = null
    const brandRes = await supabase
      .from('brand_profiles')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle()

    if (brandRes.data) {
      brand = brandRes.data
      provenance.push({
        sourceId: `brand_profiles:${workspaceId}`,
        table: 'brand_profiles',
        recordId: workspaceId,
        fetchedAt: now,
      })
    }

    // 3. Fetch Active Knowledge Facts
    const facts: AssembledFact[] = []
    const factsRes = await supabase
      .from('knowledge_facts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')

    if (factsRes.data && Array.isArray(factsRes.data)) {
      for (const f of factsRes.data) {
        const sourceId = `knowledge_facts:${f.id}`
        facts.push({
          id: f.id,
          category: f.category,
          content: f.content,
          sourceId,
          approvedAt: f.approved_at || f.created_at,
        })
        provenance.push({
          sourceId,
          table: 'knowledge_facts',
          recordId: f.id,
          fetchedAt: now,
        })
      }
    }

    // 4. Fetch Active Harness Rules
    const rules: AssembledRule[] = []
    const rulesRes = await supabase
      .from('harness_rules')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')

    if (rulesRes.data && Array.isArray(rulesRes.data)) {
      for (const r of rulesRes.data) {
        const sourceId = `harness_rules:${r.id}`
        rules.push({
          id: r.id,
          ruleKey: r.rule_key,
          ruleType: r.rule_type,
          title: r.title,
          description: r.description,
          structuredRule: r.structured_rule || {},
          sourceId,
          version: r.version || 1,
        })
        provenance.push({
          sourceId,
          table: 'harness_rules',
          recordId: r.id,
          fetchedAt: now,
        })
      }
    }

    // 5. Build System Prompt Context
    const promptLines: string[] = []

    if (business) {
      promptLines.push(`[사업장: ${business.business_name}]`)
      if (business.industry) promptLines.push(`- 업종: ${business.industry}`)
      if (business.location) promptLines.push(`- 위치: ${business.location}`)
      if (business.summary) promptLines.push(`- 매장 소개: ${business.summary}`)
      promptLines.push(`- Source: business_profiles:${workspaceId}`)
    }

    if (brand) {
      if (brand.voice) promptLines.push(`[브랜드 어조]: ${brand.voice}`)
      if (brand.keywords && brand.keywords.length > 0) {
        promptLines.push(`[핵심 키워드]: ${brand.keywords.join(', ')}`)
      }
      if (brand.prohibited_terms && brand.prohibited_terms.length > 0) {
        promptLines.push(`[금지어/주의사항]: ${brand.prohibited_terms.join(', ')}`)
      }
      promptLines.push(`- Source: brand_profiles:${workspaceId}`)
    }

    if (facts.length > 0) {
      promptLines.push('\n[검증된 매장 지식 (Knowledge Facts)]')
      for (const f of facts) {
        promptLines.push(`- [${f.category}] ${f.content} (Source: ${f.sourceId})`)
      }
    }

    if (rules.length > 0) {
      promptLines.push('\n[업무 운영 가드레일 (Harness Rules)]')
      for (const r of rules) {
        promptLines.push(`- [${r.ruleType}] ${r.title}: ${r.description || ''} (Source: ${r.sourceId})`)
      }
    }

    const systemPromptContext = promptLines.join('\n')

    return {
      workspaceId,
      datasetMode,
      business,
      brand,
      facts,
      rules,
      provenance,
      systemPromptContext,
    }
  }
}
