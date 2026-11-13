import { z } from 'zod'
const schema=z.object({id:z.string(),kind:z.enum(['channel_preview','manual_assist','provider_readiness','automation_rule','performance_report','learning_candidate']),title:z.string(),href:z.string().startsWith('/app'),statusLabel:z.enum(['검토 준비됨','수동 마무리 필요','외부 확인 대기','승인 전 비활성']),requiresConfirmation:z.literal(true)}).strict()
export function persistSafeIntegrationArtifact(input:unknown){const parsed=schema.parse(input);return Object.freeze({...parsed})}
export function replaySafeIntegrationArtifact(input:unknown){const parsed=schema.parse(input);return Object.freeze({...parsed})}
