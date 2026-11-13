// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  membership: vi.fn(),
  auditCount: vi.fn(),
  auditInsert: vi.fn(),
  analyze: vi.fn(),
  artifact: vi.fn(),
  upload: vi.fn(),
  confirm: vi.fn(),
  mediaSelect: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUser },
    from: () => { const q: Record<string, unknown> = {}; q.select = () => q; q.eq = () => q; q.maybeSingle = mocks.membership; return q },
  })),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => {
      const q: Record<string, unknown> = {}
      q.select = () => q
      q.eq = () => q
      q.gte = () => mocks.auditCount()
      q.insert = (row: unknown) => mocks.auditInsert(row)
      q.update = () => q
      q.maybeSingle = () => mocks.confirm()
      q.in = () => {
        if (table === 'media_assets') return mocks.mediaSelect()
        return Promise.resolve({ data: [], error: null })
      }
      return q
    },
  }),
}))
vi.mock('@/lib/supabase/validated-upload', () => ({ uploadValidatedPrivateFile: mocks.upload }))
vi.mock('@/lib/supabase/validated-upload-repository', () => ({ createValidatedUploadRepository: () => ({}) }))
vi.mock('../reference-style-analysis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../reference-style-analysis')>()),
  analyzeReferenceImages: mocks.analyze,
}))
vi.mock('@/features/chat/conversation-image-generation.server', () => ({
  createProductionConversationImageArtifact: mocks.artifact,
}))

import { analyzeReferenceImagesAction, previewImageStyleAction } from './image-style-training'

const workspaceId = '20000000-0000-4000-8000-000000000001'
const userId = '10000000-0000-4000-8000-000000000001'

function formWith(files: File[], rights = 'true') {
  const form = new FormData()
  form.set('workspaceId', workspaceId)
  form.set('rightsAcknowledged', rights)
  for (const file of files) form.append('files', file)
  return form
}
const png = () => new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null })
  mocks.membership.mockResolvedValue({ data: { role: 'owner', status: 'active' }, error: null })
  mocks.auditCount.mockResolvedValue({ count: 0, error: null })
  mocks.auditInsert.mockResolvedValue({ error: null })
  mocks.analyze.mockResolvedValue({ subject: '카페', mood: '', setting: '', lookAndColor: '', people: 'none', avoid: '', extra: '', notes: ['여성 정면', '남성 정면'], analysis: '아이레벨' })
  mocks.upload.mockResolvedValue({ ok: true })
  mocks.confirm.mockImplementation(async () => ({ data: { id: 'ignored' }, error: null }))
  mocks.artifact.mockResolvedValue({ id: 'a1', previewUrl: '/api/workspaces/w/media/a1' })
  mocks.mediaSelect.mockResolvedValue({ data: [], error: null })
})

describe('analyzeReferenceImagesAction', () => {
  it('requires the rights acknowledgement and valid files before calling the model', async () => {
    await expect(analyzeReferenceImagesAction(formWith([png()], 'false'))).resolves.toMatchObject({ error: { message: expect.stringContaining('사용할 수 있는') } })
    await expect(analyzeReferenceImagesAction(formWith([]))).resolves.toMatchObject({ error: { message: expect.stringContaining('1장') } })
    expect(mocks.analyze).not.toHaveBeenCalled()
  })
  it('analyzes the photos for an owner and records usage', async () => {
    const result = await analyzeReferenceImagesAction(formWith([png(), png()]))
    expect(result.data?.form).toMatchObject({ subject: '카페' })
    expect(result.data?.references).toHaveLength(2)
    expect(result.data?.references[0]).toMatchObject({ id: expect.stringMatching(/^[0-9a-f-]{36}$/), url: expect.stringContaining(`/api/workspaces/${workspaceId}/media/`), note: '여성 정면' })
    expect(result.data?.references[1]).toMatchObject({ note: '남성 정면' })
    expect(result.data?.form).toMatchObject({ analysis: '아이레벨' })
    expect(mocks.upload).toHaveBeenCalledTimes(2)
    expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, userId, bucket: 'content-media', role: 'owner' }), expect.anything())
    expect(mocks.analyze).toHaveBeenCalledWith([expect.objectContaining({ mimeType: 'image/png' }), expect.objectContaining({ mimeType: 'image/png' })])
    expect(mocks.auditInsert).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'image_style_analysis', workspace_id: workspaceId }))
  })
  it('still returns the style when storing the photos fails (references just stay empty)', async () => {
    mocks.upload.mockResolvedValue({ ok: false })
    const result = await analyzeReferenceImagesAction(formWith([png()]))
    expect(result.data?.form).toMatchObject({ subject: '카페' })
    expect(result.data?.references).toEqual([])
  })
  it('blocks viewers and reports a safe error when analysis fails', async () => {
    mocks.membership.mockResolvedValueOnce({ data: { role: 'viewer', status: 'active' }, error: null })
    await expect(analyzeReferenceImagesAction(formWith([png()]))).resolves.toMatchObject({ error: { message: expect.stringContaining('소유자') } })
    mocks.analyze.mockRejectedValueOnce(new Error('REFERENCE_ANALYSIS_UNAVAILABLE'))
    await expect(analyzeReferenceImagesAction(formWith([png()]))).resolves.toMatchObject({ error: { message: expect.stringContaining('읽지 못했') } })
  })
})

