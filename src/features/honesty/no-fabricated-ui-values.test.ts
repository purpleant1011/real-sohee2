import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 가짜 값 금지 가드.
 * 무거운 클라이언트 페이지를 렌더하지 않고도 "이 리터럴이 UI 소스로 되돌아오지 않는다"를 고정한다.
 * 실제 렌더 단언은 각 컴포넌트의 동반 테스트(CampaignBrainWorkspace, channel-control-center,
 * v085-command-center, opportunity-read-model)가 담당한다.
 */
const root = path.resolve(__dirname, '../../..')

function read(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

const FORBIDDEN = [
  {
    file: 'src/app/app/content/content-view.tsx',
    patterns: [/신뢰도 92%/],
    why: '신뢰도 비율은 실측 산출값이 있어야만 표시한다.',
  },
  {
    file: 'src/app/app/inbox/inbox-legacy.tsx',
    patterns: [/label: "카카오톡", count: 1/, /label: "인스타그램 DM", count: 1/, /label: "네이버 톡톡", count: 1/],
    why: '채널 탭 카운트는 실제 대화에서 센다.',
  },
  {
    file: 'src/components/v088/agent-studio/credits-and-intelligence-view.tsx',
    patterns: [/총 28건 발행/, /총 84건 응대/, /총 12편 발행/, /인기 계정 6개 분석/],
    why: '활동 건수는 측정값이 있어야 표시한다.',
  },
  {
    file: 'src/components/v089/channel-control-center.tsx',
    patterns: [/실게시 검증 완료/, /인증 성공\)/, /잠긴 메뉴들을 모두 해금/],
    why: '연결 상태를 게시 검증 완료로 승격하지 않는다.',
  },
  {
    file: 'src/features/campaigns/CampaignBrainWorkspace.tsx',
    patterns: [/availableCredits = 40000/, /businessName = '바이름'/, /잔여 슬롯 12건/, /예약 15건 달성/, /현재 3건 확정/],
    why: '잔여 크레딧·예약 건수는 실측값만 표시한다.',
  },
  {
    file: 'src/features/home/v085-command-center.tsx',
    patterns: [/SAMPLE_COMPILED_PLANS/, /미예약 14명/, /약 120 ~ 170 credits/],
    why: '계획 수립 API 연결 전에는 샘플 계획을 결과로 내놓지 않는다.',
  },
  {
    file: 'src/lib/read-models/opportunity-read-model.ts',
    patterns: [/void isDemo/],
    why: 'isDemo 플래그를 버리면 예시 데이터가 실측처럼 노출된다.',
  },
]

describe('가짜 값 금지 가드', () => {
  for (const rule of FORBIDDEN) {
    it(`${rule.file} — ${rule.why}`, () => {
      const source = read(rule.file)
      for (const pattern of rule.patterns) {
        expect(source).not.toMatch(pattern)
      }
    })
  }

  it('marketing-calendar 는 예시 일정을 기본으로 켜지 않는다', () => {
    const source = read('src/components/v088/calendar/marketing-calendar.tsx')

    expect(source).not.toMatch(/isTestAccount = true/)
    expect(source).toMatch(/isTestAccount = false/)
  })
})
