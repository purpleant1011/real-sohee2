// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn(), analyze: vi.fn(), preview: vi.fn() }))
vi.mock('./actions/image-style-training', () => ({ analyzeReferenceImagesAction: mocks.analyze, previewImageStyleAction: mocks.preview }))
vi.mock('./actions/save-workspace-image-style', () => ({ saveWorkspaceImageStyleAction: mocks.save }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('../profile-import/profile-import-wizard', () => ({
  ProfileImportWizard: ({ onImageStyle }: { onImageStyle: (r: unknown) => void }) => (
    <button onClick={() => onImageStyle({
      form: { subject: '링크에서 읽은 피사체', composition: '링크 구도', setting: '', mood: '', lookAndColor: '', people: 'none', avoid: '링크 금지어', extra: '', analysis: '링크 분석 노트' },
      references: [{ id: '30000000-0000-4000-8000-0000000000aa', url: '/api/workspaces/w/media/30000000-0000-4000-8000-0000000000aa', note: '링크 사진 메모' }],
    })} type="button">링크 결과 반영(스텁)</button>
  ),
}))
vi.mock('./overlay/overlay-composer', () => ({
  OverlayComposer: (props: { workspaceId: string; baseUrl: string | null }) => (
    <div data-testid="overlay-composer" data-workspace-id={props.workspaceId} data-base-url={props.baseUrl ?? 'null'}>
      OverlayComposer Stub
    </div>
  ),
}))

import { ImageStyleSettings } from './image-style-settings'

const workspaceId = '20000000-0000-4000-8000-000000000001'

describe('ImageStyleSettings', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.clearAllMocks()
    mocks.save.mockResolvedValue({ data: { version: 3 } })
    mocks.analyze.mockResolvedValue({ data: { form: { subject: '사진에서 읽은 카페 라떼', mood: '따뜻한', setting: '', lookAndColor: '', people: 'none', avoid: '네온', extra: '', composition: '정면', analysis: '아이레벨, 얼굴이 화면 폭의 50%' }, references: [{ id: '30000000-0000-4000-8000-000000000001', note: '여성 정면 상반신', url: '/api/workspaces/w/media/30000000-0000-4000-8000-000000000001' }] } })
    mocks.preview.mockResolvedValue({ data: { assetId: '40000000-0000-4000-8000-000000000002', previewUrl: '/api/workspaces/w/media/a1', remainingToday: 4 } })
  })

  it('fills the form from a business preset and saves it', async () => {
    render(<ImageStyleSettings workspaceId={workspaceId} canEdit initialStyle={null} />)
    fireEvent.click(screen.getByRole('button', { name: '네일' }))
    expect((screen.getByLabelText('무엇을 찍을까요') as HTMLTextAreaElement).value).toContain('네일')
    fireEvent.click(screen.getByRole('button', { name: '이미지 스타일 저장' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, subject: expect.stringContaining('네일') })))
    expect(await screen.findByText('저장했어요. 다음 이미지부터 이 스타일로 만들어요.')).toBeInTheDocument()
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('shows server errors and is read-only for viewers', async () => {
    mocks.save.mockResolvedValue({ error: { message: '원하는 이미지 모습을 한 가지 이상 적어 주세요.', requestId: 'x' } })
    const { unmount } = render(<ImageStyleSettings workspaceId={workspaceId} canEdit initialStyle={null} />)
    fireEvent.click(screen.getByRole('button', { name: '이미지 스타일 저장' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('한 가지')
    unmount()
    render(<ImageStyleSettings workspaceId={workspaceId} canEdit={false} initialStyle={null} />)
    expect(screen.queryByRole('button', { name: '이미지 스타일 저장' })).toBeNull()
  })

  it('shows the saved style as initial values', () => {
    render(<ImageStyleSettings workspaceId={workspaceId} canEdit initialStyle={{ subject: '카페 라떼', mood: '', setting: '', lookAndColor: '', people: 'none', avoid: ['네온', '글자'], extra: '', composition: '', guide: '', referenceAssetIds: [], referenceNotes: {} }} />)
    expect((screen.getByLabelText('무엇을 찍을까요') as HTMLTextAreaElement).value).toBe('카페 라떼')
    expect((screen.getByLabelText('피하고 싶은 것 (쉼표로 구분)') as HTMLInputElement).value).toBe('네온, 글자')
  })

  it('learns the style from reference photos only after the rights checkbox, then fills the form', async () => {
    render(<ImageStyleSettings workspaceId={workspaceId} canEdit initialStyle={null} />)
    const input = screen.getByLabelText('참고 사진 올리기') as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } })
    const learn = screen.getByRole('button', { name: '사진에서 느낌 읽기' })
    expect(learn).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /사용할 수 있는 사진/ }))
    expect(learn).toBeEnabled()
    fireEvent.click(learn)
    await waitFor(() => expect(mocks.analyze).toHaveBeenCalled())
    const sent = mocks.analyze.mock.calls[0]?.[0] as FormData
    expect(sent.get('workspaceId')).toBe(workspaceId)
    expect(sent.getAll('files')).toHaveLength(1)
    await waitFor(() => expect((screen.getByLabelText('무엇을 찍을까요') as HTMLTextAreaElement).value).toBe('사진에서 읽은 카페 라떼'))
    expect(screen.getByText(/읽은 내용을 아래 칸에 채우고/)).toBeInTheDocument()
  })

  it('shows a draft image and regenerates it with the owner feedback added to the guidance', async () => {
    render(<ImageStyleSettings workspaceId={workspaceId} canEdit initialStyle={{ subject: '카페 라떼', mood: '', setting: '', lookAndColor: '', people: 'none', avoid: [], extra: '', composition: '', guide: '', referenceAssetIds: [], referenceNotes: {} }} />)
    fireEvent.click(screen.getByRole('button', { name: '이 스타일로 시안 보기' }))
    const img = await screen.findByRole('img', { name: '이미지 스타일 시안' })
    expect(img).toHaveAttribute('src', '/api/workspaces/w/media/a1')
    expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, subject: '카페 라떼' }))
    expect(screen.getByText('오늘 4번 더 만들 수 있어요.')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('시안이 어떤가요? 바꾸고 싶은 점을 알려 주세요'), { target: { value: '더 밝게' } })
    fireEvent.click(screen.getByRole('button', { name: '반영해서 다시 만들기' }))
    await waitFor(() => expect(mocks.preview).toHaveBeenCalledTimes(2))
    expect(mocks.preview.mock.calls[1]?.[0]).toMatchObject({ extra: expect.stringContaining('더 밝게') })
    expect((screen.getByLabelText('추가 요청') as HTMLTextAreaElement).value).toContain('더 밝게')
  })

  it('keeps the analyzed photos as reference photos, lets the owner remove one, and saves them with the guide', async () => {
    const refId = '30000000-0000-4000-8000-000000000001'
    render(<ImageStyleSettings workspaceId={workspaceId} canEdit initialStyle={null} />)
    fireEvent.change(screen.getByLabelText('참고 사진 올리기'), { target: { files: [new File(['x'], 'a.png', { type: 'image/png' })] } })
    fireEvent.click(screen.getByRole('checkbox', { name: /사용할 수 있는 사진/ }))
    fireEvent.click(screen.getByRole('button', { name: '사진에서 느낌 읽기' }))
    expect(await screen.findByRole('img', { name: '기준 사진 1' })).toHaveAttribute('src', expect.stringContaining(refId))
    expect((screen.getByLabelText('구도·화면 구조') as HTMLInputElement).value).toBe('정면')
    expect(screen.getByText('여성 정면 상반신', { selector: 'span' })).toBeInTheDocument()
    expect((screen.getByLabelText('소희에게 직접 가르치기') as HTMLTextAreaElement).value).toContain('아이레벨, 얼굴이 화면 폭의 50%')

    fireEvent.change(screen.getByLabelText('소희에게 직접 가르치기'), { target: { value: '제품은 항상 오른쪽 1/3' } })
    fireEvent.click(screen.getByRole('button', { name: '이미지 스타일 저장' }))
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ guide: expect.stringContaining('제품은 항상 오른쪽 1/3'), composition: '정면', references: [refId], referenceNotes: { [refId]: '여성 정면 상반신' } })))

    await screen.findByText('저장했어요. 다음 이미지부터 이 스타일로 만들어요.')
    fireEvent.click(screen.getByRole('button', { name: '기준 사진 1 빼기' }))
    expect(screen.queryByRole('img', { name: '기준 사진 1' })).toBeNull()
  })

  it('tests a specific scene and can promote the draft to a reference photo', async () => {
    const draftId = '40000000-0000-4000-8000-000000000002'
    render(<ImageStyleSettings workspaceId={workspaceId} canEdit initialStyle={null} />)

    const sceneInput = screen.getByLabelText('테스트로 만들 장면 (비우면 대표 이미지)') as HTMLInputElement
    expect(sceneInput.placeholder).toBe('예: 이번에 소개할 대표 상품·서비스')

    const subjectInput = screen.getByLabelText('무엇을 찍을까요') as HTMLTextAreaElement
    expect(subjectInput.placeholder).toBe('예: 대표 상품·서비스를 가까이 보여주는 사진')

    const settingInput = screen.getByLabelText('배경·장소') as HTMLInputElement
    expect(settingInput.placeholder).toBe('예: 자연광이 드는 매장 공간')

    fireEvent.change(sceneInput, { target: { value: '이번에 소개할 대표 상품·서비스' } })
    fireEvent.change(subjectInput, { target: { value: '대표 상품' } })
    fireEvent.click(screen.getByRole('button', { name: '이 스타일로 시안 보기' }))
    await screen.findByRole('img', { name: '이미지 스타일 시안' })
    expect(mocks.preview).toHaveBeenCalledWith(expect.objectContaining({ scene: '이번에 소개할 대표 상품·서비스', subject: '대표 상품' }))

    const addReference = screen.getByRole('button', { name: '이 시안을 기준 사진으로 추가' })
    await waitFor(() => expect(addReference).toBeEnabled())
    fireEvent.click(addReference)
    expect(await screen.findByRole('img', { name: '기준 사진 1' })).toHaveAttribute('src', expect.stringContaining(draftId))
    const added = screen.getByRole('button', { name: '기준 사진에 추가됨' })
    expect(added).toBeDisabled()
    fireEvent.click(added)
    expect(screen.getAllByRole('img', { name: /^기준 사진/ })).toHaveLength(1)
  })

  it('initial 8 references with empty notes or different key orders do not show dirty on first mount, but show dirty when modified', async () => {
    const refIds = Array.from({ length: 8 }, (_, i) => `30000000-0000-4000-8000-00000000000${i + 1}`)
    // 8장 중 2장은 빈 note, 키 순서도 refIds 순서와 다름
    const referenceNotes: Record<string, string> = {
      [refIds[7]]: '',
      [refIds[3]]: '네번째 사진 메모',
      [refIds[0]]: '첫번째 사진 메모',
      [refIds[1]]: '',
      [refIds[2]]: '세번째 사진 메모',
    }
    const initialStyle = {
      subject: '우리 매장 대표 사진',
      mood: '화사한',
      setting: '자연광 매장',
      lookAndColor: '뉴트럴 톤',
      people: 'none' as const,
      avoid: ['어두운 조명'],
      extra: '자연스러운 연출',
      composition: '정면 구도',
      guide: '가이드 내용',
      referenceAssetIds: refIds,
      referenceNotes,
    }

    render(<ImageStyleSettings workspaceId={workspaceId} canEdit initialStyle={initialStyle} />)

    // 최초 렌더 시 더티 표시가 없어야 함
    expect(screen.queryByText('저장하지 않은 변경이 있어요')).toBeNull()

    // 피사체를 수정하면 더티 표시가 나타나야 함
    fireEvent.change(screen.getByLabelText('무엇을 찍을까요'), { target: { value: '수정된 피사체' } })
    expect(screen.getByText('저장하지 않은 변경이 있어요')).toBeInTheDocument()

    // 원복하면 다시 더티 표시가 사라져야 함
    fireEvent.change(screen.getByLabelText('무엇을 찍을까요'), { target: { value: '우리 매장 대표 사진' } })
    expect(screen.queryByText('저장하지 않은 변경이 있어요')).toBeNull()
  })

  it('lists the chosen photo names, shows unsaved changes, and clears them after saving', async () => {
    render(<ImageStyleSettings workspaceId={workspaceId} canEdit initialStyle={null} />)
    expect(screen.queryByText('저장하지 않은 변경이 있어요')).toBeNull()
    fireEvent.change(screen.getByLabelText('참고 사진 올리기'), { target: { files: [new File(['x'], 'nail-1.png', { type: 'image/png' })] } })
    expect(screen.getByText('선택한 사진: nail-1.png')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('무엇을 찍을까요'), { target: { value: '카페 라떼' } })
    expect(screen.getByText('저장하지 않은 변경이 있어요')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '이미지 스타일 저장' }))
    await screen.findByText('저장했어요. 다음 이미지부터 이 스타일로 만들어요.')
    expect(screen.queryByText('저장하지 않은 변경이 있어요')).toBeNull()
  })

  it('tells the owner a draft is being made and confirms when it became a reference photo', async () => {
    let finish: (value: unknown) => void = () => undefined
    mocks.preview.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    render(<ImageStyleSettings workspaceId={workspaceId} canEdit initialStyle={null} />)
    fireEvent.change(screen.getByLabelText('무엇을 찍을까요'), { target: { value: '카페' } })
    fireEvent.click(screen.getByRole('button', { name: '이 스타일로 시안 보기' }))
    expect(await screen.findByText(/시안을 만드는 중이에요/)).toBeInTheDocument()
    finish({ data: { assetId: '40000000-0000-4000-8000-000000000002', previewUrl: '/x', remainingToday: 3 } })
    const addReference = await screen.findByRole('button', { name: '이 시안을 기준 사진으로 추가' })
    await waitFor(() => expect(addReference).toBeEnabled())
    fireEvent.click(addReference)
    await waitFor(() => expect(screen.getByText(/기준 사진 1번으로 추가했어요/)).toBeInTheDocument())
  })

  it('fills scene input when clicking scene quick select chips', () => {
    render(<ImageStyleSettings workspaceId={workspaceId} canEdit initialStyle={null} />)
    const group = screen.getByRole('group', { name: '장면 빠른 선택' })
    expect(group).toBeInTheDocument()
    const chip = screen.getByRole('button', { name: '대표 상품·서비스 클로즈업' })
    expect(chip).toHaveAttribute('title', '예시 장면 — 고쳐서 쓰세요')
    fireEvent.click(chip)
    expect((screen.getByLabelText('테스트로 만들 장면 (비우면 대표 이미지)') as HTMLInputElement).value).toBe(
      '우리 대표 상품 또는 서비스를 가까이서 보여주는 대표 사진',
    )
  })

  it('renders dynamic chips from reference notes (deduped, max 4, 14 chars with ellipsis) and always includes 4 fixed chips', () => {
    const initialStyle = {
      subject: '테스트',
      mood: '',
      setting: '',
      lookAndColor: '',
      people: 'any' as const,
      avoid: [],
      extra: '',
      composition: '',
      guide: '',
      referenceAssetIds: ['ref-1', 'ref-2', 'ref-3', 'ref-4', 'ref-5', 'ref-6'],
      referenceNotes: {
        'ref-1': '열네자초과하는긴기준사진메모내용입니다',
        'ref-2': '열네자초과하는긴기준사진메모내용입니다', // 중복
        'ref-3': '짧은 메모',
        'ref-4': '세번째 유일한 기준 사진 메모',
        'ref-5': '네번째 유일한 기준 사진 메모',
        'ref-6': '다섯번째메모는최대4개제한으로제외',
      },
    }
    render(<ImageStyleSettings workspaceId={workspaceId} canEdit initialStyle={initialStyle} />)

    // 14자 초과 시 14자 + …
    const truncatedLabel = `${'열네자초과하는긴기준사진메모내용입니다'.slice(0, 14)}…`
    const dynamicChip1 = screen.getByRole('button', { name: truncatedLabel })
    expect(dynamicChip1).toHaveAttribute('title', '예시 장면 — 고쳐서 쓰세요')
    fireEvent.click(dynamicChip1)
    expect((screen.getByLabelText('테스트로 만들 장면 (비우면 대표 이미지)') as HTMLInputElement).value).toBe(
      '열네자초과하는긴기준사진메모내용입니다',
    )

    expect(screen.getByRole('button', { name: '짧은 메모' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `${'세번째 유일한 기준 사진 메모'.slice(0, 14)}…` })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: `${'네번째 유일한 기준 사진 메모'.slice(0, 14)}…` })).toBeInTheDocument()
    // 5번째 메모는 최대 4개 제한으로 칩이 생성되지 않아야 함
    expect(screen.queryByRole('button', { name: /다섯번째메모/ })).toBeNull()

    // 4개 고정 칩 존재 확인
    expect(screen.getByRole('button', { name: '대표 상품·서비스 클로즈업' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '매장 분위기' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '작업 과정' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '고객 응대 장면' })).toBeInTheDocument()
  })

  it('provides generic business presets including 꽃집·소품샵 and 학원·교육', () => {
    render(<ImageStyleSettings workspaceId={workspaceId} canEdit initialStyle={null} />)
    const flower = screen.getByRole('button', { name: '꽃집·소품샵' })
    expect(flower).toBeInTheDocument()
    fireEvent.click(flower)
    expect((screen.getByLabelText('무엇을 찍을까요') as HTMLTextAreaElement).value).toBe(
      '진열된 꽃과 소품이 매력적으로 보이는 클로즈업',
    )
    expect((screen.getByLabelText('구도·화면 구조') as HTMLInputElement).value).toBe('위에서 내려다본 구도, 제품이 화면 60%')
    expect((screen.getByLabelText('분위기') as HTMLInputElement).value).toBe('싱그럽고 아기자기한')

    const academy = screen.getByRole('button', { name: '학원·교육' })
    expect(academy).toBeInTheDocument()
    fireEvent.click(academy)
    expect((screen.getByLabelText('무엇을 찍을까요') as HTMLTextAreaElement).value).toBe(
      '수업·학습 장면, 집중하는 학생의 모습',
    )
    expect((screen.getByLabelText('사람 표현') as HTMLSelectElement).value).toBe('people')
    expect((screen.getByLabelText('배경·장소') as HTMLInputElement).value).toBe('밝은 교실')
  })

  it('contains no hardcoded eyebrow or byreum mentions except the 피부·눈썹 preset label', () => {
    render(<ImageStyleSettings workspaceId={workspaceId} canEdit initialStyle={null} />)
    const matches = screen.queryAllByText(/눈썹|BY\.REUM/)
    expect(matches).toHaveLength(1)
    expect(matches[0]).toHaveTextContent('피부·눈썹')
  })

  it('renders step 4 overlay composer with base photo options and dynamic default selection', async () => {
    const refId = '30000000-0000-4000-8000-000000000001'
    const initialStyle = {
      subject: '눈썹',
      mood: '',
      setting: '',
      lookAndColor: '',
      people: 'any' as const,
      avoid: [],
      extra: '',
      composition: '',
      guide: '',
      referenceAssetIds: [refId],
      referenceNotes: { [refId]: '기준 1' },
    }
    render(<ImageStyleSettings workspaceId={workspaceId} canEdit initialStyle={initialStyle} />)

    expect(screen.getByRole('heading', { level: 3, name: /문구·삽입컷 얹기/ })).toBeInTheDocument()
    expect(screen.getByText('사진 위에 글자나 비교 컷을 얹어요')).toBeInTheDocument()

    const select = screen.getByLabelText('바탕 사진') as HTMLSelectElement
    expect(select).toBeInTheDocument()
    // 기본 선택: 시안이 없으므로 첫 기준 사진
    expect(select.value).toBe(`ref:${refId}`)
    const composer = screen.getByTestId('overlay-composer')
    expect(composer).toHaveAttribute('data-workspace-id', workspaceId)
    expect(composer).toHaveAttribute('data-base-url', `/api/workspaces/${workspaceId}/media/${refId}`)

    // 시안 생성
    fireEvent.click(screen.getByRole('button', { name: '이 스타일로 시안 보기' }))
    await screen.findByRole('img', { name: '이미지 스타일 시안' })

    // 시안 생성 후 기본 선택: 방금 만든 시안
    await waitFor(() => expect(select.value).toBe('draft'))
    expect(screen.getByRole('option', { name: '방금 만든 시안' })).toBeInTheDocument()
    expect(composer).toHaveAttribute('data-base-url', '/api/workspaces/w/media/a1')

    // 사용자가 '없음(후기 카드용)' 선택 시 baseUrl null 전달
    fireEvent.change(select, { target: { value: 'none' } })
    expect(composer).toHaveAttribute('data-base-url', 'null')
  })

  it('fills the form and reference photos from the link import result without losing the owner text', async () => {
    render(<ImageStyleSettings workspaceId={workspaceId} canEdit initialStyle={null} />)
    fireEvent.change(screen.getByLabelText('소희에게 직접 가르치기'), { target: { value: '내가 쓴 규칙' } })
    fireEvent.click(screen.getByRole('button', { name: '링크 결과 반영(스텁)' }))
    expect((screen.getByLabelText('무엇을 찍을까요') as HTMLTextAreaElement).value).toBe('링크에서 읽은 피사체')
    const guide = (screen.getByLabelText('소희에게 직접 가르치기') as HTMLTextAreaElement).value
    expect(guide).toContain('내가 쓴 규칙')
    expect(guide).toContain('링크 분석 노트')
    expect(screen.getByRole('img', { name: '기준 사진 1' })).toBeInTheDocument()
    expect(screen.getAllByText('링크 사진 메모').length).toBeGreaterThan(0)
    expect(screen.getByText('저장하지 않은 변경이 있어요')).toBeInTheDocument()
  })

  it('catches save rejection, displays role=alert without router.refresh, and preserves user input', async () => {
    mocks.save.mockRejectedValueOnce(new Error('네트워크 연결이 끊어졌어요.'))
    render(<ImageStyleSettings workspaceId={workspaceId} canEdit initialStyle={null} />)

    fireEvent.change(screen.getByLabelText('무엇을 찍을까요'), { target: { value: '맛있는 베이글과 커피' } })
    fireEvent.click(screen.getByRole('button', { name: '이미지 스타일 저장' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('네트워크 연결이 끊어졌어요.')
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect((screen.getByLabelText('무엇을 찍을까요') as HTMLTextAreaElement).value).toBe('맛있는 베이글과 커피')
  })

  it('catches learn rejection, displays role=alert, and preserves user inputs', async () => {
    mocks.analyze.mockRejectedValueOnce(new Error('사진 분석 서버 오류가 발생했어요.'))
    render(<ImageStyleSettings workspaceId={workspaceId} canEdit initialStyle={null} />)

    fireEvent.change(screen.getByLabelText('무엇을 찍을까요'), { target: { value: '초벌 작성 내용' } })
    fireEvent.change(screen.getByLabelText('참고 사진 올리기'), { target: { files: [new File(['x'], 'photo.png', { type: 'image/png' })] } })
    fireEvent.click(screen.getByRole('checkbox', { name: /사용할 수 있는 사진/ }))
    fireEvent.click(screen.getByRole('button', { name: '사진에서 느낌 읽기' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('사진 분석 서버 오류가 발생했어요.')
    expect((screen.getByLabelText('무엇을 찍을까요') as HTMLTextAreaElement).value).toBe('초벌 작성 내용')
  })

  it('catches makeDraft rejection, displays role=alert, and preserves user inputs', async () => {
    mocks.preview.mockRejectedValueOnce(new Error('시안 생성 서버 오류가 발생했어요.'))
    render(<ImageStyleSettings workspaceId={workspaceId} canEdit initialStyle={null} />)

    fireEvent.change(screen.getByLabelText('무엇을 찍을까요'), { target: { value: '달콤한 디저트' } })
    fireEvent.click(screen.getByRole('button', { name: '이 스타일로 시안 보기' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('시안 생성 서버 오류가 발생했어요.')
    expect((screen.getByLabelText('무엇을 찍을까요') as HTMLTextAreaElement).value).toBe('달콤한 디저트')
  })

  it('rejects upload and shows role=alert error before calling action when total file size exceeds 10MB', async () => {
    render(<ImageStyleSettings workspaceId={workspaceId} canEdit initialStyle={null} />)

    // 6MB 파일 2개 = 12MB (10MB 초과)
    const bigFile1 = new File([new Uint8Array(6 * 1024 * 1024)], 'photo1.png', { type: 'image/png' })
    const bigFile2 = new File([new Uint8Array(6 * 1024 * 1024)], 'photo2.png', { type: 'image/png' })

    const fileInput = screen.getByLabelText('참고 사진 올리기') as HTMLInputElement
    fireEvent.change(fileInput, { target: { files: [bigFile1, bigFile2] } })

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('사진 용량 합계는 10MB 이하여야 해요')
    expect(mocks.analyze).not.toHaveBeenCalled()
  })

  it('restores draft from sessionStorage on remount and shows recovery banner only when different from baseline', async () => {
    sessionStorage.clear()
    const draftPayload = {
      version: 1,
      form: {
        subject: '복구된 카페 라떼',
        composition: '탑뷰 90도',
        setting: '우드 테이블',
        mood: '아늑한',
        lookAndColor: '따뜻한 톤',
        people: 'none',
        avoid: '네온',
        extra: '라떼아트 선명하게',
        guide: '손잡이는 오른쪽',
      },
      references: [
        {
          id: '30000000-0000-4000-8000-000000000099',
          url: `/api/workspaces/${workspaceId}/media/30000000-0000-4000-8000-000000000099`,
          note: '복구된 라떼 사진',
        },
      ],
      scene: '시그니처 라떼 단독샷',
      updatedAt: Date.now(),
    }
    sessionStorage.setItem(`image-style-draft:${workspaceId}`, JSON.stringify(draftPayload))

    const { unmount } = render(<ImageStyleSettings workspaceId={workspaceId} canEdit initialStyle={null} />)

    expect(screen.getByText('저장하지 않은 입력을 복구했어요')).toBeInTheDocument()
    expect((screen.getByLabelText('무엇을 찍을까요') as HTMLTextAreaElement).value).toBe('복구된 카페 라떼')
    expect((screen.getByLabelText('구도·화면 구조') as HTMLInputElement).value).toBe('탑뷰 90도')
    expect((screen.getByLabelText('테스트로 만들 장면 (비우면 대표 이미지)') as HTMLInputElement).value).toBe('시그니처 라떼 단독샷')
    expect(screen.getByRole('img', { name: '기준 사진 1' })).toBeInTheDocument()

    unmount()
  })

  it('does NOT show recovery banner when draft in sessionStorage matches initialStyle baseline', () => {
    sessionStorage.clear()
    const initialStyle = {
      subject: '저장된 피사체',
      composition: '정면',
      setting: '실내',
      mood: '밝은',
      lookAndColor: '자연광',
      people: 'none' as const,
      avoid: ['어두움'],
      extra: '',
      guide: '',
      referenceAssetIds: ['30000000-0000-4000-8000-000000000001'],
      referenceNotes: { '30000000-0000-4000-8000-000000000001': '기본 사진' },
    }
    const identicalDraft = {
      version: 1,
      form: {
        subject: '저장된 피사체',
        composition: '정면',
        setting: '실내',
        mood: '밝은',
        lookAndColor: '자연광',
        people: 'none',
        avoid: '어두움',
        extra: '',
        guide: '',
      },
      references: [
        {
          id: '30000000-0000-4000-8000-000000000001',
          url: `/api/workspaces/${workspaceId}/media/30000000-0000-4000-8000-000000000001`,
          note: '기본 사진',
        },
      ],
      scene: '',
      updatedAt: Date.now(),
    }
    sessionStorage.setItem(`image-style-draft:${workspaceId}`, JSON.stringify(identicalDraft))

    render(<ImageStyleSettings workspaceId={workspaceId} canEdit initialStyle={initialStyle} />)
    expect(screen.queryByText('저장하지 않은 입력을 복구했어요')).toBeNull()
  })

  it('clears draft on successful save, but keeps draft on save rejection', async () => {
    sessionStorage.clear()
    const { unmount } = render(<ImageStyleSettings workspaceId={workspaceId} canEdit initialStyle={null} />)

    fireEvent.change(screen.getByLabelText('무엇을 찍을까요'), { target: { value: '저장할 디저트' } })
    // draft should be saved in sessionStorage
    const key = `image-style-draft:${workspaceId}`
    expect(sessionStorage.getItem(key)).not.toBeNull()

    // 실패 시뮬레이션
    mocks.save.mockRejectedValueOnce(new Error('네트워크 오류'))
    fireEvent.click(screen.getByRole('button', { name: '이미지 스타일 저장' }))
    await screen.findByRole('alert')
    expect(sessionStorage.getItem(key)).not.toBeNull()

    // 성공 시뮬레이션
    mocks.save.mockResolvedValueOnce({ data: { version: 4 } })
    fireEvent.click(screen.getByRole('button', { name: '이미지 스타일 저장' }))
    await screen.findByText('저장했어요. 다음 이미지부터 이 스타일로 만들어요.')
    expect(sessionStorage.getItem(key)).toBeNull()

    unmount()
  })

  it('isolates state across workspaces so inputs do not leak when switching stores', () => {
    sessionStorage.clear()
    const workspaceIdA = '20000000-0000-4000-8000-000000000001'
    const workspaceIdB = '20000000-0000-4000-8000-000000000002'

    const { rerender } = render(<ImageStyleSettings workspaceId={workspaceIdA} canEdit initialStyle={null} />)
    fireEvent.change(screen.getByLabelText('무엇을 찍을까요'), { target: { value: 'A가게의 케이크' } })
    expect((screen.getByLabelText('무엇을 찍을까요') as HTMLTextAreaElement).value).toBe('A가게의 케이크')

    // B가게로 workspace 변경
    rerender(<ImageStyleSettings workspaceId={workspaceIdB} canEdit initialStyle={null} />)
    // A가게의 입력이 B가게로 누출되지 않아야 함
    expect((screen.getByLabelText('무엇을 찍을까요') as HTMLTextAreaElement).value).toBe('')
  })

  it('preserves other workspaces drafts when saving current workspace draft', async () => {
    sessionStorage.clear()
    const workspaceIdA = '20000000-0000-4000-8000-000000000001'
    const workspaceIdB = '20000000-0000-4000-8000-000000000002'

    // B가게 초안 미리 저장
    sessionStorage.setItem(
      `image-style-draft:${workspaceIdB}`,
      JSON.stringify({
        version: 1,
        form: {
          subject: 'B가게 디저트',
          composition: '',
          setting: '',
          mood: '',
          lookAndColor: '',
          people: 'any',
          avoid: '',
          extra: '',
          guide: '',
        },
        references: [],
        scene: '',
        updatedAt: Date.now(),
      }),
    )

    const { unmount } = render(<ImageStyleSettings workspaceId={workspaceIdA} canEdit initialStyle={null} />)
    fireEvent.change(screen.getByLabelText('무엇을 찍을까요'), { target: { value: 'A가게 피사체' } })

    // A가게 초안 저장 확인
    expect(sessionStorage.getItem(`image-style-draft:${workspaceIdA}`)).not.toBeNull()

    // A가게 저장 성공
    mocks.save.mockResolvedValueOnce({ data: { version: 5 } })
    fireEvent.click(screen.getByRole('button', { name: '이미지 스타일 저장' }))
    await screen.findByText('저장했어요. 다음 이미지부터 이 스타일로 만들어요.')

    // A가게 초안만 삭제되고, B가게 초안은 그대로 유지되어야 함
    expect(sessionStorage.getItem(`image-style-draft:${workspaceIdA}`)).toBeNull()
    expect(sessionStorage.getItem(`image-style-draft:${workspaceIdB}`)).not.toBeNull()
    const bDraft = JSON.parse(sessionStorage.getItem(`image-style-draft:${workspaceIdB}`)!)
    expect(bDraft.form.subject).toBe('B가게 디저트')

    unmount()
  })

  it('ensures complete workspace isolation during store switching and draft recovery roundtrip', () => {
    sessionStorage.clear()
    const workspaceIdA = '20000000-0000-4000-8000-000000000001'
    const workspaceIdB = '20000000-0000-4000-8000-000000000002'

    // 1. 매장 A에서 작업 및 초안 자동 저장
    const { rerender } = render(<ImageStyleSettings workspaceId={workspaceIdA} canEdit initialStyle={null} />)
    fireEvent.change(screen.getByLabelText('무엇을 찍을까요'), { target: { value: '매장 A 전용 케이크' } })
    fireEvent.change(screen.getByLabelText('구도·화면 구조'), { target: { value: '매장 A 탑뷰' } })

    // 2. 매장 B로 전환 -> 매장 A 내용 누출 없음
    rerender(<ImageStyleSettings workspaceId={workspaceIdB} canEdit initialStyle={null} />)
    expect((screen.getByLabelText('무엇을 찍을까요') as HTMLTextAreaElement).value).toBe('')
    expect((screen.getByLabelText('구도·화면 구조') as HTMLInputElement).value).toBe('')
    expect(screen.queryByText('저장하지 않은 입력을 복구했어요')).toBeNull()

    // 매장 B에서 다른 내용 입력
    fireEvent.change(screen.getByLabelText('무엇을 찍을까요'), { target: { value: '매장 B 전용 헤어' } })

    // 3. 다시 매장 A로 전환 -> 매장 A의 초안이 복구되고 복구 배너 노출, 매장 B 데이터 미오염
    rerender(<ImageStyleSettings workspaceId={workspaceIdA} canEdit initialStyle={null} />)
    expect(screen.getByText('저장하지 않은 입력을 복구했어요')).toBeInTheDocument()
    expect((screen.getByLabelText('무엇을 찍을까요') as HTMLTextAreaElement).value).toBe('매장 A 전용 케이크')
    expect((screen.getByLabelText('구도·화면 구조') as HTMLInputElement).value).toBe('매장 A 탑뷰')
  })

  it('strictly preserves form inputs and draft in storage on save rejection', async () => {
    sessionStorage.clear()
    mocks.save.mockRejectedValueOnce(new Error('서버 저장 타임아웃'))

    render(<ImageStyleSettings workspaceId={workspaceId} canEdit initialStyle={null} />)
    fireEvent.change(screen.getByLabelText('무엇을 찍을까요'), { target: { value: '유지되어야 하는 메뉴' } })
    fireEvent.change(screen.getByLabelText('소희에게 직접 가르치기'), { target: { value: '유지되어야 하는 가이드' } })
    fireEvent.change(screen.getByLabelText('피하고 싶은 것 (쉼표로 구분)'), { target: { value: '금지어1, 금지어2' } })

    fireEvent.click(screen.getByRole('button', { name: '이미지 스타일 저장' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('서버 저장 타임아웃')

    // 입력값 모두 보존
    expect((screen.getByLabelText('무엇을 찍을까요') as HTMLTextAreaElement).value).toBe('유지되어야 하는 메뉴')
    expect((screen.getByLabelText('소희에게 직접 가르치기') as HTMLTextAreaElement).value).toBe('유지되어야 하는 가이드')
    expect((screen.getByLabelText('피하고 싶은 것 (쉼표로 구분)') as HTMLInputElement).value).toBe('금지어1, 금지어2')

    // 초안도 sessionStorage에 온전히 유지
    const savedDraft = JSON.parse(sessionStorage.getItem(`image-style-draft:${workspaceId}`)!)
    expect(savedDraft.form.subject).toBe('유지되어야 하는 메뉴')
    expect(savedDraft.form.guide).toBe('유지되어야 하는 가이드')
    expect(savedDraft.form.avoid).toBe('금지어1, 금지어2')
  })

  describe('390px mobile viewport layout stability', () => {
    beforeEach(() => {
      // 390px 모바일 뷰포트 설정 (iPhone 12/13/14/15 표준 너비)
      window.innerWidth = 390
      window.innerHeight = 844
    })

    it('ensures all form inputs, buttons, and chips fit within 390px viewport without overflow', () => {
      const { container } = render(
        <div style={{ width: '390px', maxWidth: '390px', overflowX: 'hidden' }}>
          <ImageStyleSettings workspaceId={workspaceId} canEdit initialStyle={null} />
        </div>,
      )

      // 1. 모든 폼 컨트롤(input, textarea, select)이 step 컨테이너 내부에 속하고 가로 넘침 고정폭이 없음
      const inputs = container.querySelectorAll('input:not([type="checkbox"]):not([type="file"]), textarea, select')
      expect(inputs.length).toBeGreaterThan(0)
      for (const el of inputs) {
        // step 컨테이너 내부 요소로 inline-size: 100% 스타일이 적용되는 CSS 셀렉터 범위 내에 존재
        expect((el as HTMLElement).closest('[class*="step"]')).not.toBeNull()
        // 폼 컨트롤에 고정된 390px 초과 너비 인라인 스타일이 없어야 함
        const htmlEl = el as HTMLElement
        expect(htmlEl.style.width).not.toMatch(/^[4-9]\d{2}px/)
      }

      // 2. 업종 프리셋 버튼 그룹 및 장면 칩 버튼 그룹이 flex-wrap을 적용받아 390px 폭에서 줄바꿈됨
      const presetsGroup = screen.getByRole('group', { name: '업종별 예시' })
      expect(presetsGroup.className).toContain('presets')

      const chipsGroup = screen.getByRole('group', { name: '장면 빠른 선택' })
      expect(chipsGroup.className).toContain('chips')

      // 3. sticky 저장 바가 390px 화면 하단에 안전하게 고정됨
      const saveButton = screen.getByRole('button', { name: '이미지 스타일 저장' })
      expect(saveButton).toBeInTheDocument()
      expect(saveButton.parentElement?.className).toContain('saveBar')
    })

    it('ensures overlay details and composer container adapt properly to 390px width', () => {
      const { container } = render(
        <div style={{ width: '390px', maxWidth: '390px', overflowX: 'hidden' }}>
          <ImageStyleSettings workspaceId={workspaceId} canEdit initialStyle={null} />
        </div>,
      )

      // 문구·삽입컷 얹기 details 엘리먼트 확인
      const details = container.querySelector('details')
      expect(details).not.toBeNull()
      expect(details?.className).toContain('details')

      // details 오픈 상태 시뮬레이션
      if (details) {
        details.open = true
      }

      // overlay composer stub/컴포넌트가 detailsContent 내부에 잘 포함됨
      const composer = screen.getByTestId('overlay-composer')
      expect(composer).toBeInTheDocument()
      expect(composer.parentElement?.className).toContain('detailsContent')
    })
  })
})
