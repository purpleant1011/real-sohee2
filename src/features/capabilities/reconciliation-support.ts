interface SupportQueueInput {
  client: any
  workspaceId: string
  /** Production adapter must call requireOperator('booking.read', workspaceId). */
  authorize: (workspaceId: string) => Promise<unknown>
}

/** Existing outbox is authoritative; no shadow ledger and no resend capability. */
export async function loadReconciliationSupportQueue({ client, workspaceId, authorize }: SupportQueueInput) {
  await authorize(workspaceId)
  const { data, error } = await client.from('booking_recovery_outbox')
    .select('id,workspace_id,case_id,state,attempt,updated_at')
    .eq('workspace_id', workspaceId)
    .in('state', ['UNKNOWN', 'CLAIMED'])
    .order('updated_at', { ascending: true }).limit(100)
  if (error || !Array.isArray(data)) throw new Error('RECONCILIATION_QUERY_FAILED')
  const items = data.map((row: any) => {
    if (row.workspace_id !== workspaceId) throw new Error('RECONCILIATION_SCOPE_MISMATCH')
    return {
      id: row.id as string,
      caseId: row.case_id as string,
      statusLabel: row.state === 'UNKNOWN' ? '결과 확인 필요' : '결과 확인 진행 중',
      attempt: row.attempt as number,
      observedAt: row.updated_at as string,
      nextAction: 'READBACK_ONLY' as const,
      nextActionLabel: '재전송하지 말고 해당 요청의 결과를 확인해 주세요.',
    }
  })
  return { state: 'OBSERVED' as const, items }
}
