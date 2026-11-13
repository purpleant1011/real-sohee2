import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { requireWorkspaceMembership } from '@/lib/auth/workspace-guard'
import { confirmInterviewFact } from '@/features/sohee-interview/service'
import { INTERVIEW_QUESTIONS, summarizeAnswer } from '@/features/sohee-interview/questions'

export const dynamic = 'force-dynamic'

const NO_STORE = { 'Cache-Control': 'no-store' }

export async function POST(
  req: NextRequest,
  props: { params: Promise<{ workspaceId: string }> },
) {
  try {
    const { workspaceId } = await props.params

    const auth = await requireWorkspaceMembership(workspaceId)
    if (!auth.ok) {
      return NextResponse.json(
        { success: false, error: auth.error, message: auth.message },
        { status: auth.status, headers: NO_STORE },
      )
    }

    if (auth.role !== 'owner' && auth.role !== 'manager') {
      return NextResponse.json(
        { success: false, error: 'FORBIDDEN', message: '지식을 확정할 권한이 없어요.' },
        { status: 403, headers: NO_STORE },
      )
    }

    let body: any
    try {
      body = await req.json()
    } catch {
      return NextResponse.json(
        { success: false, error: 'INVALID_JSON', message: '잘못된 요청 형식입니다.' },
        { status: 400, headers: NO_STORE },
      )
    }

    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { success: false, error: 'INVALID_BODY', message: '잘못된 요청 형식입니다.' },
        { status: 400, headers: NO_STORE },
      )
    }

    const { questionId, rawAnswer } = body

    if (!questionId || typeof questionId !== 'string' || !questionId.trim()) {
      return NextResponse.json(
        { success: false, error: 'INVALID_PARAMS', message: '질문 ID가 누락되었습니다.' },
        { status: 400, headers: NO_STORE },
      )
    }

    const matchedQuestion = INTERVIEW_QUESTIONS.find((q) => q.id === questionId.trim())
    if (!matchedQuestion) {
      return NextResponse.json(
        { success: false, error: 'INVALID_QUESTION_ID', message: '유효하지 않은 질문 ID입니다.' },
        { status: 400, headers: NO_STORE },
      )
    }

    if (typeof rawAnswer !== 'string') {
      return NextResponse.json(
        { success: false, error: 'INVALID_PARAMS', message: '답변 내용이 올바르지 않습니다.' },
        { status: 400, headers: NO_STORE },
      )
    }

    const trimmedRawAnswer = rawAnswer.trim()
    if (trimmedRawAnswer.length < 1 || trimmedRawAnswer.length > 1000) {
      return NextResponse.json(
        { success: false, error: 'INVALID_PARAMS', message: '답변은 1자 이상 1000자 이하여야 합니다.' },
        { status: 400, headers: NO_STORE },
      )
    }

    // 서버에서 질문으로부터 category/key 도출 및 summarizeAnswer 생성 (클라이언트 전달값 무시)
    const category = matchedQuestion.category
    const key = matchedQuestion.key
    const summarizedContent = summarizeAnswer(matchedQuestion, trimmedRawAnswer)

    const result = await confirmInterviewFact({
      workspaceId: auth.workspaceId,
      userId: auth.userId,
      questionId: matchedQuestion.id,
      category,
      key,
      rawAnswer: trimmedRawAnswer,
      summarizedContent,
    })

    return NextResponse.json(
      {
        success: true,
        factId: result.factId,
        category: result.category,
        content: result.content,
      },
      { status: 200, headers: NO_STORE },
    )
  } catch (error) {
    console.error(
      '[knowledge-interview-confirm] failed:',
      error instanceof Error ? error.message : 'unknown error',
    )
    return NextResponse.json(
      {
        success: false,
        error: 'INTERVIEW_CONFIRM_FAILED',
        message: '인터뷰 답변을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.',
      },
      { status: 500, headers: NO_STORE },
    )
  }
}
