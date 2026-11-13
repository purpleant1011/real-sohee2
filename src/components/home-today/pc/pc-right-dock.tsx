'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Archive,
  Calendar,
  CheckSquare,
  MessageCircle,
  MessageSquarePlus,
  Send,
  Globe,
} from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { useOptionalChatPanel } from '@/features/agent-dock/chat-panel-store'
import { MagicPhotoDropzone } from '@/components/home-today/magic-photo-dropzone'

export interface PcRightDockProps {
  workspaceId: string
  onOpenChat?: () => void
}

export function PcRightDock({ workspaceId, onOpenChat }: PcRightDockProps) {
  const router = useRouter()
  const chatPanel = useOptionalChatPanel()

  const handleStartChat = () => {
    if (onOpenChat) {
      onOpenChat()
      return
    }
    if (chatPanel?.openPanel) {
      chatPanel.openPanel()
      return
    }
    router.push('/app/command?from=' + encodeURIComponent('/app'))
  }

  const shortcuts = [
    {
      title: '가게 정보',
      desc: '공식 SNS 채널 학습',
      href: '/app/settings/business#channel-learning',
      icon: Globe,
      tint: 'bg-primary/10 text-primary',
    },
    {
      title: '소통함',
      desc: '댓글과 메시지 관리',
      href: '/app/engagement',
      icon: MessageCircle,
      tint: 'bg-state-ok-soft text-state-ok',
    },
    {
      title: '승인 대기',
      desc: '소희 작성물 확인',
      href: '/app/approvals',
      icon: CheckSquare,
      tint: 'bg-primary/10 text-primary',
    },
    {
      title: '예약 일정',
      desc: '고객 예약 일정표',
      href: '/app/schedule',
      icon: Calendar,
      tint: 'bg-state-wait-soft text-state-wait',
    },
    {
      title: '보관함',
      desc: '발행된 콘텐츠 기록',
      href: '/app/vault',
      icon: Archive,
      tint: 'bg-state-warn-soft text-state-warn',
    },
  ]

  return (
    <div className="space-y-4">
      {/* 1. 소희에게 일 맡기기 */}
      <Card className="rounded-2xl border border-primary/20 bg-primary/5 shadow-xs">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <MessageSquarePlus className="size-4 text-primary" />
            <CardTitle className="text-base font-semibold text-foreground">
              소희에게 일 맡기기
            </CardTitle>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            가게 소식이나 안내를 부탁해 보세요.
          </p>
        </CardHeader>

        <CardContent className="pt-2">
          <Button
            onClick={handleStartChat}
            variant="outline"
            className="w-full justify-between h-11 px-3.5 bg-background hover:bg-muted/50 border-border/80 text-left font-normal text-muted-foreground rounded-xl"
            aria-label="소희에게 일 맡기기 대화 열기"
          >
            <span className="truncate text-xs">무엇이든 지시해 보세요…</span>
            <Send className="size-3.5 shrink-0 text-primary" />
          </Button>
        </CardContent>
      </Card>

      {/* 2. 사진으로 글 만들기 CTA */}
      <MagicPhotoDropzone workspaceId={workspaceId} />

      {/* 3. 바로가기 */}
      <Card className="rounded-2xl border border-border/80 bg-card shadow-xs">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-foreground">
            바로가기
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-1 gap-2.5 xl:grid-cols-2">
            {shortcuts.map(({ title, desc, href, icon: Icon, tint }) => (
              <Link
                key={href}
                href={href}
                className="group flex flex-col justify-between rounded-xl border border-border/70 bg-card p-3 transition-all hover:bg-muted/40 hover:border-primary/40 hover:shadow-2xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold whitespace-nowrap text-foreground group-hover:text-primary transition-colors">
                    {title}
                  </span>
                  <div className={`flex size-6 items-center justify-center rounded-md shrink-0 transition-transform group-hover:scale-105 ${tint}`}>
                    <Icon className="size-3.5" />
                  </div>
                </div>
                <span className="mt-1.5 text-[11px] text-muted-foreground truncate group-hover:text-foreground/80 transition-colors">
                  {desc}
                </span>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
