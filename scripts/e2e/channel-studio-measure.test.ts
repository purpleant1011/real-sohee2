import { describe, expect, it } from 'vitest'
import { DRIVER_MARKER, buildDriverScript, checkAxeCoreInstalled, evaluateMeasurements, parseDriverOutput } from './channel-studio-measure.mjs'

describe('Channel Studio Measure - evaluateMeasurements', () => {
  const createMockRaw = (overrides: Record<string, any> = {}): any => ({
    1280: {
      viewport: { width: 1280, height: 800, isMobile: false },
      dimensions: {
        innerWidth: 1280,
        innerHeight: 800,
        scrollWidth: 1280,
        scrollHeight: 900,
        clientWidth: 1280,
        clientHeight: 800,
        overflowsX: false,
      },
      axe: { status: 'NOT_MEASURED', reason: 'axe-core 미설치' },
    },
    390: {
      viewport: { width: 390, height: 844, isMobile: true },
      dimensions: {
        innerWidth: 390,
        innerHeight: 844,
        scrollWidth: 390,
        scrollHeight: 1500,
        clientWidth: 390,
        clientHeight: 844,
        overflowsX: false,
      },
      touchTargets: {
        checkedCount: 12,
        smallTargetsCount: 0,
        smallTargets: [] as any[],
      },
      axe: { status: 'NOT_MEASURED', reason: 'axe-core 미설치' },
    },
    channelStudio: {
      tabs: {
        count: 4,
        items: [
          { index: 0, id: 'studio-tab-instagram', text: '인스타그램', selected: true },
          { index: 1, id: 'studio-tab-threads', text: '스레드', selected: false },
          { index: 2, id: 'studio-tab-naver_blog', text: '네이버 블로그', selected: false },
          { index: 3, id: 'studio-tab-daangn_business', text: '당근 비즈니스', selected: false },
        ],
        arrowRightCycles: {
          success: true,
          steps: [
            { selectedIdx: 1, selectedId: 'studio-tab-threads' },
            { selectedIdx: 2, selectedId: 'studio-tab-naver_blog' },
            { selectedIdx: 3, selectedId: 'studio-tab-daangn_business' },
          ],
          wrapIdx: 0,
        },
      },
      panels: [
        {
          channel: 'instagram',
          found: true,
          hasDisclaimer: true,
          hasArchiveButton: true,
          archiveButtonDisabled: false,
          hasBlockedReason: false,
          blockedReason: null,
          hasForbiddenPublishButton: false,
          forbiddenButtonTexts: [] as string[],
        },
        {
          channel: 'threads',
          found: true,
          hasDisclaimer: true,
          hasArchiveButton: true,
          archiveButtonDisabled: false,
          hasBlockedReason: false,
          blockedReason: null,
          hasForbiddenPublishButton: false,
          forbiddenButtonTexts: [] as string[],
        },
        {
          channel: 'naver_blog',
          found: true,
          hasDisclaimer: true,
          hasArchiveButton: true,
          archiveButtonDisabled: false,
          hasBlockedReason: false,
          blockedReason: null,
          hasForbiddenPublishButton: false,
          forbiddenButtonTexts: [] as string[],
        },
        {
          channel: 'daangn_business',
          found: true,
          hasDisclaimer: true,
          hasArchiveButton: true,
          archiveButtonDisabled: true,
          hasBlockedReason: true,
          blockedReason: '지역 매장 정보 확인 필요',
          hasForbiddenPublishButton: false,
          forbiddenButtonTexts: [] as string[],
        },
      ],
      consoleErrors: {
        status: 'PASS',
        count: 0,
        errors: [] as string[],
      },
    },
    axe: { status: 'NOT_MEASURED', reason: 'axe-core 미설치' },
    ...overrides,
  })

  it('기본 측정 데이터에서 가로스크롤, 탭, 면책, 보관버튼, 터치타깃, 콘솔에러 항목이 PASS로 판정된다', () => {
    const raw = createMockRaw()
    const result = evaluateMeasurements(raw)

    expect(result.items.viewport1280Scroll.status).toBe('PASS')
    expect(result.items.viewport390Scroll.status).toBe('PASS')
    expect(result.items.tabKeyboardNav.status).toBe('PASS')
    expect(result.items.panelsDisclaimer.status).toBe('PASS')
    expect(result.items.panelsArchiveButton.status).toBe('PASS')
    expect(result.items.noPublishButtons.status).toBe('PASS')
    expect(result.items.mobileTouchTargets.status).toBe('PASS')
    expect(result.items.consoleErrors.status).toBe('PASS')
    // axe-core 는 미설치이므로 NOT_MEASURED 여야 하며, 결코 PASS 로 판정되어서는 안 된다.
    expect(result.items.accessibilityAxe.status).toBe('NOT_MEASURED')
    expect(result.overall).toBe('NOT_MEASURED')
  })

  it('axe-core 위반 0건일 때 전체가 PASS로 산출된다', () => {
    const raw = createMockRaw({
      axe: { status: 'PASS', violations: [] },
    })
    const result = evaluateMeasurements(raw)

    expect(result.items.accessibilityAxe.status).toBe('PASS')
    expect(result.overall).toBe('PASS')
  })

  it('1280 뷰포트에서 가로 스크롤(scrollWidth > clientWidth) 발생 시 FAIL 판정된다', () => {
    const raw = createMockRaw({
      1280: {
        dimensions: {
          scrollWidth: 1320,
          clientWidth: 1280,
          overflowsX: true,
        },
      },
    })
    const result = evaluateMeasurements(raw)

    expect(result.items.viewport1280Scroll.status).toBe('FAIL')
    expect(result.overall).toBe('FAIL')
  })

  it('390 뷰포트에서 가로 스크롤 발생 시 FAIL 판정된다', () => {
    const raw = createMockRaw({
      390: {
        dimensions: {
          scrollWidth: 410,
          clientWidth: 390,
          overflowsX: true,
        },
        touchTargets: { smallTargetsCount: 0 },
      },
    })
    const result = evaluateMeasurements(raw)

    expect(result.items.viewport390Scroll.status).toBe('FAIL')
    expect(result.overall).toBe('FAIL')
  })

  it('탭 개수가 4개가 아니거나 키보드 순환 실패 시 FAIL 판정된다', () => {
    const raw = createMockRaw()
    raw.channelStudio.tabs.count = 3
    const result = evaluateMeasurements(raw)

    expect(result.items.tabKeyboardNav.status).toBe('FAIL')
    expect(result.overall).toBe('FAIL')

    const rawCycleFail = createMockRaw()
    rawCycleFail.channelStudio.tabs.arrowRightCycles.success = false
    const resultCycleFail = evaluateMeasurements(rawCycleFail)

    expect(resultCycleFail.items.tabKeyboardNav.status).toBe('FAIL')
  })

  it('탭 패널 중 하나라도 "예상 화면" 면책 문구가 없으면 FAIL 판정된다', () => {
    const raw = createMockRaw()
    raw.channelStudio.panels[1].hasDisclaimer = false
    const result = evaluateMeasurements(raw)

    expect(result.items.panelsDisclaimer.status).toBe('FAIL')
    expect(result.items.panelsDisclaimer.message).toContain('threads')
    expect(result.overall).toBe('FAIL')
  })

  it('탭 패널 중 "이 채널 글 보관하기" 버튼이 없으면 FAIL 판정된다', () => {
    const raw = createMockRaw()
    raw.channelStudio.panels[2].hasArchiveButton = false
    const result = evaluateMeasurements(raw)

    expect(result.items.panelsArchiveButton.status).toBe('FAIL')
    expect(result.overall).toBe('FAIL')
  })

  it('보관하기 버튼이 비활성화되었는데 사유 문구가 없으면 FAIL 판정된다', () => {
    const raw = createMockRaw()
    raw.channelStudio.panels[3].archiveButtonDisabled = true
    raw.channelStudio.panels[3].hasBlockedReason = false
    const result = evaluateMeasurements(raw)

    expect(result.items.panelsArchiveButton.status).toBe('FAIL')
    expect(result.overall).toBe('FAIL')
  })

  it('금지된 발행/예약 버튼("승인하고 발행" 등)이 패널에 존재하면 FAIL 판정된다', () => {
    const raw = createMockRaw()
    raw.channelStudio.panels[0].hasForbiddenPublishButton = true
    raw.channelStudio.panels[0].forbiddenButtonTexts = ['승인하고 발행']
    const result = evaluateMeasurements(raw)

    expect(result.items.noPublishButtons.status).toBe('FAIL')
    expect(result.items.noPublishButtons.message).toContain('승인하고 발행')
    expect(result.overall).toBe('FAIL')
  })

  it('모바일 390 뷰포트에서 높이 44px 미만 터치 타깃이 있으면 FAIL 판정된다', () => {
    const raw = createMockRaw()
    raw['390'].touchTargets = {
      checkedCount: 15,
      smallTargetsCount: 2,
      smallTargets: [
        { tagName: 'button', text: '추천 주제', height: 36, width: 80 },
        { tagName: 'a', text: '링크', height: 32, width: 40 },
      ],
    }
    const result = evaluateMeasurements(raw)

    expect(result.items.mobileTouchTargets.status).toBe('FAIL')
    expect(result.items.mobileTouchTargets.message).toContain('2개')
    expect(result.overall).toBe('FAIL')
  })

  it('콘솔 에러가 발생하면 FAIL 판정된다', () => {
    const raw = createMockRaw()
    raw.channelStudio.consoleErrors = {
      status: 'FAIL',
      count: 1,
      errors: ['TypeError: Cannot read properties of undefined'],
    }
    const result = evaluateMeasurements(raw)

    expect(result.items.consoleErrors.status).toBe('FAIL')
    expect(result.overall).toBe('FAIL')
  })

  it('측정 데이터가 누락된 경우 NOT_MEASURED로 판정하며 결코 PASS로 두지 않는다', () => {
    const emptyRaw = {}
    const result = evaluateMeasurements(emptyRaw)

    expect(result.items.viewport1280Scroll.status).toBe('NOT_MEASURED')
    expect(result.items.viewport390Scroll.status).toBe('NOT_MEASURED')
    expect(result.items.tabKeyboardNav.status).toBe('NOT_MEASURED')
    expect(result.items.panelsDisclaimer.status).toBe('NOT_MEASURED')
    expect(result.items.panelsArchiveButton.status).toBe('NOT_MEASURED')
    expect(result.items.noPublishButtons.status).toBe('NOT_MEASURED')
    expect(result.items.mobileTouchTargets.status).toBe('NOT_MEASURED')
    expect(result.items.consoleErrors.status).toBe('NOT_MEASURED')
    expect(result.items.accessibilityAxe.status).toBe('NOT_MEASURED')
    expect(result.overall).toBe('NOT_MEASURED')
  })
})

