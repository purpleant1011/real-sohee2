/**
 * SOHEE V0.91 · Knowledge Harness Server Functions
 * Isolated from client bundles to prevent server-only import errors.
 */

import type { KnowledgeHarnessVersion } from './knowledge-manager'

/**
 * [HF-13 & P0-11] Real Database Persistence for Knowledge Harness
 * Saves confirmed knowledge version into workspace_knowledge_harnesses table.
 */
export async function persistKnowledgeHarness(
  version: KnowledgeHarnessVersion,
  supabaseClient?: any
): Promise<void> {
  let client = supabaseClient
  if (!client) {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    client = await createServerSupabaseClient()
  }

  // Deactivate existing active versions for this workspace
  await client
    .from('workspace_knowledge_harnesses')
    .update({ is_active: false })
    .eq('workspace_id', version.workspaceId)
    .eq('is_active', true)

  // Insert new active version
  const offerings = version.factsSnapshot
    .filter((f) => f.category === 'MENU' || f.category === 'PRICE')
    .map((f) => ({ key: f.factKey, value: f.factValue }))

  const policies = version.factsSnapshot
    .filter((f) => f.category === 'HOURS' || f.category === 'PARKING' || f.category === 'PROHIBITED' || f.category === 'DIFFERENTIATOR' || f.category === 'FAQ')
    .map((f) => ({ key: f.factKey, value: f.factValue, category: f.category }))

  const differentiatorFacts = version.factsSnapshot
    .filter((f) => f.category === 'DIFFERENTIATOR')
    .map((f) => ({ key: f.factKey, value: f.factValue }))

  const primaryDiff = differentiatorFacts.find((f) =>
    f.key.includes('업종') || f.key.includes('업태') || f.key.includes('매장') || f.key.includes('특징') || f.key.includes('차별')
  ) || differentiatorFacts[0]

  let businessType = primaryDiff?.value

  if (!businessType) {
    try {
      const [bpRes, saRes, wsRes] = await Promise.all([
        client.from('business_profiles').select('business_name, industry').eq('workspace_id', version.workspaceId).maybeSingle(),
        client.from('signup_applications').select('company_name, business_type').eq('workspace_id', version.workspaceId).maybeSingle(),
        client.from('workspaces').select('name').eq('id', version.workspaceId).maybeSingle(),
      ])
      businessType = bpRes?.data?.industry || saRes?.data?.business_type || bpRes?.data?.business_name || saRes?.data?.company_name || wsRes?.data?.name
    } catch {
      // safe fallback
    }
  }

  if (businessType && !policies.some((p: any) => p.category === 'DIFFERENTIATOR')) {
    policies.push({ key: '업종/매장 특성', value: businessType, category: 'DIFFERENTIATOR' })
  }

  const { error } = await client
    .from('workspace_knowledge_harnesses')
    .insert({
      harness_version_id: version.id,
      workspace_id: version.workspaceId,
      version_no: version.versionNumber,
      compiled_at: version.createdAt,
      is_active: true,
      business_identity: {
        totalFacts: version.factsSnapshot.length,
        createdBy: version.createdBy,
        businessType: businessType || undefined,
        differentiators: differentiatorFacts.length > 0 ? differentiatorFacts : (businessType ? [{ key: '업종/매장 특성', value: businessType }] : []),
      },
      offerings,
      policies,
    })

  if (error) {
    console.error('[persistKnowledgeHarness] Failed to persist:', error)
    throw new Error(`지식 하네스 영속화 실패: ${error.message}`)
  }
}

/**
 * [HF-13 & P0-11] Load currently active knowledge harness from Supabase
 */
export async function loadActiveKnowledgeHarness(
  workspaceId: string,
  supabaseClient?: any
): Promise<any | null> {
  let client = supabaseClient
  if (!client) {
    const { createServerSupabaseClient } = await import('@/lib/supabase/server')
    client = await createServerSupabaseClient()
  }

  const { data, error } = await client
    .from('workspace_knowledge_harnesses')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .maybeSingle()

  if (error) {
    console.error('[loadActiveKnowledgeHarness] Error loading harness:', error)
    return null
  }
  return data
}
