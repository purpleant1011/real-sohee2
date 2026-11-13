/**
 * Browser Execution Contract & Lifecycle State Machine (ANI-955)
 * 
 * Canonical BrowserTask Entity & Execution Driver for headless/cloud browser channels
 * (Naver Blog, Daangn Market, etc.)
 * 
 * Standard State Machine:
 * QUEUED ➔ PROBING ➔ FILLING ➔ AWAITING_APPROVAL ➔ SUBMITTING ➔ VERIFYING ➔ EXTERNAL_VERIFIED | RESULT_UNKNOWN | FAILED
 * Guardrails:
 * - Session expired -> SESSION_EXPIRED
 * - CAPTCHA / 2FA -> OWNER_HANDOFF_REQUIRED
 * - DOM readback verification failure -> RESULT_UNKNOWN
 * - Independent DOM readback verified -> EXTERNAL_VERIFIED
 */

import { createServerSupabaseClient } from '@/lib/supabase/server'

export type BrowserTaskState =
  | 'QUEUED'
  | 'PROBING'
  | 'FILLING'
  | 'AWAITING_APPROVAL'
  | 'SUBMITTING'
  | 'VERIFYING'
  | 'EXTERNAL_VERIFIED'
  | 'RESULT_UNKNOWN'
  | 'FAILED'
  | 'SESSION_EXPIRED'
  | 'OWNER_HANDOFF_REQUIRED'

export interface BrowserTaskEvidence {
  screenshotUrl?: string
  domSnapshot?: string
  publishedUrl?: string
  externalPostId?: string
  readbackDigest?: string
  verifiedAt?: string
  receiptId?: string
  previewUrl?: string
  [key: string]: unknown
}

export interface BrowserTaskPayload {
  title?: string
  caption?: string
  imageUrl?: string
  tags?: string[]
  [key: string]: unknown
}

export interface BrowserTask {
  task_id: string
  session_ref: string
  action_run_id: string
  target_url: string
  operation: 'POST_PUBLISH' | 'DRAFT_FILL' | 'VERIFY_READBACK' | string
  state: BrowserTaskState
  evidence: BrowserTaskEvidence
  retry_count: number
  workspace_id: string
  channel: 'NAVER_BLOG' | 'DAANGN' | string
  payload: BrowserTaskPayload
  error_code?: string
  error_message?: string
  created_at: string
  updated_at: string

  // Dual naming convention support (camelCase getters)
  taskId?: string
  sessionRef?: string
  actionRunId?: string
  targetUrl?: string
  retryCount?: number
  errorCode?: string
  errorMessage?: string
  workspaceId?: string
}

export class InvalidStateTransitionError extends Error {
  constructor(fromState: BrowserTaskState, toState: BrowserTaskState) {
    super(`Invalid BrowserTask state transition from '${fromState}' to '${toState}'.`)
    this.name = 'InvalidStateTransitionError'
  }
}

export const ALLOWED_TRANSITIONS: Record<BrowserTaskState, BrowserTaskState[]> = {
  QUEUED: ['PROBING', 'FILLING', 'AWAITING_APPROVAL', 'FAILED'],
  PROBING: ['FILLING', 'SESSION_EXPIRED', 'OWNER_HANDOFF_REQUIRED', 'FAILED'],
  FILLING: ['AWAITING_APPROVAL', 'SUBMITTING', 'FAILED'],
  AWAITING_APPROVAL: ['SUBMITTING', 'FAILED'],
  SUBMITTING: ['VERIFYING', 'RESULT_UNKNOWN', 'FAILED'],
  VERIFYING: ['EXTERNAL_VERIFIED', 'RESULT_UNKNOWN', 'FAILED'],
  RESULT_UNKNOWN: ['VERIFYING', 'FAILED'],
  SESSION_EXPIRED: ['PROBING', 'FAILED'],
  OWNER_HANDOFF_REQUIRED: ['PROBING', 'SUBMITTING', 'FAILED'],
  FAILED: ['QUEUED'],
  EXTERNAL_VERIFIED: [],
}

export function validateStateTransition(
  currentState: BrowserTaskState,
  nextState: BrowserTaskState
): boolean {
  if (currentState === nextState) return true
  const allowed = ALLOWED_TRANSITIONS[currentState]
  return allowed ? allowed.includes(nextState) : false
}

export function transitionBrowserTask(
  task: BrowserTask,
  nextState: BrowserTaskState,
  updates?: Partial<BrowserTask>
): BrowserTask {
  if (!validateStateTransition(task.state, nextState)) {
    throw new InvalidStateTransitionError(task.state, nextState)
  }

  const now = new Date().toISOString()
  const updatedTask: BrowserTask = {
    ...task,
    ...updates,
    state: nextState,
    updated_at: now,
  }

  // Sync dual aliases
  updatedTask.taskId = updatedTask.task_id
  updatedTask.sessionRef = updatedTask.session_ref
  updatedTask.actionRunId = updatedTask.action_run_id
  updatedTask.targetUrl = updatedTask.target_url
  updatedTask.retryCount = updatedTask.retry_count
  updatedTask.errorCode = updatedTask.error_code
  updatedTask.errorMessage = updatedTask.error_message
  updatedTask.workspaceId = updatedTask.workspace_id

  return updatedTask
}

