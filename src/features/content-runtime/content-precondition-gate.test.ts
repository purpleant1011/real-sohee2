import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { ContentCtaPreconditionGate } from './content-precondition-gate'

const gate = new ContentCtaPreconditionGate()

describe('업무 시작 안내의 쉬운 한국어', () => {
  it('가게 말투 설정이 필요할 때 개발 용어 대신 다음 행동을 안내한다', () => {
    const result = gate.evaluate({ workspaceId: 'store-a', isHarnessReady: false, connectedChannels: [], availableCredits: 0, requiredCredits: 99 })
    expect(result.canProceed).toBe(false)
    expect(result.primaryCta.label).toBe('가게 말투 설정하기')
    expect(result.primaryCta.targetUrl).toBe('/app/brand-voice')
    expect(result.blockedReasons.join(' ')).not.toMatch(/하네스|프로필|브랜드 보이스|크레딧|99|보유|필요:/)
  })

  it('한도가 부족해도 사용 가능 판정은 그대로 두고 숫자 없는 안내를 표시한다', () => {
    const result = gate.evaluate({ workspaceId: 'store-a', isHarnessReady: true, connectedChannels: ['INSTAGRAM_FEED'], availableCredits: 1, requiredCredits: 99 })
    expect(result.hasSufficientCredits).toBe(false)
    expect(result.canProceed).toBe(false)
    expect(result.primaryCta.label).toBe('이용 한도 확인하기')
    expect(result.blockedReasons.join(' ')).toBe('현재 이용 한도에 도달했어요. 이용 안내를 확인해 주세요.')
  })

  it('가게 말투 저장 응답에 내부 명칭을 넣거나 오류 원문을 노출하지 않는다', () => {
    const source = readFileSync(`${process.cwd()}/src/app/api/onboarding/text-harness/confirm/route.ts`, 'utf8')
    const file = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true)
    const messages: string[] = []
    function visit(node: ts.Node) {
      if (ts.isPropertyAssignment(node) && ['error', 'message'].includes(node.name.getText(file)) && ts.isStringLiteral(node.initializer)) messages.push(node.initializer.text)
      ts.forEachChild(node, visit)
    }
    visit(file)
    expect(messages.length).toBeGreaterThan(4)
    expect(messages.join(' ')).not.toMatch(/하네스|워크스페이스|인증 세션|draft|DB|TEXT_HARNESS/)
    expect(source).not.toContain('error: (err as Error).message')
  })
})
