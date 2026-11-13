import { describe, expect, it } from 'vitest'
import { getMobileTab, getMobileMode, resolveMobileUiEnabled } from './navigation'
import { resolveRoute } from '@/features/mobile-shell/routes'

describe('mobile navigation and rollout', () => {
  it.each([
    ['/app', 'today'], ['/app/vault', 'work'], ['/app/content', 'work'],
    ['/app/content-other', 'more'], ['/app/engagement', 'customers'], ['/app/customers', 'customers'],
    ['/app/results', 'results'], ['/app/sohee', 'more'], ['/app/system', 'more'],
  ])('assigns %s to %s', (path, expected) => expect(getMobileTab(path)).toBe(expected))
  it('gives chat and review a single exclusive bottom surface', () => {
    expect(getMobileMode('/app', true)).toBe('chat')
    expect(getMobileMode('/app/approvals', false)).toBe('review')
    expect(getMobileMode('/app/work/post-1/edit', false)).toBe('review')
    expect(getMobileMode('/app/content', false)).toBe('browse')
  })
  // ANI-1664-7 / ANI-1665-1: /app/command 는 자체 입력을 가진 CHAT 화면(routes.ts M10)이다.
  // browse 로 새면 5탭과 전역 커맨드바가 함께 떠 입력이 중복된다.
  it('treats the command screen as chat so its input stays single', () => {
    expect(getMobileMode('/app/command', false)).toBe('chat')
    expect(getMobileMode('/app/command/anything', false)).toBe('chat')
    expect(getMobileMode('/app/command', true)).toBe('chat')
    expect(getMobileMode('/app/commands', false)).toBe('browse')
  })
  it('treats canonical conversations as chat without matching similarly named routes', () => {
    expect(getMobileMode('/app/conversations', false)).toBe('chat')
    expect(getMobileMode('/app/conversations/thread-1', false)).toBe('chat')
    expect(getMobileMode('/app/conversations-other', false)).toBe('browse')
    expect(resolveRoute('/app/conversations')?.mode).toBe('CHAT')
    expect(resolveRoute('/app/conversations/thread-1')?.mode).toBe('CHAT')
  })
  it('defaults off and rejects wildcard rollout', () => {
    expect(resolveMobileUiEnabled(undefined, 'a', 'a')).toBe(false)
    expect(resolveMobileUiEnabled('1', '*', 'a')).toBe(false)
    expect(resolveMobileUiEnabled('1', 'a,b', 'a')).toBe(true)
    expect(resolveMobileUiEnabled('1', 'a,b', 'c')).toBe(false)
    expect(resolveMobileUiEnabled('1', '', '')).toBe(false)
  })
})
