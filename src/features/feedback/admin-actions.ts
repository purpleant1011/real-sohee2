'use server'

import { revalidatePath } from 'next/cache'
import { requireOperator } from '@/features/operator-auth/require-operator'
import { createAdminSupabaseClient } from '@/lib/supabase/admin'
import { triageFeedback } from './repository'
import { FEEDBACK_STATUSES, FEEDBACK_TAGS, type FeedbackStatus, type FeedbackTag } from './types'

const uuid = (v: FormDataEntryValue | null) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** 상태·태그·연결(콘텐츠/실행)·메모를 한 번에 저장한다. 권한은 사업장 범위로 확인한다. */
export async function triageFeedbackAction(formData: FormData): Promise<void> {
  const workspaceId = String(formData.get('workspaceId') ?? '')
  await requireOperator('crm.support', workspaceId)
  const status = String(formData.get('status') ?? '') as FeedbackStatus
  const tags = formData.getAll('tags').map(String).filter((t): t is FeedbackTag => (FEEDBACK_TAGS as readonly string[]).includes(t))
  await triageFeedback(createAdminSupabaseClient() as never, {
    id: String(formData.get('id') ?? ''),
    workspaceId,
    ...((FEEDBACK_STATUSES as readonly string[]).includes(status) ? { status } : {}),
    tags,
    contentId: uuid(formData.get('contentId')),
    runId: uuid(formData.get('runId')),
    adminNote: uuid(formData.get('adminNote')),
  })
  revalidatePath('/admin/feedback')
}
