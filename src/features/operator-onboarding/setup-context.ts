import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export const operatorSetupContextSchema = z.object({
  status: z.enum(['invited', 'active', 'not_invited']),
  emailConfirmed: z.boolean(),
  passwordSet: z.boolean(),
  hasVerifiedTotp: z.boolean(),
  hasRole: z.boolean(),
  currentAal: z.enum(['aal1', 'aal2']),
}).strict()

export type OperatorSetupContext = z.infer<typeof operatorSetupContextSchema>

export function parseOperatorSetupContext(input: unknown): OperatorSetupContext | null {
  const result = operatorSetupContextSchema.safeParse(input)
  return result.success ? result.data : null
}

export async function getCurrentOperatorSetupContext(): Promise<OperatorSetupContext | null> {
  try {
    const supabase = await createServerSupabaseClient()
    const { data, error } = await supabase.rpc('get_current_operator_setup_context')
    if (error) return null
    return parseOperatorSetupContext(data)
  } catch {
    return null
  }
}
