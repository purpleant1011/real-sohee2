import { z } from 'zod'

const emailSchema = z.string().trim().email('유효한 이메일 주소를 입력해 주세요.')
const passwordSchema = z.string().min(8, '비밀번호는 8자 이상이어야 합니다.')
const signInPasswordSchema = z.string().min(1, '비밀번호를 입력해 주세요.')

export const signInSchema = z.object({
  email: emailSchema,
  password: signInPasswordSchema,
  next: z.unknown().optional(),
})

export const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  termsVersion: z.literal('2026-08-24'),
  privacyVersion: z.literal('2026-08-24'),
  marketingConsent: z.boolean(),
})

export const passwordResetRequestSchema = z.object({
  email: emailSchema,
})

export const passwordUpdateSchema = z.object({
  password: passwordSchema,
})