export interface BrowserSessionProbeResult {
  valid: boolean
  sessionExpired?: boolean
  captchaDetected?: boolean
  twoFactorRequired?: boolean
  reason?: string
}

export interface BrowserDraftFillResult {
  success: boolean
  previewUrl?: string
  draftSnapshot?: string
  error?: string
}

export interface BrowserSubmitResult {
  success: boolean
  publishedUrl?: string
  externalPostId?: string
  domSnapshot?: string
  error?: string
}

export interface BrowserReadbackResult {
  verified: boolean
  isLive: boolean
  publishedUrl?: string
  externalPostId?: string
  domSnapshotDigest?: string
  screenshotUrl?: string
  error?: string
}

export interface BrowserTaskDriver {
  probeSession(sessionRef: string, channel: string): Promise<BrowserSessionProbeResult>
  fillDraft(task: BrowserTask): Promise<BrowserDraftFillResult>
  submitPost(task: BrowserTask): Promise<BrowserSubmitResult>
  verifyPost(task: BrowserTask, publishedUrl: string): Promise<BrowserReadbackResult>
}

export interface CreateBrowserTaskParams {
  workspaceId: string
  channel: 'NAVER_BLOG' | 'DAANGN' | string
  sessionRef: string
  actionRunId: string
  targetUrl: string
  operation?: 'POST_PUBLISH' | 'DRAFT_FILL' | 'VERIFY_READBACK' | string
  payload?: BrowserTaskPayload
}

export class BrowserTaskService {
  private static taskStore: Map<string, BrowserTask> = new Map()

  public static _reset(): void {
    this.taskStore.clear()
  }

  public static async createTask(params: CreateBrowserTaskParams): Promise<BrowserTask> {
    const now = new Date().toISOString()
    const taskId = `btask_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`

    const task: BrowserTask = {
      task_id: taskId,
      session_ref: params.sessionRef,
      action_run_id: params.actionRunId,
      target_url: params.targetUrl,
      operation: params.operation || 'POST_PUBLISH',
      state: 'QUEUED',
      evidence: {},
      retry_count: 0,
      workspace_id: params.workspaceId,
      channel: params.channel,
      payload: params.payload || {},
      created_at: now,
      updated_at: now,

      // camelCase aliases
      taskId,
      sessionRef: params.sessionRef,
      actionRunId: params.actionRunId,
      targetUrl: params.targetUrl,
      retryCount: 0,
      workspaceId: params.workspaceId,
    }

    this.taskStore.set(taskId, task)

    try {
      const supabase = await createServerSupabaseClient()
      await (supabase as any).from('browser_tasks').upsert({
        task_id: task.task_id,
        workspace_id: task.workspace_id,
        channel: task.channel,
        session_ref: task.session_ref,
        action_run_id: task.action_run_id,
        target_url: task.target_url,
        operation: task.operation,
        state: task.state,
        evidence: task.evidence,
        retry_count: task.retry_count,
        payload: task.payload,
        created_at: task.created_at,
        updated_at: task.updated_at,
      }, { onConflict: 'task_id' })
    } catch (e) {
      // Supabase write error ignored for testing/offline environments
    }

    return task
  }

  public static async getTask(taskId: string): Promise<BrowserTask | null> {
    const memoryTask = this.taskStore.get(taskId)
    if (memoryTask) return memoryTask

    try {
      const supabase = await createServerSupabaseClient()
      const { data } = await (supabase as any)
        .from('browser_tasks')
        .select('*')
        .eq('task_id', taskId)
        .maybeSingle()

      if (!data) return null

      const task: BrowserTask = {
        ...data,
        taskId: data.task_id,
        sessionRef: data.session_ref,
        actionRunId: data.action_run_id,
        targetUrl: data.target_url,
        retryCount: data.retry_count,
        errorCode: data.error_code,
        errorMessage: data.error_message,
        workspaceId: data.workspace_id,
      }
      this.taskStore.set(taskId, task)
      return task
    } catch {
      return null
    }
  }

  public static async updateTask(
    taskId: string,
    updates: Partial<BrowserTask>
  ): Promise<BrowserTask> {
    let task = await this.getTask(taskId)
    if (!task) {
      throw new Error(`BrowserTask ${taskId} not found`)
    }

    const now = new Date().toISOString()
    task = {
      ...task,
      ...updates,
      updated_at: now,
    }

    // Sync dual aliases
    task.taskId = task.task_id
    task.sessionRef = task.session_ref
    task.actionRunId = task.action_run_id
    task.targetUrl = task.target_url
    task.retryCount = task.retry_count
    task.errorCode = task.error_code
    task.errorMessage = task.error_message
    task.workspaceId = task.workspace_id

    this.taskStore.set(taskId, task)

    try {
      const supabase = await createServerSupabaseClient()
      await (supabase as any).from('browser_tasks').upsert({
        task_id: task.task_id,
        workspace_id: task.workspace_id,
        channel: task.channel,
        session_ref: task.session_ref,
        action_run_id: task.action_run_id,
        target_url: task.target_url,
        operation: task.operation,
        state: task.state,
        evidence: task.evidence,
        retry_count: task.retry_count,
        payload: task.payload,
        error_code: task.error_code || null,
        error_message: task.error_message || null,
        updated_at: task.updated_at,
      }, { onConflict: 'task_id' })
    } catch {
      // Ignored
    }

    return task
  }

