import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BusinessVerificationStep } from '../business-verification-step'

const fetchMock = vi.fn()

function verification(partial: Record<string, unknown>) {
  return {
    success: true,
    verification: {
      status: 'NOT_STARTED',
      isVerified: false,
      companyName: '',
      businessNumber: '',
      representativeName: '',
      startDate: '',
      rejectionReason: null,
      hasDocument: false,
      ...partial,
    },
  }
}

function routes(map: Record<string, (init?: RequestInit) => unknown>) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    const handler = map[`${init?.method ?? 'GET'} ${url}`]
    if (!handler) throw new Error(`unexpected request ${init?.method ?? 'GET'} ${url}`)
    const body = handler(init) as any
    return { ok: body.__status ? body.__status < 400 : true, status: body.__status ?? 200, json: async () => body }
  })
}

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

describe('BusinessVerificationStep', () => {
  it('처음에는 입력 폼을 보여주고, 모두 채우기 전에는 인증 요청 버튼이 꺼져 있다', async () => {
    routes({ 'GET /api/auth/business-verification': () => verification({}) })
    render(<BusinessVerificationStep onSubmitted={vi.fn()} />)
    expect(await screen.findByRole('heading', { name: '사업자 인증' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '인증 요청하기' })).toBeDisabled()
  })

  it('서류를 올리고 인증 요청하여 VERIFIED 응답이면 onSubmitted를 호출한다', async () => {
    const onSubmitted = vi.fn()
    routes({
      'GET /api/auth/business-verification': () => verification({}),
      'POST /api/auth/business-verification/document': () => ({ success: true, documentPath: 'ws/file.pdf' }),
      'POST /api/auth/business-verification': () => ({ success: true, verification: { status: 'VERIFIED' } }),
    })
    render(<BusinessVerificationStep onSubmitted={onSubmitted} />)
    await screen.findByRole('heading', { name: '사업자 인증' })

    fireEvent.change(screen.getByLabelText('사업자등록번호'), { target: { value: '0000000000' } })
    fireEvent.change(screen.getByLabelText('상호'), { target: { value: '모모 카페' } })
    fireEvent.change(screen.getByLabelText('대표자명'), { target: { value: '김소희' } })
    fireEvent.change(screen.getByLabelText(/개업일자/), { target: { value: '20240101' } })
    const file = new File(['%PDF-1.7'], 'license.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('사업자등록증 첨부'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: '인증 요청하기' }))

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1))
    const verifyCall = fetchMock.mock.calls.find(([url, init]) => url === '/api/auth/business-verification' && init?.method === 'POST')
    expect(JSON.parse(verifyCall![1].body)).toMatchObject({
      businessNumber: '0000000000',
      companyName: '모모 카페',
      representativeName: '김소희',
      documentPath: 'ws/file.pdf',
    })
  })

  it('서류를 올리고 인증 요청하여 PENDING 응답이면 화면에 머무르지 않고 onSubmitted를 호출한다', async () => {
    const onSubmitted = vi.fn()
    routes({
      'GET /api/auth/business-verification': () => verification({}),
      'POST /api/auth/business-verification/document': () => ({ success: true, documentPath: 'ws/file.pdf' }),
      'POST /api/auth/business-verification': () => ({ success: true, verification: { status: 'PENDING' } }),
    })
    render(<BusinessVerificationStep onSubmitted={onSubmitted} />)
    await screen.findByRole('heading', { name: '사업자 인증' })

    fireEvent.change(screen.getByLabelText('사업자등록번호'), { target: { value: '0000000000' } })
    fireEvent.change(screen.getByLabelText('상호'), { target: { value: '모모 카페' } })
    fireEvent.change(screen.getByLabelText('대표자명'), { target: { value: '김소희' } })
    fireEvent.change(screen.getByLabelText(/개업일자/), { target: { value: '20240101' } })
    const file = new File(['%PDF-1.7'], 'license.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('사업자등록증 첨부'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: '인증 요청하기' }))

    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1))
  })

  it('로드 시 PENDING이면 대기 패널과 다음으로 버튼을 보여주고 클릭 시 onSubmitted를 호출한다', async () => {
    const onSubmitted = vi.fn()
    routes({
      'GET /api/auth/business-verification': () =>
        verification({ status: 'PENDING', companyName: '모모 카페', businessNumber: '0000000000', representativeName: '김소희', hasDocument: true }),
    })
    render(<BusinessVerificationStep onSubmitted={onSubmitted} />)
    expect(await screen.findByText('신청이 접수됐어요')).toBeInTheDocument()
    expect(screen.getByText('승인 전에는 체험회원으로 시작할 수 있어요. 승인되면 모든 기능이 열려요.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '인증 요청하기' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '상태 새로고침' })).toBeInTheDocument()

    const nextButton = screen.getByRole('button', { name: '다음으로' })
    expect(nextButton).toBeInTheDocument()
    fireEvent.click(nextButton)
    expect(onSubmitted).toHaveBeenCalledTimes(1)
  })

  it('반려되면 사유와 함께 다시 제출할 수 있다', async () => {
    routes({
      'GET /api/auth/business-verification': () =>
        verification({ status: 'REJECTED', rejectionReason: '대표자명이 일치하지 않아요.', companyName: '모모 카페' }),
    })
    render(<BusinessVerificationStep onSubmitted={vi.fn()} />)
    expect(await screen.findByText('대표자명이 일치하지 않아요.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '인증 요청하기' })).toBeInTheDocument()
  })

  it('이미 인증되었으면 바로 onSubmitted를 호출한다', async () => {
    const onSubmitted = vi.fn()
    routes({ 'GET /api/auth/business-verification': () => verification({ status: 'VERIFIED', isVerified: true }) })
    render(<BusinessVerificationStep onSubmitted={onSubmitted} />)
    await waitFor(() => expect(onSubmitted).toHaveBeenCalledTimes(1))
  })

  it('개업일자 입력 아래에 사장님 안내 도움말이 보이고 aria-describedby로 연결된다', async () => {
    routes({ 'GET /api/auth/business-verification': () => verification({}) })
    render(<BusinessVerificationStep onSubmitted={vi.fn()} />)
    await screen.findByRole('heading', { name: '사업자 인증' })

    const input = screen.getByLabelText(/개업일자/)
    expect(input).toHaveAttribute('aria-describedby', 'biz-start-hint')
    const hint = screen.getByText(/사업자등록증에 적힌 '개업연월일'이에요/)
    expect(hint).toHaveAttribute('id', 'biz-start-hint')
    expect(hint).toHaveTextContent("사업자등록증에 적힌 '개업연월일'이에요. 입력하면 국세청에서 바로 확인돼서 심사가 빨라져요.")
  })
})
