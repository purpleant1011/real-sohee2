import type { DockIntentResult } from './dock-actions'

const POST_REQUEST = /(?:글|게시물|포스트|피드|소식|콘텐츠).*(?:올려|써\s*줘|작성|만들|초안|게시|발행)|(?:올려|써\s*줘|작성|만들|초안|게시|발행).*(?:글|게시물|포스트|피드|소식|콘텐츠)/
const ACTION_REQUEST = /(?:이동|열어|보여|가자|들어가|연결|보고\s*싶|만들|써\s*줘|작성|올려|게시|발행|확인|알려)/
const NEGATED = /(?:하지\s*마|말아\s*줘|안\s*(?:할|해|올려|보여|연결)|취소|필요\s*없)/

const PLAN_DIFF_REQUEST = /(?:계획\s*(?:변경|수정)|작업\s*계획.*(?:바꿔|수정|변경)|단계\s*(?:추가|수정|변경)|플랜\s*(?:수정|변경)|(?:인스타|스레드|threads|채널).*(?:만|빼고|제외|추가|그대로)|(?:예산|비용).*(?:그대로|올려|줄여|늘려|변경|수정))/i
const MISSION_ID_REGEX = /[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i

export interface DockIntentContext {
  missionId?: string
}

function postTopic(text: string): string | null {
  const topic = text
    .replace(/^(?:소희[야,]?\s*|사장님[,.]?\s*)/, '')
    .replace(/(?:글|게시물|포스트|피드|소식|콘텐츠)(?:을|를|로|에|은|는)?\s*(?:하나|좀)?\s*(?:작성|만들|써\s*줘|올려\s*줘|올려|게시|발행|초안)?.*$/u, '')
    .replace(/\s*(?:인스타그램|인스타|스레드|threads)(?:에|로)?\s*$/i, '')
    .replace(/\s*(?:에\s*)?(?:대해|관한|관련)\s*$/u, '')
    .trim()
  return topic.length > 0 && topic.length <= 300 ? topic : null
}

/** Returns null for ambiguous turns, leaving the established agent chat pipeline intact. */
export function classifyDockIntent(input: string, context?: DockIntentContext): DockIntentResult | null {
  const text = input.trim().replace(/\s+/g, ' ')
  if (!text || text.length > 500 || NEGATED.test(text)) return null

  const explicitMissionMatch = text.match(MISSION_ID_REGEX)
  const effectiveMissionId = context?.missionId || explicitMissionMatch?.[0]

  // Mission-scoped pause and plan diff intent (Task 4)
  if (effectiveMissionId) {
    if (/(?:일시\s*정지|잠시\s*멈춰|잠깐\s*멈춰|작업\s*중단|미션\s*중단|중단해\s*줘|멈춰\s*줘|정지해\s*줘|작업\s*멈춰|미션\s*멈춰|잠깐\s*중단)/.test(text)) {
      return {
        reply: '진행 중인 작업을 안전하게 일시 정지할게요. 버튼을 눌러 작업을 일시 정지해 주세요.',
        actions: [{ type: 'pause_mission', missionId: effectiveMissionId }],
      }
    }

    if (PLAN_DIFF_REQUEST.test(text)) {
      return {
        reply: '요청하신 변경 내용으로 계획 변경안을 생성하고 검토하실 수 있어요. 아래 버튼을 눌러 변경안을 확인해 주세요.',
        actions: [{ type: 'propose_plan_diff', missionId: effectiveMissionId, description: text, rawQuery: text }],
      }
    }
  }

  // Publishing always stops at the existing content hub's explicit approval flow.
  if (/발행|게시/.test(text) && /(?:이|그|해당|지금|바로|현재).*(?:게시물|초안|버전|글)/.test(text)) {
    return {
      reply: '사장님, 콘텐츠에서 미리보기를 확인하고 직접 승인해 주세요. 대화만으로 발행하지는 않아요.',
      actions: [{ type: 'open_content' }],
    }
  }

  if (POST_REQUEST.test(text) && !/\?|\b(?:어떻게|왜)\b/.test(text)) {
    const topic = postTopic(text)
    if (topic) return {
      reply: `사장님, "${topic}" 소식의 글과 사진을 초안으로 만들어 드릴게요. 미리보기를 확인한 뒤 발행 여부를 결정해 주세요.`,
      actions: [{ type: 'create_post', topic }],
    }
  }

  if (!ACTION_REQUEST.test(text)) return null

  if (/인스타(?:그램)?|instagram/i.test(text) && /연결/.test(text)) {
    return { reply: '인스타그램을 연결할 수 있는 화면을 열어 드릴게요.', actions: [{ type: 'connect_channel', channel: 'instagram' }] }
  }
  if (/스레드|threads/i.test(text) && /연결/.test(text)) {
    return { reply: '스레드를 연결할 수 있는 화면을 열어 드릴게요.', actions: [{ type: 'connect_channel', channel: 'threads' }] }
  }
  if (/성과|실적|결과|통계/.test(text)) {
    return { reply: '성과 화면에서 결과를 확인해 주세요.', actions: [{ type: 'show_results' }] }
  }
  if (/콘텐츠|게시물|초안/.test(text) && /미리보기|확인/.test(text)) {
    return { reply: '콘텐츠에서 작성된 초안을 확인해 주세요. 발행에는 사장님의 승인이 필요해요.', actions: [{ type: 'open_content' }] }
  }

  const routes: [RegExp, string, string][] = [
    [/콘텐츠|게시물|초안/, '/app/content', '콘텐츠'],
    [/고객/, '/app/customers', '고객'],
    [/성과|실적|결과/, '/app/results', '성과'],
    [/설정/, '/app/system', '설정'],
    [/^(?:홈|처음|메인)/, '/app', '홈'],
  ]
  if (!/이동|열어|보여|가자|들어가/.test(text)) return null
  for (const [pattern, path, label] of routes) {
    if (pattern.test(text)) return { reply: `${label} 화면으로 이동할 수 있어요.`, actions: [{ type: 'navigate', path }] }
  }
  return null
}
