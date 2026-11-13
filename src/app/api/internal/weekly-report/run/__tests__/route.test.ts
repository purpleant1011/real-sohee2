import { beforeEach, describe, expect, it, vi } from 'vitest'
import { POST } from '../route'

const { createAdmin, generate } = vi.hoisted(() => ({ createAdmin: vi.fn(), generate: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createAdminSupabaseClient: createAdmin }))
vi.mock('@/features/reporting/weekly-ceo-report-service', () => ({ WeeklyCeoReportService: class { generateReport = generate } }))
const secret = 'cron-secret-12345678901234567890'
const request = (authorized = true) => new Request('https://example.test/api/internal/weekly-report/run', {
  method: 'POST', headers: { authorization: `Bearer ${authorized ? secret : 'wrong'}` },
})
function workspaces(result: unknown) {
  createAdmin.mockReturnValue({ from: () => ({ select: () => ({ limit: async () => result }) }) })
}
beforeEach(() => {
  vi.clearAllMocks()
  process.env.CRON_SECRET = secret
  generate.mockResolvedValue({ datasetMode: 'ACTUAL', metrics: { bookingConfirmed: { state: 'OBSERVED', value: 0 } } })
})

describe('weekly report computation cron', () => {
  it('rejects an unauthorized request before data access', async () => {
    expect((await POST(request(false))).status).toBe(404)
    expect(createAdmin).not.toHaveBeenCalled()
  })
  it('keeps workspace query failure distinct from an empty batch', async () => {
    workspaces({ data: null, error: { message: 'SECRET database details' } })
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain('SECRET')
    expect(generate).not.toHaveBeenCalled()
  })
  it('reports a genuinely empty batch without inventing reports', async () => {
    workspaces({ data: [], error: null })
    const response = await POST(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ workspacesProcessed: 0, reportsComputed: 0, deliveryState: 'NOT_SENT' })
  })
  it('reports computation separately from storage or delivery', async () => {
    workspaces({ data: [{ id: 'ws-a' }, { id: 'ws-b' }], error: null })
    const response = await POST(request())
    expect(await response.json()).toMatchObject({ reportsComputed: 2, reportsFailed: 0, deliveryState: 'NOT_SENT' })
  })
  it('does not count reports containing query errors as successful computations', async () => {
    workspaces({ data: [{ id: 'ws-a' }], error: null })
    generate.mockResolvedValue({ datasetMode: 'ACTUAL', metrics: { bookingConfirmed: { state: 'ERROR', value: null } } })
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ success: false, reportsComputed: 0, reportsFailed: 1 })
  })
  it('excludes non-actual workspaces from the actual report count', async () => {
    workspaces({ data: [{ id: 'ws-test' }], error: null })
    generate.mockResolvedValue({ datasetMode: 'EXCLUDED', metrics: {} })
    const response = await POST(request())
    expect(await response.json()).toMatchObject({ reportsComputed: 0, reportsSkipped: 1, deliveryState: 'NOT_SENT' })
  })
})
