import { z } from 'zod'
import { marketingStrategyApprovalSchema, marketingStrategyReferenceSchema } from './marketing-strategy-schema'

export const chatRequestSchema = z
  .object({
    content: z.string().trim().min(1).max(8_000),
    displayContent: z.string().trim().min(1).max(8_000).optional(),
    workRef: z.string().uuid().optional(),
    clientMessageId: z.string().uuid(),
    attachmentIds: z.array(z.string().uuid()).max(20),
    retryAssistantMessageId: z.string().uuid().optional(),
    replyToMessageId: z.string().uuid().optional(),
    selectedSlideId: z.string().uuid().optional(),
    retryFailedSlideId: z.string().uuid().optional(),
    marketingStrategy: marketingStrategyReferenceSchema.optional(),
    marketingStrategyApproval: marketingStrategyApprovalSchema.optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if ((value.marketingStrategy && value.marketingStrategyApproval)
      || ((value.marketingStrategy || value.marketingStrategyApproval) && value.replyToMessageId)) {
      context.addIssue({ code: 'custom', message: 'chat_strategy_operation_conflict', path: ['marketingStrategy'] })
    }
    const slideReferenceCount = Number(Boolean(value.selectedSlideId))
      + Number(Boolean(value.retryFailedSlideId))
    if (Boolean(value.replyToMessageId) !== (slideReferenceCount === 1) || slideReferenceCount > 1) {
      context.addIssue({
        code: 'custom',
        message: 'chat_slide_reference_incomplete',
        path: ['selectedSlideId'],
      })
    }
  })

export type ChatRequest = z.infer<typeof chatRequestSchema>
