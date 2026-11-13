import { z } from 'zod'

export const conversationKnowledgeRequestSchema = z.object({
  subject: z.string().trim().min(1).max(120),
  factContent: z.string().trim().min(1).max(1800),
  memoryClass: z.enum(['episodic', 'semantic', 'procedural']).optional(),
}).strict()
export type ConversationKnowledgeRequest = z.infer<typeof conversationKnowledgeRequestSchema>

export const conversationKnowledgeSnapshotSchema = z.object({
  kind: z.literal('knowledge_proposal'), workspaceId: z.string().uuid(), proposalId: z.string().uuid(),
  sourceMessageId: z.string().uuid(), category: z.string().min(1).max(120), content: z.string().min(1).max(4000),
  status: z.enum(['proposed', 'confirmed', 'rejected', 'conflict']),
  requiresUserApproval: z.literal(true), href: z.literal('/app/sohee?tab=studio'),
}).strict()
