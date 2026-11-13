import type { JobKey, JobResult, MembershipTierKey, RequirementKey, RequirementResult } from './types'

/** 체험 회원이 만들 수 있는 첫 게시물 수 (src/features/membership/membership-tier.ts 의 TRIAL_FIRST_POST_LIMIT 와 같아야 한다). */
const TRIAL_POST_LIMIT = 2

interface JobDef {
  key: JobKey
  label: string
  requires: RequirementKey[]
  mode: 'full' | 'preview_only' | 'coming_soon'
  formalOnly: boolean
}

const JOB_DEFS: JobDef[] = [
  { key: 'post_social', label: '인스타·스레드 게시', requires: ['shop_basic', 'voice', 'caution', 'image_style', 'channel'], mode: 'full', formalOnly: false },
  { key: 'reply_comments', label: '댓글 답변', requires: ['shop_basic', 'voice', 'caution', 'image_style', 'channel', 'faq'], mode: 'full', formalOnly: true },
  { key: 'write_blog', label: '블로그 글 작성', requires: ['shop_basic', 'voice', 'caution', 'products', 'manual'], mode: 'preview_only', formalOnly: true },
  { key: 'write_daangn', label: '당근 글 작성', requires: ['shop_basic', 'voice', 'caution', 'products', 'manual'], mode: 'preview_only', formalOnly: true },
  { key: 'booking_guide', label: '예약·예약금 안내', requires: ['shop_basic', 'products', 'booking_rules', 'manual'], mode: 'full', formalOnly: true },
  { key: 'kakao_1on1', label: '카카오톡 1:1 상담', requires: [], mode: 'coming_soon', formalOnly: true },
]

/** "남은 일" 한 줄: 양이 남은 요건은 "이름 N개 더", 아니면 요건 이름 그대로. */
function missingNote(missing: RequirementResult[]): string {
  const first = missing[0]
  if (!first) return ''
  if (first.remaining) return `${first.label.replace(/ 알려주기$/, '')} ${first.remaining}`
  return first.label
}

export function evaluateJobs(requirements: RequirementResult[], tier: MembershipTierKey): JobResult[] {
  const byKey = new Map(requirements.map((r) => [r.key, r]))

  return JOB_DEFS.map((def): JobResult => {
    const needed = def.requires.map((key) => byKey.get(key)).filter((r): r is RequirementResult => Boolean(r))
    const missing = needed.filter((r) => !r.done)
    const base = {
      key: def.key,
      label: def.label,
      needed: def.mode === 'coming_soon' ? [] : needed,
      missing,
    }

    if (def.mode === 'coming_soon') return { ...base, status: 'coming_soon', note: '곧 열려요' }
    if (def.formalOnly && tier !== 'FORMAL') return { ...base, status: 'membership', note: '정식회원이 되면 열려요' }

    if (missing.length === 0) {
      if (def.mode === 'preview_only') return { ...base, status: 'preview_only', note: '미리보기까지 가능' }
      const note = def.key === 'post_social'
        ? tier === 'FORMAL' ? '승인 후 실행' : `체험 기간에는 첫 게시물 ${TRIAL_POST_LIMIT}건까지`
        : '승인 후 실행'
      return { ...base, status: 'available', note }
    }

    const doneCount = needed.length - missing.length
    const status = doneCount >= Math.ceil(needed.length / 2) ? 'learning' : 'locked'
    return { ...base, status, note: missingNote(missing) }
  })
}
