'use client'

import { useState } from 'react'

import { ChatComposer, ChatTranscript } from '@/features/mobile-chat/chat-parts'
import type { ChatBubble } from '@/features/mobile-chat/transcript'

/**
 * 긴 원고 표시·입력 검수용 미리보기. 서버 호출·전송 없이 화면 상태만 확인한다.
 * 접힌 버블(더 보기), 긴 초안 글자 수, 길게 쓰기 편집기를 한 화면에서 본다.
 */

const OWNER_TEXT =
  '이번 주 인스타그램에 올릴 글을 준비해 주세요. 매장에서 가장 인기 있는 시술 두 가지를 소개하고, 이번 달 예약 고객님께 드리는 안내도 함께 넣어 주세요.\n\n' +
  '사진은 지난달에 찍어 둔 것 중에서 골라 주시고, 문구는 너무 딱딱하지 않게 사장님이 직접 말하듯이 써 주세요. 게시 시간은 평일 저녁 일곱 시쯤으로 생각하고 있어요. 예약 고객님께는 미리 안내 문자가 가도록 준비해 주시고, 게시 전에 사진과 문구를 한 번 더 확인할 수 있게 해 주세요. 그리고 이번 주에 새로 시작하는 이벤트가 있으면 함께 소개하고 싶으니, 지난번에 정리해 둔 안내 문구도 참고해 주세요. 잘 부탁드려요. 급하지는 않으니 내일 오전까지 천천히 봐 주세요.'

const SOHEE_TEXT =
  '이번 주 게시물 초안을 세 가지로 준비했어요. 첫 번째는 매장에서 가장 인기 있는 시술을 소개하는 글이고, 두 번째는 이번 달 예약 고객님께 드리는 안내, 세 번째는 새로 들여온 제품을 소개하는 글이에요.\n\n' +
  '어느 쪽으로 진행할지 알려 주시면 사진과 문구를 함께 다듬어서 바로 올릴 수 있게 준비할게요. 참고로 지난달 같은 요일 게시물보다 이번 초안이 저장 수가 더 많이 나올 것으로 보여요. 사진 후보도 세 장 골라 두었어요. 밝은 조명에서 찍은 사진과 매장 전경이 섞여 있고, 어느 사진을 첫 장으로 쓸지 정해 주시면 나머지 순서를 맞춰 볼게요. 게시 시간은 저녁 일곱 시로 잡아 두었고, 올리기 전에 사장님 확인을 한 번 받은 뒤에 진행할게요.'

const EXAMPLE_BUBBLES: readonly ChatBubble[] = [
  { id: 'ex-1', role: 'owner', text: OWNER_TEXT, pending: false, evidence: [], approval: null },
  { id: 'ex-2', role: 'sohee', text: SOHEE_TEXT, pending: false, evidence: [], approval: null },
]

const LONG_DRAFT =
  '다음 주에 올릴 게시물 문구를 미리 길게 적어 둘게요. 매장 분위기를 소개하는 문장으로 시작하고, 시술 이름과 걸리는 시간, 예약 방법을 차례대로 넣어 주세요.\n\n' +
  '마지막에는 이번 주 예약 고객님께 드리는 안내 문장을 넣고, 사진은 밝은 조명에서 찍은 것으로 골라 주세요. 문구가 너무 길면 두 번에 나눠 올려도 괜찮아요. 예약 문의가 많이 오는 시간대도 함께 적어 두면 좋겠어요. 그리고 사진은 세 장까지 붙일 수 있으니, 첫 장은 매장 전경으로 하고 나머지는 시술 사진으로 채워 주세요.'

export function MobileChatLongFormPreview() {
  const [draft, setDraft] = useState(LONG_DRAFT)

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-[390px] flex-col bg-background">
      <div className="flex-1 space-y-4 px-4 py-4">
        <header className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">긴 원고 검수 화면</h1>
          <p className="text-sm leading-relaxed text-muted-foreground">
            예시 화면이에요. 여기서 고친 내용은 서버로 보내지 않고 이 브라우저 안에만 남아요.
          </p>
        </header>

        <ChatTranscript bubbles={EXAMPLE_BUBBLES} />

        <section aria-label="확인할 상태" className="rounded-2xl border border-border bg-card p-4">
          <p className="text-sm font-medium">확인할 상태</p>
          <ul className="mt-1 list-inside list-disc text-sm leading-relaxed text-muted-foreground">
            <li>긴 대화는 여덟 줄에서 접히고 더 보기로 펼쳐져요.</li>
            <li>긴 초안에는 입력창 위에 글자 수가 붙어요.</li>
            <li>길게 쓰기를 누르면 같은 초안을 큰 화면에서 고칠 수 있어요.</li>
          </ul>
        </section>
      </div>

      <ChatComposer value={draft} onChange={setDraft} onSubmit={() => setDraft('')} />
    </div>
  )
}
