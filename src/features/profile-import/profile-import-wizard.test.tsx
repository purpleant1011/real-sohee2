// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetchText: vi.fn(),
  importImages: vi.fn(),
  applyText: vi.fn(),
}))

vi.mock('./actions/profile-import-actions', () => ({
  fetchProfileTextStyleAction: mocks.fetchText,
  importProfileImagesAction: mocks.importImages,
  applyProfileTextStyleAction: mocks.applyText,
}))

import { ProfileImportWizard } from './profile-import-wizard'

const workspaceId = '20000000-0000-4000-8000-000000000001'

describe('ProfileImportWizard', () => {
  const onImageStyle = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('(a) 빈 입력 오류 시 alert를 표시한다', async () => {
    render(<ProfileImportWizard workspaceId={workspaceId} canEdit={true} onImageStyle={onImageStyle} />)

    const button = screen.getByRole('button', { name: '분석 시작' })
    fireEvent.click(button)

    expect(await screen.findByRole('alert')).toHaveTextContent('계정 링크를 입력해 주세요.')
    expect(mocks.fetchText).not.toHaveBeenCalled()
    expect(mocks.importImages).not.toHaveBeenCalled()
  })

  it('(b) 두 액션 동시 호출과 성공 흐름, onImageStyle 호출 인자 및 편집 후 적용 시 apply 인자가 정확하다', async () => {
    const textData = {
      handle: 'my_cafe',
      platform: 'instagram' as const,
      postCount: 15,
      stats: {
        averageLength: 120,
        averageHashtagCount: 5,
        topHashtags: ['#카페', '#디저트', '#라떼'],
        repeatedHeaderLine: '오늘의 커피 이야기 ☕',
        emojiPerPost: 3,
        topEmojis: ['☕', '🍰'],
      },
      draft: {
        voiceSummary: '따뜻하고 친근한 동네 카페 사장님 말투',
        styleGuide: '첫 줄에 시그니처 이모지와 헤더를 쓰고, 본문은 3줄 단락으로 정갈하게 쓴다.',
        keywords: ['원두', '로스팅', '핸드드립'],
        prohibitedTerms: ['초특가', '최저가'],
        sampleOpenings: ['좋은 아침이에요'],
        hashtags: ['#카페', '#디저트'],
      },
      sample: '오늘 아침 로스팅한 원두로 내린 따뜻한 핸드드립 한 잔 어떠세요? 편안한 하루 되세요.',
    }

    const imageData = {
      form: {
        subject: '핸드드립 커피와 디저트',
        composition: '45도 탑뷰',
        setting: '원목 테이블',
        mood: '아늑한',
        lookAndColor: '따뜻한 브라운 톤',
        people: 'hands',
        avoid: '네온 조명',
        extra: '자연광 활용',
        analysis: '원목 테이블 위의 컵이 중앙에 배치됨',
      },
      references: [
        { id: 'ref-1', url: '/media/ref-1', note: '커피잔 클로즈업' },
        { id: 'ref-2', url: '/media/ref-2', note: '디저트 플레이팅' },
      ],
      pickedCount: 2,
    }

    mocks.fetchText.mockResolvedValue({ data: textData })
    mocks.importImages.mockResolvedValue({ data: imageData })
    mocks.applyText.mockResolvedValue({ data: { applied: true } })

    render(<ProfileImportWizard workspaceId={workspaceId} canEdit={true} onImageStyle={onImageStyle} />)

    const input = screen.getByLabelText('인스타그램·스레드 계정 링크')
    fireEvent.change(input, { target: { value: 'https://www.instagram.com/my_cafe/' } })

    const startButton = screen.getByRole('button', { name: '분석 시작' })
    fireEvent.click(startButton)

    // 진행 상태 및 동시 호출 확인
    await waitFor(() => {
      expect(mocks.fetchText).toHaveBeenCalledWith({
        workspaceId,
        url: 'https://www.instagram.com/my_cafe/',
      })
      expect(mocks.importImages).toHaveBeenCalledWith({
        workspaceId,
        url: 'https://www.instagram.com/my_cafe/',
      })
    })

    // 이미지 콜백 확인
    expect(onImageStyle).toHaveBeenCalledWith({
      form: imageData.form,
      references: imageData.references,
    })

    // 사진 보관 안내 문구 확인
    expect(
      await screen.findByText('사진 2장을 기준 사진으로 보관하고 이미지 스타일 칸을 채웠어요. 아래에서 확인하고 저장해 주세요.'),
    ).toBeInTheDocument()

    // 글 분석 근거 확인
    expect(screen.getByText(/15개/)).toBeInTheDocument()
    expect(screen.getByText(/120자/)).toBeInTheDocument()
    expect(screen.getByText(/오늘의 커피 이야기 ☕/)).toBeInTheDocument()

    // 폼 초기값 확인
    const summaryInput = screen.getByLabelText('글 쓰는 방식 요약') as HTMLTextAreaElement
    const guideInput = screen.getByLabelText('글 구조·말투 지시문') as HTMLTextAreaElement
    const keywordsInput = screen.getByLabelText('자주 쓰는 키워드') as HTMLInputElement
    const prohibitedInput = screen.getByLabelText('쓰지 않을 표현') as HTMLInputElement

    expect(summaryInput.value).toBe('따뜻하고 친근한 동네 카페 사장님 말투')
    expect(guideInput.value).toBe('첫 줄에 시그니처 이모지와 헤더를 쓰고, 본문은 3줄 단락으로 정갈하게 쓴다.')
    expect(keywordsInput.value).toBe('원두, 로스팅, 핸드드립')
    expect(prohibitedInput.value).toBe('초특가, 최저가')

    // 샘플 확인
    expect(screen.getByText(textData.sample)).toBeInTheDocument()

    // 폼 수정 후 적용
    fireEvent.change(summaryInput, { target: { value: '수정된 한 줄 요약' } })
    fireEvent.change(keywordsInput, { target: { value: ' 원두, 콜드브루 ,  , 에스프레소 ' } })
    fireEvent.change(prohibitedInput, { target: { value: '광고 , 협찬 ' } })

    const applyButton = screen.getByRole('button', { name: '글 쓰는 방식 적용' })
    fireEvent.click(applyButton)

    await waitFor(() => {
      expect(mocks.applyText).toHaveBeenCalledWith({
        workspaceId,
        voiceSummary: '수정된 한 줄 요약',
        styleGuide: '첫 줄에 시그니처 이모지와 헤더를 쓰고, 본문은 3줄 단락으로 정갈하게 쓴다.',
        keywords: ['원두', '콜드브루', '에스프레소'],
        prohibitedTerms: ['광고', '협찬'],
      })
    })

    // 적용 성공 상태 확인
    const statusMessage = await screen.findByText('적용했어요. 다음 글부터 이 방식으로 써요.')
    expect(statusMessage).toHaveAttribute('role', 'status')

    // 적용 실패 시 alert 표시 확인
    mocks.applyText.mockResolvedValueOnce({ error: { message: '적용 중 오류 발생' } })
    fireEvent.click(applyButton)
    const applyAlert = await screen.findByRole('alert')
    expect(applyAlert).toHaveTextContent('적용 중 오류 발생')
  })

  it('(c) 글만 실패해도 이미지 결과는 반영되고 오류 문구를 role=alert 로 표시한다', async () => {
    const imageData = {
      form: {
        subject: '테스트 피사체',
        composition: '구도',
        setting: '장소',
        mood: '분위기',
        lookAndColor: '색감',
        people: 'none',
        avoid: '',
        extra: '',
        analysis: '분석',
      },
      references: [{ id: 'ref-1', url: '/ref-1', note: '노트' }],
      pickedCount: 1,
    }

    mocks.fetchText.mockResolvedValue({ error: { message: '분석할 글이 없어요.' } })
    mocks.importImages.mockResolvedValue({ data: imageData })

    render(<ProfileImportWizard workspaceId={workspaceId} canEdit={true} onImageStyle={onImageStyle} />)

    const input = screen.getByLabelText('인스타그램·스레드 계정 링크')
    fireEvent.change(input, { target: { value: 'https://www.instagram.com/photo_only/' } })
    fireEvent.click(screen.getByRole('button', { name: '분석 시작' }))

    // 이미지 쪽은 정상 반영
    await waitFor(() => {
      expect(onImageStyle).toHaveBeenCalledWith({
        form: imageData.form,
        references: imageData.references,
      })
    })
    expect(
      await screen.findByText('사진 1장을 기준 사진으로 보관하고 이미지 스타일 칸을 채웠어요. 아래에서 확인하고 저장해 주세요.'),
    ).toBeInTheDocument()

    // 글 쪽은 에러 alert 표시
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('분석할 글이 없어요.')
  })

  it('(d) canEdit=false 일 때는 편집 불가 안내 문구만 표시된다', () => {
    render(<ProfileImportWizard workspaceId={workspaceId} canEdit={false} onImageStyle={onImageStyle} />)

    expect(screen.queryByLabelText('인스타그램·스레드 계정 링크')).toBeNull()
    expect(screen.queryByRole('button', { name: '분석 시작' })).toBeNull()
    expect(
      screen.getByText('스타일과 글 쓰는 방식을 바꾸려면 편집 권한이 필요해요.'),
    ).toBeInTheDocument()
  })

  it('(e) UI 힌트에 실제 지원 범위(현재 연결한 계정 분석 지원; 다른 계정은 사진·텍스트 자료로 직접 등록)를 안내하고 타계정 성공을 보장하지 않는다', () => {
    render(<ProfileImportWizard workspaceId={workspaceId} canEdit={true} onImageStyle={onImageStyle} />)

    const hint = screen.getByText(/현재 연결한 계정 분석 지원; 다른 계정은 사진·텍스트 자료로 직접 등록/)
    expect(hint).toBeInTheDocument()
    // 타계정 자동 가져오기 성공을 보장하는 허위 문구가 없어야 함
    expect(screen.queryByText(/다른 공개 비즈니스 계정도 분석할 수 있어요/)).toBeNull()
  })

  it('(f) 타계정 분석 거부 시 명확한 한국어 오류를 alert로 표시하고 이미지 스타일 콜백을 부르지 않는다', async () => {
    const errorMsg = '인스타그램은 현재 연결한 내 계정만 분석할 수 있어요. 다른 계정은 사진·텍스트 자료로 직접 등록해 주세요.'
    mocks.fetchText.mockResolvedValue({ error: { message: errorMsg } })
    mocks.importImages.mockResolvedValue({ error: { message: errorMsg } })

    render(<ProfileImportWizard workspaceId={workspaceId} canEdit={true} onImageStyle={onImageStyle} />)

    const input = screen.getByLabelText('인스타그램·스레드 계정 링크')
    fireEvent.change(input, { target: { value: 'https://www.instagram.com/other_account/' } })
    fireEvent.click(screen.getByRole('button', { name: '분석 시작' }))

    const alerts = await screen.findAllByRole('alert')
    expect(alerts.length).toBeGreaterThan(0)
    expect(alerts[0]).toHaveTextContent(errorMsg)
    expect(onImageStyle).not.toHaveBeenCalled()
  })
})
