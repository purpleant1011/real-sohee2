export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { authorizeQuickRequest, isResponse } from '@/features/quick-start/route-auth'
import { readWorkspaceDataset } from '@/features/reporting/dataset'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function GET(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const { workspaceId } = await params
  try {
    const auth = await authorizeQuickRequest(workspaceId)
    if (isResponse(auth)) return auth

    if (auth.workspaceId !== workspaceId) return NextResponse.json({ error: '기록을 찾을 수 없어요.' }, { status: 404, headers: NO_STORE })
    const admin = auth.admin
    const dataset = await readWorkspaceDataset(admin, auth.workspaceId)
    if (dataset.state === 'ERROR') return NextResponse.json({ error: '자료 분류를 확인하지 못했어요.' }, { status: 503, headers: NO_STORE })
    if (dataset.mode !== 'ACTUAL') return NextResponse.json({
      items: [], reservations: [], datasetMode: dataset.mode,
      kpis: { inquiryCount: null, pendingCount: null, bookedCount: null, canceledCount: null, conversionRate: null },
    }, { headers: NO_STORE })

    // 1. Fetch DM Threads
    const { data: dmThreads, error: threadsError } = await admin
      .from('instagram_dm_threads')
      .select('*')
      .eq('workspace_id', auth.workspaceId)
      .order('last_message_at', { ascending: false })

    if (threadsError || !Array.isArray(dmThreads)) return NextResponse.json({ error: '고객 문의를 조회하지 못했어요.' }, { status: 503, headers: NO_STORE })
    const threads = dmThreads
    const threadIds = threads.map((t: any) => t.id)

    // 2. Fetch Messages for Threads
    const messagesByThread: Record<string, any[]> = {}
    if (threadIds.length > 0) {
      const { data: messages, error: messagesError } = await admin
        .from('instagram_dm_messages')
        .select('*')
        .eq('workspace_id', auth.workspaceId)
        .in('thread_id', threadIds)
        .order('sent_at', { ascending: true })

      if (messagesError || !Array.isArray(messages)) return NextResponse.json({ error: '고객 대화를 조회하지 못했어요.' }, { status: 503, headers: NO_STORE })
      if (Array.isArray(messages)) {
        for (const m of messages) {
          if (!messagesByThread[m.thread_id]) messagesByThread[m.thread_id] = []
          messagesByThread[m.thread_id].push(m)
        }
      }
    }

    // 3. Fetch Reservations
    const { data: reservationsData, error: reservationsError } = await admin
      .from('reservations')
      .select('*')
      .eq('workspace_id', auth.workspaceId)
      .order('created_at', { ascending: false })

    if (reservationsError || !Array.isArray(reservationsData)) return NextResponse.json({ error: '예약을 조회하지 못했어요.' }, { status: 503, headers: NO_STORE })
    const reservations = [...new Map(reservationsData.map((row: any) => [row.id, row])).values()]

    // 4. Map DM Threads to Pipeline items
    const items = threads.map((t: any) => {
      const msgs = messagesByThread[t.id] || []
      const history = msgs.map((m: any) => ({
        sender: m.sender_type === 'business' ? ('sohee' as const) : ('customer' as const),
        text: m.text,
        time: m.sent_at ? new Date(m.sent_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '',
      }))

      const isBookingQuery = /예약|일정|가격|얼마|비용|시간|방문/i.test(t.last_message_text || '')
      let stage: 'inquiry' | 'deposit_pending' | 'booked' | 'completed' = 'inquiry'
      let stageLabel = '문의 접수'
      let stageColor = 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'

      if (t.status === 'SENT') {
        stage = 'deposit_pending'
        stageLabel = '예약 조율 중'
        stageColor = 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
      } else if (t.status === 'EXPIRED') {
        stage = 'inquiry'
        stageLabel = '상담 만료'
        stageColor = 'bg-zinc-100 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-300'
      } else if (isBookingQuery) {
        stage = 'inquiry'
        stageLabel = '예약 문의'
        stageColor = 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
      }

      const hoursAgo = Math.max(0, Math.floor((Date.now() - new Date(t.last_message_at).getTime()) / (1000 * 3600)))
      const lastMessageTime = hoursAgo < 1 ? '방금 전' : `${hoursAgo}시간 전`

      return {
        id: t.id,
        threadId: t.id,
        name: t.customer_name || t.customer_handle || '인스타그램 고객',
        handle: t.customer_handle ? `@${t.customer_handle.replace(/^@/, '')}` : '@고객',
        channel: 'instagram' as const,
        channelLabel: '인스타 DM',
        channelColor: 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300',
        lastMessage: t.last_message_text,
        lastMessageTime,
        urgency: isBookingQuery ? ('high' as const) : ('medium' as const),
        bookingIntent: isBookingQuery,
        stage,
        stageLabel,
        stageColor,
        unread: t.status === 'NEEDS_REPLY',
        dialogueHistory: history.length > 0 ? history : [
          { sender: 'customer' as const, text: t.last_message_text, time: lastMessageTime },
        ],
      }
    })

    // 5. KPIs
    const inquiryCount = items.filter((i: any) => i.stage === 'inquiry').length
    const pendingCount = items.filter((i: any) => i.stage === 'deposit_pending').length
    const bookedCount = reservations.filter((row: any) => row.status === 'CONFIRMED').length
    const canceledCount = reservations.filter((row: any) => row.status === 'CANCELLED').length
    const conversionRate = null

    return NextResponse.json(
      {
        items,
        reservations,
        datasetMode: 'ACTUAL',
        kpis: {
          inquiryCount,
          pendingCount,
          bookedCount,
          canceledCount,
          conversionRate,
        },
      },
      { status: 200, headers: NO_STORE }
    )
  } catch (err: any) {
    console.error('[customers/pipeline] 조회 처리 실패')
    return NextResponse.json({ error: '고객 파이프라인을 불러오지 못했습니다.' }, { status: 500, headers: NO_STORE })
  }
}
