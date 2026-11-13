import 'server-only'
import { createHash } from 'node:crypto'

export type AuditExportRow = Readonly<{
  readonly [key: string]: unknown
  createdAt: string; workspaceId?: string | null; workspaceName: string | null; action: string; targetType: string; result: string; factKind: string; reason: string; approvalStatus: string; before?: unknown; after?: unknown
}>
const headers = ['시간', '고객사', '작업', '대상', '결과', '사실 구분', '사유', '승인 상태'] as const
function cell(value: unknown): string {
  const raw = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)
  const text = /^[=+\-@]/u.test(raw) ? `'${raw}` : raw
  return /[",\n\r]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
export function serializeAuditExportCsv(rows: readonly AuditExportRow[]): string {
  return [headers.join(','), ...rows.map((row) => [row.createdAt, row.workspaceName ?? '전역 운영', row.action, row.targetType, row.result, row.factKind, row.reason, row.approvalStatus].map(cell).join(','))].join('\n') + '\n'
}
export async function sha256Csv(csv: string): Promise<string> { return createHash('sha256').update(csv, 'utf8').digest('hex') }
