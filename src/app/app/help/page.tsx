import { ChevronDown, Mail, Phone } from 'lucide-react'
import { V088AppShell } from '@/components/v088/layout/v088-app-shell'
import { SettingsMasterLayout } from '@/components/v088/system/settings-master-layout'
import { SettingsSectionHeader } from '@/components/v088/system/settings-section-header'

interface FaqItem {
  question: string
  answer: string
}

const FAQS: readonly FaqItem[] = [
  {
    question: '채널 연결은 어떻게 하나요?',
    answer:
      '더보기 메뉴의 [채널 연결]에서 인스타그램이나 네이버 블로그를 연결할 수 있어요. 계정 로그인과 권한 확인을 거치면 소희가 가게 소식을 안전하게 전달할 준비를 마쳐요.',
  },
  {
    question: '글은 언제 올라가나요?',
    answer:
      '소희가 가게 일정과 손님들이 주로 방문하는 시간대를 분석해 최적의 시간에 글을 준비해요. 사장님이 내용을 확인하고 승인해 주시면 정해진 시간에 자동으로 발행돼요.',
  },
  {
    question: '게시 전에 왜 승인이 필요한가요?',
    answer:
      '가게의 소중한 브랜드와 사장님의 신뢰를 지키기 위해, 소희는 사장님이 확인하고 승인한 내용만 외부에 올려요. 글이나 사진이 마음에 들지 않으면 언제든 수정하거나 취소할 수 있어요.',
  },
  {
    question: '요금과 해지는 어떻게 문의하나요?',
    answer:
      '이용 요금이나 서비스 해지에 대해 궁금한 점이 있으시면 고객센터(support@example.com) 또는 화면 아래의 문의 버튼을 통해 연락해 주세요. 운영팀에서 내용을 확인하고 친절하고 정확하게 답변해 드려요.',
  },
  {
    question: '궁금한 점은 어디로 문의하나요?',
    answer:
      '이용 중 불편한 점이나 제안하고 싶은 내용이 있다면 화면 아래의 이메일 문의하기 또는 전화 문의하기 버튼을 눌러 고객센터로 편하게 알려주세요. 보내주신 의견은 꼼꼼히 확인하고 빠르게 도와드릴게요.',
  },
  {
    question: '소희가 작성한 글을 수정할 수 있나요?',
    answer:
      '네, 얼마든지 가능해요. [승인 대기]나 [작업] 화면에서 소희가 준비한 글을 누르면 사장님이 원하는 표현이나 사진으로 자유롭게 다듬은 뒤 올릴 수 있어요.',
  },
  {
    question: '고객 예약 알림은 어떻게 받나요?',
    answer:
      '손님이 인스타그램 DM이나 댓글로 예약 문의를 남기면 [소통함]과 [알림]으로 바로 알려드려요. 소희가 준비한 추천 답장을 확인하고 가볍게 보내실 수 있어요.',
  },
]

export default function HelpPage() {
  return (
    <V088AppShell>
      <SettingsMasterLayout>
        <div className="space-y-6 max-w-4xl">
          <SettingsSectionHeader
            title="도움말"
            description="소희를 이용하시면서 자주 묻는 질문들을 모았어요."
          />

          <section aria-label="자주 묻는 질문" className="flex flex-col gap-3">
            {FAQS.map(faq => (
              <details
                key={faq.question}
                className="group rounded-2xl border border-border/70 bg-card p-4 transition-colors open:bg-card/80"
              >
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 text-[15px] font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                  <span>{faq.question}</span>
                  <ChevronDown
                    className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180"
                    aria-hidden="true"
                  />
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {faq.answer}
                </p>
              </details>
            ))}
          </section>

          <footer className="mt-4 rounded-2xl border border-border/70 bg-card p-5">
            <h2 className="text-base font-semibold text-foreground">더 궁금한 점이 있으신가요?</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              궁금한 점이나 도움이 필요하시면 고객센터로 편하게 연락해 주세요.
            </p>
            <div className="mt-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <a
                href="mailto:support@example.com?subject=%EC%86%8C%ED%9D%AC%20%EC%84%9C%EB%B9%84%EC%8A%A4%20%EB%AC%B8%EC%9D%98"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors focus-visible:outline-2 focus-visible:outline-ring"
              >
                <Mail className="size-4" aria-hidden="true" />
                <span>이메일 문의하기</span>
              </a>
              <a
                href="tel:01000000000"
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-border/70 bg-background px-4 py-2.5 text-sm font-medium text-foreground hover:bg-muted/60 transition-colors focus-visible:outline-2 focus-visible:outline-ring"
              >
                <Phone className="size-4 text-muted-foreground" aria-hidden="true" />
                <span>전화 문의하기 (010-0000-0000)</span>
              </a>
            </div>
            <p className="mt-2.5 text-xs text-muted-foreground">
              고객센터 이메일: support@example.com · 전화: 010-0000-0000
            </p>
          </footer>
        </div>
      </SettingsMasterLayout>
    </V088AppShell>
  )
}