describe('previewImageStyleAction', () => {
  const input = { workspaceId, subject: '카페 라떼', mood: '', setting: '', lookAndColor: '', people: 'none', avoid: '', extra: '' }

  it('generates one draft from the unsaved form values', async () => {
    await expect(previewImageStyleAction(input)).resolves.toEqual({ data: { assetId: 'a1', previewUrl: '/api/workspaces/w/media/a1', remainingToday: 5 } })
    expect(mocks.artifact).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId, userId, channel: 'instagram',
      workspaceStyleOverride: expect.objectContaining({ subject: '카페 라떼' }),
    }))
    expect(mocks.auditInsert).toHaveBeenCalledWith(expect.objectContaining({ event_type: 'image_style_preview' }))
  })
  it('uses the test scene as the prompt and passes the draft references', async () => {
    const refId = '30000000-0000-4000-8000-000000000001'
    mocks.mediaSelect.mockResolvedValueOnce({ data: [{ id: refId }], error: null })
    await previewImageStyleAction({ ...input, scene: '봄 신상 파스텔 네일', guide: '제품은 오른쪽', composition: '정면', references: [refId], referenceNotes: { [refId]: '여성 정면' } })
    expect(mocks.artifact).toHaveBeenCalledWith(expect.objectContaining({
      prompt: expect.stringContaining('봄 신상 파스텔 네일'),
      workspaceStyleOverride: expect.objectContaining({ guide: '제품은 오른쪽', composition: '정면', referenceAssetIds: [refId], referenceNotes: { [refId]: '여성 정면' } }),
    }))
  })
  it('rejects reference photos from other workspaces or without confirmed rights', async () => {
    const foreignRef = '30000000-0000-4000-8000-000000000099'
    mocks.mediaSelect.mockResolvedValueOnce({ data: [], error: null })
    const result = await previewImageStyleAction({ ...input, references: [foreignRef] })
    expect(result).toMatchObject({ error: { message: expect.stringContaining('기준 사진') } })
    expect(mocks.artifact).not.toHaveBeenCalled()
  })
  it('rejects when media query returns null data without treating it as empty array', async () => {
    const ref = '30000000-0000-4000-8000-000000000001'
    mocks.mediaSelect.mockResolvedValueOnce({ data: null, error: null })
    const result = await previewImageStyleAction({ ...input, references: [ref] })
    expect(result).toMatchObject({ error: { message: expect.stringContaining('기준 사진') } })
    expect(mocks.artifact).not.toHaveBeenCalled()
  })
  it('stops at the daily limit without generating', async () => {
    mocks.auditCount.mockResolvedValue({ count: 6, error: null })
    await expect(previewImageStyleAction(input)).resolves.toMatchObject({ error: { message: expect.stringContaining('시안') } })
    expect(mocks.artifact).not.toHaveBeenCalled()
  })
  it('rejects an empty style and reports generation failures safely', async () => {
    await expect(previewImageStyleAction({ ...input, subject: '' })).resolves.toMatchObject({ error: { message: expect.stringContaining('한 가지') } })
    mocks.artifact.mockRejectedValueOnce(new Error('boom'))
    await expect(previewImageStyleAction(input)).resolves.toMatchObject({ error: { message: expect.stringContaining('시안을 만들지 못했') } })
  })
})
