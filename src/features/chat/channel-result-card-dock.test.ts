import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluateCascade } from '@/styles/cascade-evaluator'

describe('channel-result-card.module.css reviewDock layout & clearance', () => {
  const cssPath = path.resolve(__dirname, 'channel-result-card.module.css')
  const cssContent = fs.readFileSync(cssPath, 'utf-8')

  it('기본 sticky .reviewDock은 하단 composer bar(z-index 18) 위에 위치하도록 z-index가 18 초과이고 inset-block-end에 clearance 변수를 포함한다', () => {
    // .reviewDock 기본 규칙 추출 (미디어 쿼리 밖)
    const baseReviewDockMatch = cssContent.match(/\.reviewDock\s*\{([^}]+)\}/)
    expect(baseReviewDockMatch).not.toBeNull()
    const baseRules = baseReviewDockMatch![1]!

    // inset-block-end must include var(--conversation-scroll-clearance, 0px)
    expect(baseRules).toMatch(/inset-block-end:\s*calc\([^;]*var\(--conversation-scroll-clearance/)

    // z-index must be at least 19 to sit above fixed composer bar (z-index 18)
    const zIndexMatch = baseRules.match(/z-index:\s*(\d+)/)
    expect(zIndexMatch).not.toBeNull()
    expect(Number(zIndexMatch![1])).toBeGreaterThanOrEqual(19)
  })

  it('모바일 미디어 쿼리(<=760px)에서 .reviewDock은 근거 보기 등 상호작용 요소를 가리지 않도록 static 흐름(non-sticky)이다', () => {
    // @media (max-width: 760px) 블록 추출
    const mediaMatch = cssContent.match(/@media\s*\(\s*max-width:\s*760px\s*\)\s*\{([\s\S]*?)\n\}/)
    expect(mediaMatch).not.toBeNull()
    const mediaContent = mediaMatch![1]!

    // 미디어 쿼리 내부의 .reviewDock 규칙
    const mobileReviewDockMatch = mediaContent.match(/\.reviewDock\s*\{([^}]+)\}/)
    expect(mobileReviewDockMatch).not.toBeNull()
    const mobileRules = mobileReviewDockMatch![1]!

    expect(mobileRules).toMatch(/position:\s*static/)
    expect(mobileRules).toMatch(/inset-block-end:\s*auto/)
  })

  it('.reviewDock과 앵커 요소는 상단 고정 헤더(--m-header-h)에 가려지지 않도록 scroll-margin-top/scroll-padding-top을 포함한다', () => {
    // .reviewDock 기본 규칙 추출
    const baseReviewDockMatch = cssContent.match(/\.reviewDock\s*\{([^}]+)\}/)
    expect(baseReviewDockMatch).not.toBeNull()
    const baseRules = baseReviewDockMatch![1]!
    expect(baseRules).toMatch(/scroll-margin-top:\s*var\(--m-header-h/)
    expect(baseRules).toMatch(/scroll-padding-top:\s*var\(--m-header-h/)

    // .reviewDock > button
    const dockButtonMatch = cssContent.match(/\.reviewDock\s*>\s*button\s*\{([^}]+)\}/)
    expect(dockButtonMatch).not.toBeNull()
    expect(dockButtonMatch![1]!).toMatch(/scroll-margin-top:\s*var\(--m-header-h/)

    // .partialRevisionPanel (앵커 패널)
    const panelMatch = cssContent.match(/\.partialRevisionPanel\s*\{([^}]+)\}/)
    expect(panelMatch).not.toBeNull()
    expect(panelMatch![1]!).toMatch(/scroll-margin-top:\s*var\(--m-header-h/)
    expect(panelMatch![1]!).toMatch(/scroll-padding-top:\s*var\(--m-header-h/)
  })

  it('모바일(<=759px / <=760px) 컨트롤은 최소 16px 폰트와 44px 이상의 터치 높이를 가진다', () => {
    const mobileBlock = cssContent.match(/@media\s*\(\s*max-width:\s*(759|760)px\s*\)\s*\{([\s\S]*?)\n\}/g)
    expect(mobileBlock).not.toBeNull()
    const allMobileRules = mobileBlock!.join('\n')

    // retryButton
    expect(allMobileRules).toMatch(/\.retryButton\s*\{[^}]*min-block-size:\s*(44px|48px|2\.75rem)/)
    expect(allMobileRules).toMatch(/\.retryButton\s*\{[^}]*font-size:\s*(16px|1rem)/)

    // workflowPrimary
    expect(allMobileRules).toMatch(/\.workflowPrimary\s*\{[^}]*font-size:\s*(16px|1rem)/)

    // compactConsent
    expect(allMobileRules).toMatch(/\.compactConsent\s*\{[^}]*font-size:\s*(16px|1rem)/)

    // segmentButton
    expect(allMobileRules).toMatch(/\.segmentButton\s*\{[^}]*font-size:\s*(16px|1rem)/)

    // publishCompletionLink
    expect(allMobileRules).toMatch(/\.publishCompletionLink\s*\{[^}]*min-block-size:\s*(44px|48px|2\.75rem)/)
    expect(allMobileRules).toMatch(/\.publishCompletionLink\s*\{[^}]*font-size:\s*(16px|1rem)/)

    // careSwitchButton
    expect(allMobileRules).toMatch(/\.careSwitchButton\s*\{[^}]*min-block-size:\s*(44px|48px|2\.75rem)/)

    // care typography
    expect(allMobileRules).toMatch(/\.carePanelTitle\s*\{[^}]*font-size:\s*(16px|1rem)/)
    expect(allMobileRules).toMatch(/\.careRowLabel\s*\{[^}]*font-size:\s*(16px|1rem)/)
    expect(allMobileRules).toMatch(/\.careSecondaryRow\s*\{[^}]*font-size:\s*(14px|15px|16px|0\.875rem|1rem)/)
    expect(allMobileRules).toMatch(/\.careDisclaimer\s*\{[^}]*font-size:\s*(14px|15px|16px|0\.875rem|1rem)/)

    // reviewDock & partialRevision buttons typography (>=14px, primary 16px, heights 44-48px)
    expect(allMobileRules).toMatch(/\.reviewDock\s*>\s*button[\s\S]*?font-size:\s*(14px|15px|16px|0\.875rem|1rem)/)
    expect(allMobileRules).toMatch(/\.partialRevisionActions\s+button[\s\S]*?font-size:\s*(14px|15px|16px|0\.875rem|1rem)/)
    expect(allMobileRules).toMatch(/\.partialRevisionActions\s+button[\s\S]*?min-block-size:\s*(44px|48px|2\.75rem)/)
    expect(allMobileRules).toMatch(/\.workflowRepair[\s\S]*?font-size:\s*(14px|15px|16px|0\.875rem|1rem)/)
    expect(allMobileRules).toMatch(/\.workflowPrimary[\s\S]*?font-size:\s*(16px|1rem)/)
  })

  it('게시 완료 카드 및 사후 관리 패널의 기본 데스크톱 규칙과 터치 타깃을 정의한다', () => {
    // publishCompletionLink 기본 규칙: min-block-size 44px
    expect(cssContent).toMatch(/\.publishCompletionLink\s*\{[^}]*min-block-size:\s*(44px|48px|2\.75rem)/)

    // careSwitchButton: min-block-size 44px (탭 타깃)
    expect(cssContent).toMatch(/\.careSwitchButton\s*\{[^}]*min-block-size:\s*(44px|48px|2\.75rem)/)

    // careSwitchTrack: 44x24 visual track
    expect(cssContent).toMatch(/\.careSwitchTrack\s*\{[^}]*inline-size:\s*(44px|2\.75rem)/)
    expect(cssContent).toMatch(/\.careSwitchTrack\s*\{[^}]*block-size:\s*(24px|1\.5rem)/)

    // 데스크톱 컴팩트 폰트 크기
    expect(cssContent).toMatch(/\.carePanelTitle\s*\{[^}]*font-size:\s*(0\.75rem|12px)/)
    expect(cssContent).toMatch(/\.careRowLabel\s*\{[^}]*font-size:\s*(0\.75rem|12px)/)
    expect(cssContent).toMatch(/\.careSecondaryRow\s*\{[^}]*font-size:\s*(0\.75rem|12px)/)
    expect(cssContent).toMatch(/\.careDisclaimer\s*\{[^}]*font-size:\s*(11px|0\.6875rem)/)
  })

  describe('CSS 캐스케이드 규칙 평가 (390px 모바일 뷰포트 & 1024px 데스크톱)', () => {
    const publishingHtml = `
      <article class="resultCard">
        <section class="publishingWorkflow">
          <section class="publishContainer">
            <div class="segmentedToggle">
              <button class="segmentButton" data-active="true">지금</button>
              <button class="segmentButton" data-active="false">예약</button>
            </div>
            <label class="compactConsent">
              <input type="checkbox" />
              <span>계정에 지금 게시합니다</span>
            </label>
            <div class="publishStatusRegion">
              <div class="publishStatusItem">
                <span>게시했어요</span>
                <a class="verifiedLink" href="#">게시물 확인하기</a>
              </div>
              <button class="retryButton">다시 시도</button>
              <a class="reconnectButton" href="#">채널 다시 연결</a>
            </div>
            <button class="workflowPrimary" type="button">게시하기</button>
          </section>
        </section>
      </article>
    `

    const reviewDockHtml = `
      <article class="resultCard">
        <section class="publishingWorkflow">
          <div class="reviewDock">
            <button type="button">이미지 바꾸기</button>
            <button type="button">문구 다듬기</button>
            <div>
              <button class="workflowPrimary" type="button">이대로 승인</button>
            </div>
          </div>
          <section class="partialRevisionPanel">
            <div class="partialRevisionActions">
              <button type="button">이미지 추가 생성</button>
              <button type="button">이미지 교체</button>
              <button type="button">본문 수정 지시</button>
              <button type="button">해시태그 수정</button>
            </div>
          </section>
        </section>
      </article>
    `

    const completionCardHtml = `
      <article class="resultCard">
        <div class="publishCompletionCard">
          <div>
            <a class="publishCompletionLink" href="#">게시물 확인하기</a>
          </div>
        </div>
      </article>
    `

    const carePanelHtml = `
      <article class="resultCard">
        <div>
          <h4 class="carePanelTitle">소희가 이어서 할 일</h4>
          <div class="careRow">
            <span class="careRowLabel">댓글 확인 · 답글 초안 준비</span>
            <button class="careSwitchButton" type="button" role="switch">
              <span class="careSwitchTrack"></span>
            </button>
          </div>
          <div class="careSecondaryRow">
            <span>DM 문의</span>
          </div>
          <p class="careDisclaimer">소희는 사장님이 승인하기 전에는 손님에게 먼저 답하지 않아요.</p>
        </div>
      </article>
    `

    it('390px 모바일에서 게시 카드의 주요 액션과 입력은 font-size >= 16px, 터치 높이 >= 44px이다', () => {
      // 1. 게시하기 버튼
      const publishBtnFont = evaluateCascade(cssContent, publishingHtml, '.workflowPrimary', 'font-size', { viewportWidth: 390 })
      expect(publishBtnFont?.valueInPx).toBeGreaterThanOrEqual(16)
      const publishBtnHeight = evaluateCascade(cssContent, publishingHtml, '.workflowPrimary', 'min-block-size', { viewportWidth: 390 })
      expect(publishBtnHeight?.valueInPx).toBeGreaterThanOrEqual(44)

      // 2. 지금/예약 세그먼트 버튼
      const segmentFont = evaluateCascade(cssContent, publishingHtml, '.segmentButton', 'font-size', { viewportWidth: 390 })
      expect(segmentFont?.valueInPx).toBeGreaterThanOrEqual(16)
      const segmentHeight = evaluateCascade(cssContent, publishingHtml, '.segmentButton', 'min-block-size', { viewportWidth: 390 })
      expect(segmentHeight?.valueInPx).toBeGreaterThanOrEqual(44)

      // 3. 동의 라인 및 체크박스 크기
      const consentFont = evaluateCascade(cssContent, publishingHtml, '.compactConsent', 'font-size', { viewportWidth: 390 })
      expect(consentFont?.valueInPx).toBeGreaterThanOrEqual(16)
      const consentHeight = evaluateCascade(cssContent, publishingHtml, '.compactConsent', 'min-block-size', { viewportWidth: 390 })
      expect(consentHeight?.valueInPx).toBeGreaterThanOrEqual(44)
      const checkboxWidth = evaluateCascade(cssContent, publishingHtml, '.compactConsent input[type="checkbox"]', 'min-inline-size', { viewportWidth: 390 })
      expect(checkboxWidth?.valueInPx).toBeGreaterThanOrEqual(24)
      const checkboxHeight = evaluateCascade(cssContent, publishingHtml, '.compactConsent input[type="checkbox"]', 'min-block-size', { viewportWidth: 390 })
      expect(checkboxHeight?.valueInPx).toBeGreaterThanOrEqual(24)

      // 4. 재시도 버튼
      const retryFont = evaluateCascade(cssContent, publishingHtml, '.retryButton', 'font-size', { viewportWidth: 390 })
      expect(retryFont?.valueInPx).toBeGreaterThanOrEqual(16)
      const retryHeight = evaluateCascade(cssContent, publishingHtml, '.retryButton', 'min-block-size', { viewportWidth: 390 })
      expect(retryHeight?.valueInPx).toBeGreaterThanOrEqual(44)
    })

    it('390px 모바일에서 게시 상태 영역 및 확인 링크는 font-size >= 14px이다', () => {
      const statusRegionFont = evaluateCascade(cssContent, publishingHtml, '.publishStatusRegion', 'font-size', { viewportWidth: 390 })
      expect(statusRegionFont?.valueInPx).toBeGreaterThanOrEqual(14)

      const statusItemFont = evaluateCascade(cssContent, publishingHtml, '.publishStatusItem', 'font-size', { viewportWidth: 390 })
      expect(statusItemFont?.valueInPx).toBeGreaterThanOrEqual(14)

      const verifiedLinkFont = evaluateCascade(cssContent, publishingHtml, '.verifiedLink', 'font-size', { viewportWidth: 390 })
      expect(verifiedLinkFont?.valueInPx).toBeGreaterThanOrEqual(14)
      const verifiedLinkHeight = evaluateCascade(cssContent, publishingHtml, '.verifiedLink', 'min-block-size', { viewportWidth: 390 })
      expect(verifiedLinkHeight?.valueInPx).toBeGreaterThanOrEqual(44)
    })

    it('390px 모바일에서 검토 도크의 승인 버튼은 >= 16px, 보조 버튼은 >= 14px, 터치 높이 >= 44px이다', () => {
      // 이대로 승인 버튼 (reviewDock 내부 div 내의 .workflowPrimary)
      const approveFont = evaluateCascade(cssContent, reviewDockHtml, '.reviewDock .workflowPrimary', 'font-size', { viewportWidth: 390 })
      expect(approveFont?.valueInPx).toBeGreaterThanOrEqual(16)
      const approveHeight = evaluateCascade(cssContent, reviewDockHtml, '.reviewDock .workflowPrimary', 'min-block-size', { viewportWidth: 390 })
      expect(approveHeight?.valueInPx).toBeGreaterThanOrEqual(44)

      // 이미지 바꾸기 / 문구 다듬기 (reviewDock > button)
      const dockButtonFont = evaluateCascade(cssContent, reviewDockHtml, '.reviewDock > button', 'font-size', { viewportWidth: 390 })
      expect(dockButtonFont?.valueInPx).toBeGreaterThanOrEqual(14)
      const dockButtonHeight = evaluateCascade(cssContent, reviewDockHtml, '.reviewDock > button', 'min-block-size', { viewportWidth: 390 })
      expect(dockButtonHeight?.valueInPx).toBeGreaterThanOrEqual(44)

      // 부분 수정 액션 버튼
      const partialButtonFont = evaluateCascade(cssContent, reviewDockHtml, '.partialRevisionActions button', 'font-size', { viewportWidth: 390 })
      expect(partialButtonFont?.valueInPx).toBeGreaterThanOrEqual(14)
      const partialButtonHeight = evaluateCascade(cssContent, reviewDockHtml, '.partialRevisionActions button', 'min-block-size', { viewportWidth: 390 })
      expect(partialButtonHeight?.valueInPx).toBeGreaterThanOrEqual(44)
    })

    it('390px 모바일에서 게시 완료 카드 링크는 font-size >= 16px, 터치 높이 >= 44px이다', () => {
      const completionLinkFont = evaluateCascade(cssContent, completionCardHtml, '.publishCompletionLink', 'font-size', { viewportWidth: 390 })
      expect(completionLinkFont?.valueInPx).toBeGreaterThanOrEqual(16)

      const completionLinkHeight = evaluateCascade(cssContent, completionCardHtml, '.publishCompletionLink', 'min-block-size', { viewportWidth: 390 })
      expect(completionLinkHeight?.valueInPx).toBeGreaterThanOrEqual(44)
    })

    it('390px 모바일에서 상세 작업 기록 보기 링크는 font-size >= 14px, 터치 높이 >= 44px이다', () => {
      const resultCardActionHtml = `
        <article class="resultCard">
          <div class="resultActions">
            <a class="detailTextLink" href="#">상세 작업 기록 보기</a>
          </div>
        </article>
      `
      const detailLinkFont = evaluateCascade(cssContent, resultCardActionHtml, '.resultActions a.detailTextLink', 'font-size', { viewportWidth: 390 })
      expect(detailLinkFont?.valueInPx).toBeGreaterThanOrEqual(14)
      const detailLinkHeight = evaluateCascade(cssContent, resultCardActionHtml, '.resultActions a.detailTextLink', 'min-block-size', { viewportWidth: 390 })
      expect(detailLinkHeight?.valueInPx).toBeGreaterThanOrEqual(44)
    })

    it('390px 모바일에서 컴포저 textarea는 font-size >= 16px, 높이 >= 44px이다', () => {
      const shellCssPath = path.resolve(__dirname, 'conversation-shell.module.css')
      const shellCssContent = fs.readFileSync(shellCssPath, 'utf-8')
      const composerHtml = `
        <div class="conversationWorkspace">
          <div class="conversationShell">
            <div class="composerBar">
              <div class="composerField">
                <textarea placeholder="메시지를 입력하세요"></textarea>
              </div>
            </div>
          </div>
        </div>
      `
      const textareaHeight = evaluateCascade(shellCssContent, composerHtml, '.composerField textarea', 'min-block-size', { viewportWidth: 390 })
      expect(textareaHeight?.valueInPx).toBeGreaterThanOrEqual(44)
      const textareaFont = evaluateCascade(shellCssContent, composerHtml, '.composerField textarea', 'font-size', { viewportWidth: 390 })
      expect(textareaFont?.valueInPx).toBeGreaterThanOrEqual(16)
    })

    it('390px 모바일에서 사후 관리 패널의 라벨/타이틀은 >= 16px, 보조 텍스트는 >= 14px, 스위치는 >= 44px이다', () => {
      const titleFont = evaluateCascade(cssContent, carePanelHtml, '.carePanelTitle', 'font-size', { viewportWidth: 390 })
      expect(titleFont?.valueInPx).toBeGreaterThanOrEqual(16)

      const rowLabelFont = evaluateCascade(cssContent, carePanelHtml, '.careRowLabel', 'font-size', { viewportWidth: 390 })
      expect(rowLabelFont?.valueInPx).toBeGreaterThanOrEqual(16)

      const switchHeight = evaluateCascade(cssContent, carePanelHtml, '.careSwitchButton', 'min-block-size', { viewportWidth: 390 })
      expect(switchHeight?.valueInPx).toBeGreaterThanOrEqual(44)

      const secondaryFont = evaluateCascade(cssContent, carePanelHtml, '.careSecondaryRow', 'font-size', { viewportWidth: 390 })
      expect(secondaryFont?.valueInPx).toBeGreaterThanOrEqual(14)

      const disclaimerFont = evaluateCascade(cssContent, carePanelHtml, '.careDisclaimer', 'font-size', { viewportWidth: 390 })
      expect(disclaimerFont?.valueInPx).toBeGreaterThanOrEqual(14)
    })

    it('1024px 데스크톱에서는 기존 컴팩트 폰트 크기가 유지된다', () => {
      // 1. 게시하기 (0.8rem = 12.8px)
      const publishBtnDesktop = evaluateCascade(cssContent, publishingHtml, '.workflowPrimary', 'font-size', { viewportWidth: 1024 })
      expect(publishBtnDesktop?.valueInPx).toBeCloseTo(12.8, 1)

      // 2. 세그먼트 버튼 (0.82rem = 13.12px)
      const segmentDesktop = evaluateCascade(cssContent, publishingHtml, '.segmentButton', 'font-size', { viewportWidth: 1024 })
      expect(segmentDesktop?.valueInPx).toBeCloseTo(13.12, 1)

      // 3. 동의 라인 (0.76rem = 12.16px)
      const consentDesktop = evaluateCascade(cssContent, publishingHtml, '.compactConsent', 'font-size', { viewportWidth: 1024 })
      expect(consentDesktop?.valueInPx).toBeCloseTo(12.16, 1)

      // 4. 상태 영역 (0.78rem = 12.48px)
      const statusDesktop = evaluateCascade(cssContent, publishingHtml, '.publishStatusRegion', 'font-size', { viewportWidth: 1024 })
      expect(statusDesktop?.valueInPx).toBeCloseTo(12.48, 1)

      // 5. reviewDock 버튼 (0.76rem = 12.16px)
      const dockBtnDesktop = evaluateCascade(cssContent, reviewDockHtml, '.reviewDock > button', 'font-size', { viewportWidth: 1024 })
      expect(dockBtnDesktop?.valueInPx).toBeCloseTo(12.16, 1)

      // 6. 완료 링크 (0.75rem = 12px)
      const completionDesktop = evaluateCascade(cssContent, completionCardHtml, '.publishCompletionLink', 'font-size', { viewportWidth: 1024 })
      expect(completionDesktop?.valueInPx).toBeCloseTo(12, 1)

      // 7. 사후 관리 라벨 (0.75rem = 12px)
      const careLabelDesktop = evaluateCascade(cssContent, carePanelHtml, '.careRowLabel', 'font-size', { viewportWidth: 1024 })
      expect(careLabelDesktop?.valueInPx).toBeCloseTo(12, 1)
    })
  })
})


