import { readFileSync, statSync } from 'node:fs'
import { auditLocalPresence, type PresenceAuditInput } from '../src/features/local-presence/audit'

const file = process.argv[2]
try {
  if (!file || statSync(file).size > 2 * 1024 * 1024) throw new Error('INVALID_INPUT_FILE')
  const input = JSON.parse(readFileSync(file, 'utf8')) as PresenceAuditInput
  const report = auditLocalPresence(input)
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
  process.exitCode = report.state === 'CONSISTENT' ? 0 : report.state === 'REVIEW_REQUIRED' ? 2 : 3
} catch {
  // Do not echo imported values, credential-bearing URLs, or arbitrary parser errors.
  console.error('감사 입력을 확인해 주세요. 2MB 이하 JSON 및 명시적인 출처·사업장·시각이 필요합니다.')
  process.exitCode = 1
}
