import { z } from 'zod'
import type { ServerSupabaseClient } from '@/features/operations/types'
import { workspaceBusinessContextSchema, type WorkspaceBusinessContext } from './workspace-business-context'
import { isKnowledgeFactCurrent } from './knowledge-validity'

const uuid = z.string().uuid()
const businessSchema = z.object({ workspace_id: uuid, business_name: z.string(), industry: z.string().nullable(), location: z.string().nullable(), summary: z.string().nullable(), operating_hours: z.unknown().optional() })
const brandSchema = z.object({ workspace_id: uuid, voice: z.string().nullable(), keywords: z.array(z.string()), prohibited_terms: z.array(z.string()) })
const serviceSchema = z.object({ id: uuid, workspace_id: uuid, name: z.string(), price: z.number().finite().nonnegative().nullable(), duration_minutes: z.number().int().positive().nullable(), cancellation_policy: z.string().nullable(), valid_from: z.string().datetime({ offset: true }).nullable(), valid_until: z.string().datetime({ offset: true }).nullable(), active: z.boolean(), updated_at: z.string().datetime({ offset: true }) })

/** Caller validates actor/thread/worker; privileged reads still verify every returned tenant. */
export async function loadWorkspaceBusinessContext(input: { client: ServerSupabaseClient; workspaceId: string }): Promise<WorkspaceBusinessContext> {
  const workspaceId = uuid.parse(input.workspaceId)
  // Optional profile columns in generated types may not exist in the deployed schema.
  const [businessResult, brandResult, serviceResult] = await Promise.all([
    input.client.from('business_profiles').select('workspace_id,business_name,industry,location,summary').eq('workspace_id', workspaceId).maybeSingle(),
    input.client.from('brand_profiles').select('workspace_id,voice,keywords,prohibited_terms').eq('workspace_id', workspaceId).maybeSingle(),
    input.client.from('workspace_products_services').select('id,workspace_id,name,price,duration_minutes,cancellation_policy,valid_from,valid_until,active,updated_at')
      .eq('workspace_id', workspaceId).eq('active', true).order('updated_at', { ascending: false }).limit(26),
  ])
  const business = businessSchema.nullable().safeParse(businessResult.data)
  const brand = brandSchema.nullable().safeParse(brandResult.data)
  const services = z.array(serviceSchema).safeParse(serviceResult.data)
  if (businessResult.error || brandResult.error || serviceResult.error || !business.success || !brand.success || !services.success) throw new Error('WORKSPACE_BUSINESS_CONTEXT_UNAVAILABLE')
  if ((business.data && business.data.workspace_id !== workspaceId) || (brand.data && brand.data.workspace_id !== workspaceId)
    || services.data.some(service => service.workspace_id !== workspaceId)) throw new Error('WORKSPACE_BUSINESS_CONTEXT_SCOPE_MISMATCH')
  let truncated = services.data.length > 25
  const text = (value: string | null, max: number) => { if (value === null) return null; if (value.length > max) truncated = true; return value.slice(0, max) }
  const terms = (values: string[], max: number) => { if (values.length > max) truncated = true; return values.slice(0, max).map(value => text(value, 100)!) }
  const projectedBusiness = business.data ? { name: text(business.data.business_name, 200)!, industry: text(business.data.industry, 200), location: text(business.data.location, 1000), summary: text(business.data.summary, 4000),
    operatingHours: text(business.data.operating_hours == null ? null : typeof business.data.operating_hours === 'string' ? business.data.operating_hours : JSON.stringify(business.data.operating_hours), 3000) } : null
  const projectedBrand = brand.data ? { voice: text(brand.data.voice, 1500), keywords: terms(brand.data.keywords, 30), prohibitedTerms: terms(brand.data.prohibited_terms, 50) } : null
  const observedAt = new Date().toISOString()
  const projectedServices = services.data.filter(service => service.active && isKnowledgeFactCurrent({ validFrom: service.valid_from, validUntil: service.valid_until }, observedAt)).slice(0, 25)
    .map(service => ({ id: service.id, name: text(service.name, 200)!, price: service.price, durationMinutes: service.duration_minutes,
      cancellationPolicy: text(service.cancellation_policy, 1500), version: service.updated_at, validFrom: service.valid_from, validUntil: service.valid_until }))
  return workspaceBusinessContextSchema.parse({ workspaceId, business: projectedBusiness, brand: projectedBrand, services: projectedServices, truncated })
}
