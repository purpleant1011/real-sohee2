import { describe, expect, it } from 'vitest'
import { classifyDockIntent } from '../classify-dock-intent'
import { parseDockActions, serializeDockActions } from '../dock-actions'

describe('Dock 의도 분류 (모델 없이 동작하는 빠른 경로)', () => {
  it('주말 신메뉴 게시 요청은 발행이 아닌 초안 제안으로 분류한다', () => {
    expect(classifyDockIntent('이번 주말 신메뉴 글 올려줘')).toEqual({
      reply: '사장님, "이번 주말 신메뉴" 소식의 글과 사진을 초안으로 만들어 드릴게요. 미리보기를 확인한 뒤 발행 여부를 결정해 주세요.',
      actions: [{ type: 'create_post', topic: '이번 주말 신메뉴' }],
    })
  })

  it('화면 이동과 채널 연결 및 성과 조회를 분류한다', () => {
    expect(classifyDockIntent('콘텐츠 메뉴로 이동해줘')?.actions).toEqual([{ type: 'navigate', path: '/app/content' }])
    expect(classifyDockIntent('스레드 연결해줘')?.actions).toEqual([{ type: 'connect_channel', channel: 'threads' }])
    expect(classifyDockIntent('인스타그램 연결하고 싶어')?.actions).toEqual([{ type: 'connect_channel', channel: 'instagram' }])
    expect(classifyDockIntent('성과 보여줘')?.actions).toEqual([{ type: 'show_results' }])
    expect(classifyDockIntent('콘텐츠 미리보기 보여줘')?.actions).toEqual([{ type: 'open_content' }])
  })

  it('발행을 요구해도 자동 발행하지 않고 승인 화면으로 안내한다', () => {
    expect(classifyDockIntent('이 게시물 지금 바로 발행해줘')?.actions).toEqual([{ type: 'open_content' }])
    expect(classifyDockIntent('이 게시물 지금 바로 발행해줘')?.reply).toContain('직접 승인')
  })

  it('현재 글 발행 요청과 조건 없는 글 요청은 바로 실행하지 않는다', () => {
    expect(classifyDockIntent('이 글 지금 발행해줘')?.actions).toEqual([{ type: 'open_content' }])
    expect(classifyDockIntent('글 하나 써줘')).toBeNull()
    expect(classifyDockIntent('인스타그램에 글 올려줘')).toBeNull()
  })

  it('모호한 요청, 부정문, 제어 명령은 기존 채팅/제어 경로에 맡긴다', () => {
    expect(classifyDockIntent('손님에게 어떤 말을 하면 좋을까?')).toBeNull()
    expect(classifyDockIntent('오늘은 글 올리지 마')).toBeNull()
    expect(classifyDockIntent('잠깐 멈춰')).toBeNull()
    expect(classifyDockIntent('계획 변경해줘')).toBeNull()
    expect(classifyDockIntent('')).toBeNull()
  })

  it('미션 스코프가 명시된 경우 일시정지 및 계획 변경 제안을 생성한다', () => {
    const missionId = '223e4567-e89b-42d3-a456-426614174000'
    const pauseIntent = classifyDockIntent('작업 잠깐 멈춰줘', { missionId })
    expect(pauseIntent?.actions).toEqual([{ type: 'pause_mission', missionId }])
    expect(pauseIntent?.reply).toContain('일시 정지')

    const diffIntent = classifyDockIntent('작업 계획 변경해줘', { missionId })
    expect(diffIntent?.actions).toEqual([{
      type: 'propose_plan_diff',
      missionId,
      description: '작업 계획 변경해줘',
      rawQuery: '작업 계획 변경해줘',
    }])
    expect(diffIntent?.reply).toContain('계획 변경안')

    const naturalPhraseIntent = classifyDockIntent('인스타만, 예산 그대로', { missionId })
    expect(naturalPhraseIntent?.actions).toEqual([{
      type: 'propose_plan_diff',
      missionId,
      description: '인스타만, 예산 그대로',
      rawQuery: '인스타만, 예산 그대로',
    }])
  })
})

describe('Dock 액션 직렬화와 신뢰 경계', () => {
  it('주제 인코딩과 JSON 왕복 시 허용된 액션만 유지한다', () => {
    const actions = [
      { type: 'create_post', topic: '주말 신메뉴 & 할인?' },
      { type: 'open_content', missionId: '223e4567-e89b-42d3-a456-426614174000' },
      { type: 'navigate', path: '/app/content' },
      { type: 'connect_channel', channel: 'instagram' },
      { type: 'show_results' },
      { type: 'pause_mission', missionId: '223e4567-e89b-42d3-a456-426614174000' },
      { type: 'propose_plan_diff', missionId: '223e4567-e89b-42d3-a456-426614174000', description: '예산 수정' },
    ]
    expect(parseDockActions(JSON.parse(serializeDockActions(actions)))).toEqual(actions)
  })

  it('외부 경로, 스크립트 URL, 발행 명령 및 손상된 액션을 거부한다', () => {
    expect(parseDockActions([
      { type: 'navigate', path: 'javascript:alert(1)' },
      { type: 'navigate', path: '//evil.example' },
      { type: 'publish', missionId: '223e4567-e89b-42d3-a456-426614174000' },
      { type: 'create_post', topic: ' ' },
      { type: 'create_post', topic: 'x'.repeat(301) },
      { type: 'open_content', missionId: 'not-a-uuid' },
      { type: 'connect_channel', channel: 'other' },
    ])).toEqual([])
  })
})
