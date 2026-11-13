'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getCurrentWorkspaceContext } from '@/features/auth/current-workspace'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { memberStatuses, type SettingsActionResult } from '../types'

const optionalText = (max: number) => z.string().trim().max(max)
const listText = z.string().max(5_000).transform((value, context) => {
  const values = value.split(',').map((item) => item.trim()).filter(Boolean)
  if (values.length > 100 || values.some((item) => item.length > 100)) {
    context.addIssue({ code: 'custom', message: '각 항목은 100자 이하로 100개까지 입력해 주세요.' })
    return z.NEVER
  }
  return values
})
const businessInputSchema = z.object({
  kind: z.literal('business'),
  businessName: z.string().trim().min(1, '사업명을 입력해 주세요.').max(120, '사업명은 120자 이하로 입력해 주세요.'),
  industry: optionalText(120),
  location: optionalText(200),
  summary: optionalText(4_000),
}).strict()
const brandInputSchema = z.object({
  kind: z.literal('brand'),
  voice: optionalText(2_000),
  keywords: listText,
  prohibitedTerms: listText,
}).strict()
const memberInputSchema = z.object({
  kind: z.literal('member'),
  memberId: z.string().uuid(),
  role: z.enum(['owner', 'manager', 'reviewer', 'viewer']),
  status: z.enum(memberStatuses),
}).strict()
const settingsInputSchema = z.discriminatedUnion('kind', [
  businessInputSchema,
  brandInputSchema,
  memberInputSchema,
])

function invalidInput(error: z.ZodError): SettingsActionResult {
  return {
    ok: false,
    code: 'INVALID_INPUT',
    message: '입력한 내용을 확인해 주세요.',
    fieldErrors: error.flatten().fieldErrors,
  }
}

function forbidden(): SettingsActionResult {
  return { ok: false, code: 'FORBIDDEN', message: '이 설정을 변경할 권한이 없어요.' }
}

function unavailable(): SettingsActionResult {
  return { ok: false, code: 'UNAVAILABLE', message: '설정을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.' }
}

const emptyToNull = (value: string) => value.length === 0 ? null : value

export async function saveSettingsAction(input: unknown): Promise<SettingsActionResult> {
  const parsed = settingsInputSchema.safeParse(input)
  if (!parsed.success) return invalidInput(parsed.error)

  try {
    const workspace = await getCurrentWorkspaceContext()
    if (!workspace) return forbidden()
    const canEditProfiles = workspace.role === 'owner' || workspace.role === 'manager'
    if (parsed.data.kind === 'member' ? workspace.role !== 'owner' : !canEditProfiles) {
      return forbidden()
    }

    const supabase = await createServerSupabaseClient()
    if (parsed.data.kind === 'business') {
      const values = {
        business_name: parsed.data.businessName,
        industry: emptyToNull(parsed.data.industry),
        location: emptyToNull(parsed.data.location),
        summary: emptyToNull(parsed.data.summary),
      }
      const { data: existing, error: updateError } = await supabase
        .from('business_profiles')
        .update(values)
        .eq('workspace_id', workspace.workspaceId)
        .select('workspace_id')
        .maybeSingle()
      if (updateError) return unavailable()
      if (!existing) {
        const { error: insertError } = await supabase.from('business_profiles').insert({
          workspace_id: workspace.workspaceId,
          ...values,
        })
        if (insertError) return unavailable()
      }
      revalidatePath('/app/settings/business')
      revalidatePath('/app/account')
      return { ok: true, message: '사업 정보를 저장했어요.' }
    }

    if (parsed.data.kind === 'brand') {
      const values = {
        voice: emptyToNull(parsed.data.voice),
        keywords: parsed.data.keywords,
        prohibited_terms: parsed.data.prohibitedTerms,
      }
      const { data: existing, error: updateError } = await supabase
        .from('brand_profiles')
        .update(values)
        .eq('workspace_id', workspace.workspaceId)
        .select('workspace_id')
        .maybeSingle()
      if (updateError) return unavailable()
      if (!existing) {
        const { error: insertError } = await supabase.from('brand_profiles').insert({
          workspace_id: workspace.workspaceId,
          ...values,
        })
        if (insertError) return unavailable()
      }
      revalidatePath('/app/settings/brand')
      revalidatePath('/app/account')
      return { ok: true, message: '브랜드 기준을 저장했어요.' }
    }

    const { error } = await supabase.from('workspace_members')
      .update({ role: parsed.data.role, status: parsed.data.status })
      .eq('workspace_id', workspace.workspaceId)
      .eq('user_id', parsed.data.memberId)
    if (error) return unavailable()
    revalidatePath('/app/settings/members')
    revalidatePath('/app/account')
    return { ok: true, message: '멤버 권한을 저장했어요.' }
  } catch {
    return unavailable()
  }
}
