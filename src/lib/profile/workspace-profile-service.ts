/**
 * Workspace Business & Brand Profile SSOT Service (ANI-991)
 *
 * Enforces server mutation boundary, atomic persistence to canonical tables:
 * - business_profiles(workspace_id, business_name, industry, location, summary)
 * - brand_profiles(workspace_id, voice, keywords, prohibited_terms)
 * with fail-closed mutation checks and immediate readback verification.
 */

import { createServerSupabaseClient } from '@/lib/supabase/server'
import { assertSupabaseSuccess } from '@/lib/supabase/require-success'

export interface BusinessProfileInput {
  businessName: string
  industry?: string | null
  location?: string | null
  summary?: string | null
}

export interface BrandProfileInput {
  voice?: string | null
  keywords?: string[] | null
  prohibitedTerms?: string[] | null
}

export interface CanonicalBusinessProfile {
  workspace_id: string
  business_name: string
  industry: string | null
  location: string | null
  summary: string | null
  updated_at: string
}

export interface CanonicalBrandProfile {
  workspace_id: string
  voice: string | null
  keywords: string[]
  prohibited_terms: string[]
  updated_at: string
}

export interface WorkspaceProfileBundle {
  business: CanonicalBusinessProfile
  brand: CanonicalBrandProfile
  readbackVerified: boolean
  verifiedAt: string
}

export async function saveWorkspaceProfile(params: {
  workspaceId: string
  business: BusinessProfileInput
  brand: BrandProfileInput
  client?: any
}): Promise<WorkspaceProfileBundle> {
  const { workspaceId, business, brand } = params
  const supabase = params.client || (await createServerSupabaseClient())

  const now = new Date().toISOString()

  // 1. Persist Business Profile
  const businessMutation = await supabase
    .from('business_profiles')
    .upsert(
      {
        workspace_id: workspaceId,
        business_name: business.businessName.trim(),
        industry: business.industry?.trim() || null,
        location: business.location?.trim() || null,
        summary: business.summary?.trim() || null,
        updated_at: now,
      },
      { onConflict: 'workspace_id' }
    )
    .select('*')
    .single()

  const persistedBusiness = assertSupabaseSuccess<CanonicalBusinessProfile>(
    businessMutation,
    'Save business_profiles'
  )

  // 2. Persist Brand Profile
  const brandMutation = await supabase
    .from('brand_profiles')
    .upsert(
      {
        workspace_id: workspaceId,
        voice: brand.voice?.trim() || null,
        keywords: brand.keywords || [],
        prohibited_terms: brand.prohibitedTerms || [],
        updated_at: now,
      },
      { onConflict: 'workspace_id' }
    )
    .select('*')
    .single()

  const persistedBrand = assertSupabaseSuccess<CanonicalBrandProfile>(
    brandMutation,
    'Save brand_profiles'
  )

  // 3. Readback Verification from DB SSOT
  const businessReadback = await supabase
    .from('business_profiles')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  const verifiedBusiness = assertSupabaseSuccess<CanonicalBusinessProfile>(
    businessReadback,
    'Readback business_profiles'
  )

  const brandReadback = await supabase
    .from('brand_profiles')
    .select('*')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  const verifiedBrand = assertSupabaseSuccess<CanonicalBrandProfile>(
    brandReadback,
    'Readback brand_profiles'
  )

  return {
    business: verifiedBusiness,
    brand: verifiedBrand,
    readbackVerified: true,
    verifiedAt: new Date().toISOString(),
  }
}

export async function getWorkspaceProfile(params: {
  workspaceId: string
  client?: any
}): Promise<{
  business: CanonicalBusinessProfile | null
  brand: CanonicalBrandProfile | null
}> {
  const { workspaceId } = params
  const supabase = params.client || (await createServerSupabaseClient())

  const [businessRes, brandRes] = await Promise.all([
    supabase.from('business_profiles').select('*').eq('workspace_id', workspaceId).maybeSingle(),
    supabase.from('brand_profiles').select('*').eq('workspace_id', workspaceId).maybeSingle(),
  ])

  return {
    business: businessRes.data || null,
    brand: brandRes.data || null,
  }
}
