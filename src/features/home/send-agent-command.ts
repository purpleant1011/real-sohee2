type StartConversationResponse = {
  data?: {
    thread?: { id: string }
    userMessage?: { id: string }
  }
  error?: { message?: string }
}

type StartJobResponse = {
  data?: {
    job?: { id: string }
  }
  error?: { message?: string }
}

export type SendAgentCommandResult = {
  threadId: string
  jobId: string | null
}

export async function sendAgentCommand({
  workspaceId,
  message,
}: {
  workspaceId: string
  message: string
}): Promise<SendAgentCommandResult> {
  const clientMessageId = crypto.randomUUID()
  const requestKey = crypto.randomUUID()

  // 1. 대화 스레드 생성 및 첫 사용자 메시지 전송
  const start = await fetch(`/api/workspaces/${workspaceId}/conversations`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      requestKey,
      firstMessage: {
        clientMessageId,
        content: message,
      },
    }),
  })

  if (!start.ok) {
    const errorPayload = await start.json().catch(() => null) as StartConversationResponse | null
    throw new Error(errorPayload?.error?.message ?? 'CONVERSATION_START_FAILED')
  }

  const started = (await start.json()) as StartConversationResponse
  const threadId = started.data?.thread?.id

  if (!threadId) {
    throw new Error('INVALID_THREAD_RESPONSE')
  }

  // 2. 백그라운드 AI 에이전트 작업(Job) 기동
  const job = await fetch(`/api/workspaces/${workspaceId}/conversations/${threadId}/jobs`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      content: message,
      clientMessageId,
      attachmentIds: [],
    }),
  })

  if (job.status !== 202 && !job.ok) {
    // 202 Accepted 또는 200 OK 허용
    const jobPayload = await job.json().catch(() => null) as StartJobResponse | null
    throw new Error(jobPayload?.error?.message ?? 'AGENT_JOB_START_FAILED')
  }

  const jobPayload = (await job.json().catch(() => ({}))) as StartJobResponse

  return {
    threadId,
    jobId: jobPayload.data?.job?.id ?? null,
  }
}
