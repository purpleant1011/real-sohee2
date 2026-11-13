import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { CatalogEditor } from './catalog-editor'
import type { CatalogServiceView } from './catalog-service'

const WS = '11111111-1111-4111-8111-111111111111'

const readyService: CatalogServiceView = {
  id: 's1', workspaceId: WS, name: '속눈썹 연장', price: 45000, durationMinutes: 90,
  resourceName: '원장', cancellationPolicy: '24시간 전까지 무료', validFrom: null, validUntil: null,
  active: true, updatedAt: '2026-10-20T00:00:00.000Z', knowledgeFactId: null,
  readiness: { ready: true, missing: [] },
}
const noDuration: CatalogServiceView = {
  ...readyService, id: 's2', name: '속눈썹 리터치', durationMinutes: null,
  readiness: { ready: false, missing: ['DURATION'] },
}

const jsonResponse = (body: unknown, status = 200) =>
  Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response)

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

const newForm = () => within(screen.getByRole('form', { name: '새 서비스 추가' }))

function fillNewService(values: { name?: string; price?: string; duration?: string }) {
  const form = newForm()
  if (values.name !== undefined) fireEvent.change(form.getByLabelText('서비스명'), { target: { value: values.name } })
  if (values.price !== undefined) fireEvent.change(form.getByLabelText('가격(원)'), { target: { value: values.price } })
  if (values.duration !== undefined) fireEvent.change(form.getByLabelText('소요시간(분)'), { target: { value: values.duration } })
}

