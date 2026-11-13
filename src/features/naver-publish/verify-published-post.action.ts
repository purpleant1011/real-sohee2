'use server'

import { z } from 'zod'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import { parseNaverBlogPostUrl } from './blog-url'
import { verifyPublishedPost, type NaverReadbackExpectation } from './readback'
import { assertNaverAutomationAllowed, NaverAutomationPolicyError } from './automation-policy'

const inputSchema = z.object({
  workspaceId: z.string().uuid(),
  resultUrl: z.string().trim().min(1),
  expected: z.object({
    title: z.string(),
    categoryName: z.string().nullable().optional(),
    imageCount: z.number().int().nonnegative(),
  }).strict(),
}).strict()

export type VerifyNaverPublishedPostResult = {
  status: 'VERIFIED' | 'MISMATCH' | 'UNKNOWN'
  reasons: string[]
  errorCode?: string
  error?: { message: string; requestId: string; errorCode?: string }
  data?: {
    status: 'VERIFIED' | 'MISMATCH' | 'UNKNOWN'
    reasons: string[]
    errorCode?: string
  }
}

const REVIEWER_ROLES = new Set(['owner', 'manager', 'reviewer'])

export async function verifyNaverPublishedPostAction(
  input: unknown,
): Promise<VerifyNaverPublishedPostResult> {
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) {
    const message = '검증 요청 정보를 확인해 주세요.'
    return {
      status: 'UNKNOWN',
      reasons: [message],
      error: { message, requestId: 'verify-published-post' },
    }
  }

  try {
    const supabase = await createServerSupabaseClient()
    const { data: userData, error: userError } = await supabase.auth.getUser()
    const userId = userData?.user?.id
    if (userError || typeof userId !== 'string') {
      const message = '로그인이 필요해요.'
      return {
        status: 'UNKNOWN',
        reasons: [message],
        error: { message, requestId: 'verify-published-post' },
      }
    }

    const { data: membership, error: membershipError } = await supabase
      .from('workspace_members')
      .select('role, status')
      .eq('workspace_id', parsed.data.workspaceId)
      .eq('user_id', userId)
      .maybeSingle()

    if (membershipError || membership?.status !== 'active' || !REVIEWER_ROLES.has(membership.role)) {
      const message = '이 매장에 접근할 수 없어요.'
      return {
        status: 'UNKNOWN',
        reasons: [message],
        error: { message, requestId: 'verify-published-post' },
      }
    }

    // SSRF-safe URL parsing: accepts only blog.naver.com or m.blog.naver.com post formats
    const ref = parseNaverBlogPostUrl(parsed.data.resultUrl)
    if (!ref) {
      const message = '올바른 네이버 블로그 글 주소가 아니에요.'
      return {
        status: 'UNKNOWN',
        reasons: [message],
        error: { message, requestId: 'verify-published-post' },
      }
    }

    const expected: NaverReadbackExpectation = {
      title: parsed.data.expected.title,
      categoryName: parsed.data.expected.categoryName ?? null,
      imageCount: parsed.data.expected.imageCount,
    }

    try {
      ;(assertNaverAutomationAllowed as (action: string) => void)('html_readback')
    } catch (policyErr) {
      if (policyErr instanceof NaverAutomationPolicyError) {
        return {
          status: 'UNKNOWN',
          reasons: [policyErr.message],
          errorCode: policyErr.code,
          error: { message: policyErr.message, requestId: 'verify-published-post', errorCode: policyErr.code },
          data: {
            status: 'UNKNOWN',
            reasons: [policyErr.message],
            errorCode: policyErr.code,
          },
        }
      }
      throw policyErr
    }

    const verdict = await verifyPublishedPost(ref, expected, fetch)
    const reasons = verdict.status === 'VERIFIED' ? [] : verdict.reasons

    return {
      status: verdict.status,
      reasons,
      data: {
        status: verdict.status,
        reasons,
      },
    }
  } catch (err) {
    if (err instanceof NaverAutomationPolicyError) {
      return {
        status: 'UNKNOWN',
        reasons: [err.message],
        errorCode: err.code,
        error: { message: err.message, requestId: 'verify-published-post', errorCode: err.code },
        data: {
          status: 'UNKNOWN',
          reasons: [err.message],
          errorCode: err.code,
        },
      }
    }
    const message = '게시 확인을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.'
    return {
      status: 'UNKNOWN',
      reasons: [message],
      error: { message, requestId: 'verify-published-post' },
    }
  }
}
