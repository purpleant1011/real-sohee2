/**
 * 서버 확정 버블과 방금 보낸 대기 버블을 합친다.
 *
 * 서버 transcript 에 이미 같은 사장님 본문이 있으면 대기 버블은 중복이므로 버린다.
 * 확정 버블의 순서는 그대로 두고, 살아남은 대기 버블만 뒤에 붙인다.
 */

import type { ChatBubble } from './transcript'

function ownerTextKey(text: string): string {
  return text.trim()
}

export function mergeBubbles(
  confirmed: readonly ChatBubble[],
  queued: readonly ChatBubble[],
): ChatBubble[] {
  const confirmedIds = new Set(confirmed.map(bubble => bubble.id))
  const confirmedOwnerTexts = new Set(
    confirmed
      .filter(bubble => bubble.role === 'owner')
      .map(bubble => ownerTextKey(bubble.text))
      .filter(text => text !== ''),
  )

  const merged: ChatBubble[] = [...confirmed]

  for (const bubble of queued) {
    if (confirmedIds.has(bubble.id)) continue

    const isEcho =
      bubble.role === 'owner' && confirmedOwnerTexts.has(ownerTextKey(bubble.text))
    if (isEcho) continue

    confirmedIds.add(bubble.id)
    merged.push(bubble)
  }

  return merged
}