  public static async executeTaskLifecycle(
    task: BrowserTask,
    driver: BrowserTaskDriver,
    options?: { autoSubmit?: boolean }
  ): Promise<BrowserTask> {
    // 1. Session Probing
    task = transitionBrowserTask(task, 'PROBING')
    await this.updateTask(task.task_id, { state: 'PROBING' })

    const probeRes = await driver.probeSession(task.session_ref, task.channel)
    if (probeRes.captchaDetected || probeRes.twoFactorRequired) {
      task = transitionBrowserTask(task, 'OWNER_HANDOFF_REQUIRED', {
        error_code: 'OWNER_HANDOFF_REQUIRED',
        error_message: probeRes.reason || 'CAPTCHA 또는 2FA 인증이 감지되어 점주 개입이 필요합니다.',
      })
      return this.updateTask(task.task_id, task)
    }

    if (!probeRes.valid || probeRes.sessionExpired) {
      task = transitionBrowserTask(task, 'SESSION_EXPIRED', {
        error_code: 'SESSION_EXPIRED',
        error_message: probeRes.reason || '브라우저 로그인 세션이 만료되었습니다. 다시 로그인해 주세요.',
      })
      return this.updateTask(task.task_id, task)
    }

    // 2. Draft Filling
    task = transitionBrowserTask(task, 'FILLING')
    await this.updateTask(task.task_id, { state: 'FILLING' })

    const fillRes = await driver.fillDraft(task)
    if (!fillRes.success) {
      task = transitionBrowserTask(task, 'FAILED', {
        error_code: 'DRAFT_FILL_FAILED',
        error_message: fillRes.error || '브라우저 에디터 원고 작성에 실패했습니다.',
      })
      return this.updateTask(task.task_id, task)
    }

    const evidence: BrowserTaskEvidence = {
      ...task.evidence,
      previewUrl: fillRes.previewUrl,
      domSnapshot: fillRes.draftSnapshot,
    }
    task = { ...task, evidence }

    // 3. Approval Check
    if (!options?.autoSubmit) {
      task = transitionBrowserTask(task, 'AWAITING_APPROVAL', { evidence })
      return this.updateTask(task.task_id, task)
    }

    // 4. Submitting
    task = transitionBrowserTask(task, 'SUBMITTING', { evidence })
    await this.updateTask(task.task_id, { state: 'SUBMITTING', evidence })

    const submitRes = await driver.submitPost(task)
    if (!submitRes.success || !submitRes.publishedUrl) {
      task = transitionBrowserTask(task, 'FAILED', {
        error_code: 'SUBMIT_FAILED',
        error_message: submitRes.error || '브라우저 게시물 발행 클릭에 실패했습니다.',
      })
      return this.updateTask(task.task_id, task)
    }

    evidence.publishedUrl = submitRes.publishedUrl
    evidence.externalPostId = submitRes.externalPostId
    if (submitRes.domSnapshot) {
      evidence.domSnapshot = submitRes.domSnapshot
    }
    task = { ...task, evidence }

    // 5. Verifying (Independent DOM Readback)
    task = transitionBrowserTask(task, 'VERIFYING', { evidence })
    await this.updateTask(task.task_id, { state: 'VERIFYING', evidence })

    const verifyRes = await driver.verifyPost(task, submitRes.publishedUrl)
    if (!verifyRes.verified || !verifyRes.isLive) {
      task = transitionBrowserTask(task, 'RESULT_UNKNOWN', {
        error_code: 'READBACK_FAILED',
        error_message: verifyRes.error || '독립 DOM readback 검증 실패: 게시글이 확인되지 않았습니다.',
        evidence: {
          ...evidence,
          screenshotUrl: verifyRes.screenshotUrl,
          readbackDigest: verifyRes.domSnapshotDigest,
        },
      })
      return this.updateTask(task.task_id, task)
    }

    // 6. Complete: EXTERNAL_VERIFIED
    const finalEvidence: BrowserTaskEvidence = {
      ...evidence,
      publishedUrl: verifyRes.publishedUrl || submitRes.publishedUrl,
      externalPostId: verifyRes.externalPostId || submitRes.externalPostId,
      domSnapshotDigest: verifyRes.domSnapshotDigest,
      readbackDigest: verifyRes.domSnapshotDigest,
      screenshotUrl: verifyRes.screenshotUrl,
      verifiedAt: new Date().toISOString(),
      receiptId: `rcpt_browser_${task.task_id}_${Date.now()}`,
    }

    task = transitionBrowserTask(task, 'EXTERNAL_VERIFIED', {
      evidence: finalEvidence,
    })
    return this.updateTask(task.task_id, task)
  }
}