describe('CatalogEditor', () => {
  it('서비스가 없으면 빈 상태를 숨기지 않고 먼저 입력하라고 안내한다', () => {
    render(<CatalogEditor workspaceId={WS} canEdit initialServices={[]} />)
    expect(screen.getByText(/등록된 서비스가 없어요/)).toBeTruthy()
    expect(screen.getByRole('button', { name: '서비스 추가' })).toBeTruthy()
  })

  it('소요시간이 없는 서비스에는 예약 확정에 필요하다고 알린다', () => {
    render(<CatalogEditor workspaceId={WS} canEdit initialServices={[noDuration]} />)
    expect(screen.getByText('소요시간을 입력해야 예약 확정에 쓸 수 있어요')).toBeTruthy()
  })

  it('준비가 끝난 서비스에는 경고를 띄우지 않고 입력값을 그대로 보여준다', () => {
    render(<CatalogEditor workspaceId={WS} canEdit initialServices={[readyService]} />)
    expect(screen.getByText('속눈썹 연장')).toBeTruthy()
    expect(screen.getByText(/45,000원/)).toBeTruthy()
    expect(screen.getByText(/90분/)).toBeTruthy()
    expect(screen.queryByText(/예약 확정에 쓸 수 없어요/)).toBeNull()
  })

  it('사장님이 입력한 값만 보내고 빈 칸은 null로 보낸다(AI가 채우지 않는다)', async () => {
    vi.mocked(fetch).mockReturnValue(jsonResponse({ service: { ...readyService, id: 's3', name: '컷' }, factSync: { status: 'SKIPPED_INCOMPLETE' } }, 201))
    render(<CatalogEditor workspaceId={WS} canEdit initialServices={[]} />)
    fillNewService({ name: '컷' })
    fireEvent.click(screen.getByRole('button', { name: '서비스 추가' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toBe(`/api/workspaces/${WS}/service-catalog`)
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      name: '컷', price: null, durationMinutes: null, resourceName: null,
      cancellationPolicy: null, validFrom: null, validUntil: null, active: true,
    })
  })

  it('저장에 성공하면 서버가 돌려준 값으로 목록을 갱신한다', async () => {
    vi.mocked(fetch).mockReturnValue(jsonResponse({
      service: { ...readyService, id: 's3', name: '새 서비스' }, factSync: { status: 'SYNCED', factId: 'f1' },
    }, 201))
    render(<CatalogEditor workspaceId={WS} canEdit initialServices={[]} />)
    fillNewService({ name: '새 서비스', price: '30000', duration: '60' })
    fireEvent.click(screen.getByRole('button', { name: '서비스 추가' }))
    expect(await screen.findByText('새 서비스')).toBeTruthy()
    expect(screen.getByText(/저장했어요/)).toBeTruthy()
  })

  it('저장에 실패하면 실패를 숨기지 않고 목록도 바꾸지 않는다', async () => {
    vi.mocked(fetch).mockReturnValue(jsonResponse({ error: '서비스명을 입력해 주세요.' }, 422))
    render(<CatalogEditor workspaceId={WS} canEdit initialServices={[]} />)
    fillNewService({ name: '실패 서비스' })
    fireEvent.click(screen.getByRole('button', { name: '서비스 추가' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '서비스명을 입력해 주세요.')
    expect(screen.queryByText('실패 서비스')).toBeNull()
  })

  it('소요시간 0분은 서버로 보내지 않고 그 자리에서 막는다', async () => {
    render(<CatalogEditor workspaceId={WS} canEdit initialServices={[]} />)
    fillNewService({ name: '컷', duration: '0' })
    fireEvent.click(screen.getByRole('button', { name: '서비스 추가' }))
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', '소요시간은 1분 이상 1,440분 이하로 입력해 주세요.')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('수정할 때는 읽은 버전을 함께 보내 덮어쓰기를 막는다', async () => {
    vi.mocked(fetch).mockReturnValue(jsonResponse({
      service: { ...readyService, price: 50000, updatedAt: '2026-10-22T10:00:00.000Z' },
      factSync: { status: 'SYNCED', factId: 'f1' }, slotsRequiringReconfirmation: 2,
    }))
    render(<CatalogEditor workspaceId={WS} canEdit initialServices={[readyService]} />)
    fireEvent.click(screen.getByRole('button', { name: '속눈썹 연장 수정' }))
    const editForm = within(screen.getByRole('form', { name: '속눈썹 연장 수정' }))
    fireEvent.change(editForm.getByLabelText('가격(원)'), { target: { value: '50000' } })
    fireEvent.click(editForm.getByRole('button', { name: '저장' }))
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toBe(`/api/workspaces/${WS}/service-catalog/s1`)
    expect((init as RequestInit).method).toBe('PATCH')
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      expectedUpdatedAt: '2026-10-20T00:00:00.000Z', price: 50000,
    })
    expect(await screen.findByText(/예약 가능 시간 2개를 다시 확인/)).toBeTruthy()
  })

  it('충돌(409)이면 최신 내용을 다시 확인하라고 알린다', async () => {
    vi.mocked(fetch).mockReturnValue(jsonResponse({ error: '다른 곳에서 먼저 수정됐어요. 최신 내용을 확인한 뒤 다시 저장해 주세요.' }, 409))
    render(<CatalogEditor workspaceId={WS} canEdit initialServices={[readyService]} />)
    fireEvent.click(screen.getByRole('button', { name: '속눈썹 연장 수정' }))
    fireEvent.click(within(screen.getByRole('form', { name: '속눈썹 연장 수정' })).getByRole('button', { name: '저장' }))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      '다른 곳에서 먼저 수정됐어요. 최신 내용을 확인한 뒤 다시 저장해 주세요.',
    )
  })

  it('사실 동기화가 실패하면 저장은 됐더라도 그 실패를 따로 알린다', async () => {
    vi.mocked(fetch).mockReturnValue(jsonResponse({
      service: readyService, factSync: { status: 'FAILED', message: 'fact db down' }, slotsRequiringReconfirmation: 0,
    }))
    render(<CatalogEditor workspaceId={WS} canEdit initialServices={[readyService]} />)
    fireEvent.click(screen.getByRole('button', { name: '속눈썹 연장 수정' }))
    fireEvent.click(within(screen.getByRole('form', { name: '속눈썹 연장 수정' })).getByRole('button', { name: '저장' }))
    expect(await screen.findByText(/가게 정보\(사실\) 반영에 실패했어요/)).toBeTruthy()
  })

  it('조회 권한만 있으면 입력·수정 버튼을 감춘다', () => {
    render(<CatalogEditor workspaceId={WS} canEdit={false} initialServices={[readyService]} />)
    expect(screen.queryByRole('button', { name: '서비스 추가' })).toBeNull()
    expect(screen.queryByRole('button', { name: '속눈썹 연장 수정' })).toBeNull()
    expect(screen.getByText(/조회만 할 수 있어요/)).toBeTruthy()
  })

  it('적용 시작/종료일은 ISO 문자열을 숨기고 date 입력으로 받아 서버 전송 시 ISO로 변환한다', async () => {
    vi.mocked(fetch).mockReturnValue(jsonResponse({ service: { ...readyService, id: 's4' }, factSync: { status: 'SKIPPED_INCOMPLETE' } }, 201))
    render(<CatalogEditor workspaceId={WS} canEdit initialServices={[]} />)

    // ISO 문자열과 기술 안내가 없어야 함
    expect(screen.queryByText(/적용 시작\(ISO\)/)).toBeNull()
    expect(screen.queryByText(/예: 2026-11-01T00:00:00\+09:00/)).toBeNull()

    const fromInput = screen.getByLabelText('적용 시작일')
    expect(fromInput).toHaveAttribute('type', 'date')

    fillNewService({ name: '시즌 메뉴' })
    fireEvent.change(fromInput, { target: { value: '2026-11-01' } })
    fireEvent.click(screen.getByRole('button', { name: '서비스 추가' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1))
    const [, init] = vi.mocked(fetch).mock.calls[0]
    const body = JSON.parse(String((init as RequestInit).body))
    expect(body.validFrom).toMatch(/^2026-11-01T/)
  })
})