describe('Channel Studio Measure - parseDriverOutput', () => {
  it('stdout 또는 stderr 에 포함된 마커 라인의 JSON 객체를 올바르게 파싱한다', () => {
    const payload = { testKey: 'testVal', count: 42 }
    const stdout = `some random logs\n${DRIVER_MARKER} ${JSON.stringify(payload)}\nfinished`
    const parsed = parseDriverOutput(stdout, '')
    expect(parsed).toEqual(payload)
  })

  it('stderr 에만 마커가 있어도 정상 파싱한다', () => {
    const payload = { fromStderr: true }
    const stderr = `[ego-browser:notice] update\n${DRIVER_MARKER} ${JSON.stringify(payload)}`
    const parsed = parseDriverOutput('', stderr)
    expect(parsed).toEqual(payload)
  })

  it('마커가 없으면 null 을 반환한다', () => {
    expect(parseDriverOutput('some normal logs', 'warning logs')).toBeNull()
  })

  it('마커 뒤의 문자열이 잘못된 JSON 이면 Error 를 던진다', () => {
    const malformed = `${DRIVER_MARKER} { invalid json `
    expect(() => parseDriverOutput(malformed, '')).toThrow(/JSON/)
  })
})

describe('Channel Studio Measure - buildDriverScript & helpers', () => {
  it('생성된 드라이버 스크립트에 핵심 측정 API 호출이 포함된다', () => {
    const script = buildDriverScript({
      baseUrl: 'http://127.0.0.1:3414',
      targetRoute: '/dev/channel-studio/studio',
      outDir: '/tmp/test-out',
      hasAxeCore: false,
    })

    expect(script).toContain('Emulation.setDeviceMetricsOverride')
    expect(script).toContain('1280')
    expect(script).toContain('390')
    expect(script).toContain('ArrowRight')
    expect(script).toContain('task.finish({ keep: [] })')
    expect(script).toContain('예상 화면')
    expect(script).toContain('이 채널 글 보관하기')
    expect(script).toContain('studio-1280.png')
    expect(script).toContain('studio-390.png')
  })

  it('checkAxeCoreInstalled 는 이미 설치된 axe-core 빌드가 있으면 true, 없는 디렉터리면 false 를 반환한다', () => {
    expect(checkAxeCoreInstalled()).toBe(true)
    expect(checkAxeCoreInstalled('/nonexistent-sohee-root')).toBe(false)
  })
})
