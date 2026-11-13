#!/usr/bin/env node
/**
 * 로컬 격리 스택 전용, 운영 금지 (LOCAL E2E ONLY - DO NOT USE IN PRODUCTION)
 *
 * 이 스크립트는 로컬 E2E 테스트 환경(127.0.0.1/localhost/[::1])에서만 동작하며,
 * 운영 환경 및 외부 Supabase 접속을 원천 차단합니다.
 */

import { randomBytes } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const LOOPBACK_HOSTNAMES = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

function validateLoopbackUrl(rawUrl) {
  if (!rawUrl) {
    console.error('SUPABASE_URL is required')
    process.exit(1)
  }
  try {
    const parsed = new URL(rawUrl)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      console.error('Invalid protocol for SUPABASE_URL')
      process.exit(1)
    }
    if (!LOOPBACK_HOSTNAMES.has(parsed.hostname.toLowerCase())) {
      console.error('CRITICAL: Non-loopback SUPABASE_URL rejected for local E2E safety')
      process.exit(1)
    }
    return parsed.origin
  } catch {
    console.error('Malformed SUPABASE_URL')
    process.exit(1)
  }
}

async function main() {
  const supabaseUrl = validateLoopbackUrl(process.env.SUPABASE_URL)
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!serviceRoleKey) {
    console.error('SUPABASE_SERVICE_ROLE_KEY is required')
    process.exit(1)
  }

  const email = process.argv[2] || process.env.SOHEE_LOCAL_E2E_EMAIL || 'e2e-owner@sohee.test.invalid'
  const password = randomBytes(32).toString('base64url')

  const headers = {
    'Content-Type': 'application/json',
    'apikey': serviceRoleKey,
    'Authorization': `Bearer ${serviceRoleKey}`,
  }

  let userId

  // 1. Try to create user
  const createRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
    }),
  })

  if (createRes.status === 422) {
    // User already exists, fetch user id and update password
    const listRes = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: 'GET',
      headers,
    })

    if (!listRes.ok) {
      console.error(`Failed to list users: ${listRes.status}`)
      process.exit(1)
    }

    const listData = await listRes.json()
    const users = Array.isArray(listData) ? listData : (listData.users || [])
    const existing = users.find((u) => u.email === email)

    if (!existing || !existing.id) {
      console.error('User already exists (422) but could not be located in users list')
      process.exit(1)
    }

    userId = existing.id

    const updateRes = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify({ password }),
    })

    if (!updateRes.ok) {
      console.error(`Failed to update user password: ${updateRes.status}`)
      process.exit(1)
    }
  } else if (!createRes.ok) {
    console.error(`Failed to create user: ${createRes.status}`)
    process.exit(1)
  } else {
    const createdData = await createRes.json()
    userId = createdData.id || createdData.user?.id
  }

  if (!userId) {
    console.error('Failed to resolve user ID for workspace membership')
    process.exit(1)
  }

  // 2. Attach workspace membership
  const workspaceId = process.env.SUPABASE_WORKSPACE_ID || '20000000-0000-4000-8000-000000000701'
  const memberRes = await fetch(`${supabaseUrl}/rest/v1/workspace_members`, {
    method: 'POST',
    headers: {
      ...headers,
      'Prefer': 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify({
      workspace_id: workspaceId,
      user_id: userId,
      role: 'owner',
      status: 'active',
    }),
  })

  if (!memberRes.ok && memberRes.status !== 409) {
    const errorText = await memberRes.text()
    console.error(`Failed to attach workspace membership (${memberRes.status}): ${errorText}`)
    process.exit(1)
  }

  // 2-1. Upsert business_profiles
  const bpRes = await fetch(`${supabaseUrl}/rest/v1/business_profiles?on_conflict=workspace_id`, {
    method: 'POST',
    headers: {
      ...headers,
      'Prefer': 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify({
      workspace_id: workspaceId,
      business_name: '소희 E2E 테스트 매장',
      industry: '뷰티',
      location: '서울',
      summary: '소희 E2E 로컬 테스트 매장 프로필',
    }),
  })

  if (!bpRes.ok && bpRes.status !== 409) {
    const errorText = await bpRes.text()
    console.error(`Failed to upsert business_profiles (${bpRes.status}): ${errorText}`)
    process.exit(1)
  }

  // 3. Upsert business_verifications
  const bvRes = await fetch(`${supabaseUrl}/rest/v1/business_verifications?on_conflict=workspace_id`, {
    method: 'POST',
    headers: {
      ...headers,
      'Prefer': 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify({
      id: 'b7e00000-0000-4000-8000-000000000701',
      workspace_id: workspaceId,
      business_number: '0000000000',
      company_name: '소희 E2E 테스트',
      representative_name: '테스트',
      status: 'VERIFIED',
      verified_at: new Date().toISOString(),
    }),
  })

  if (!bvRes.ok && bvRes.status !== 409) {
    const errorText = await bvRes.text()
    console.error(`Failed to upsert business_verifications (${bvRes.status}): ${errorText}`)
    process.exit(1)
  }

  // 4. Upsert workspace_knowledge_harnesses
  const wkhRes = await fetch(`${supabaseUrl}/rest/v1/workspace_knowledge_harnesses`, {
    method: 'POST',
    headers: {
      ...headers,
      'Prefer': 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify({
      harness_version_id: 'e2e-harness-v1',
      workspace_id: workspaceId,
      version_no: 1,
      is_active: true,
    }),
  })

  if (!wkhRes.ok && wkhRes.status !== 409) {
    const errorText = await wkhRes.text()
    console.error(`Failed to upsert workspace_knowledge_harnesses (${wkhRes.status}): ${errorText}`)
    process.exit(1)
  }

  // 5. Upsert harness_rules (3 rows)
  const nowIso = new Date().toISOString()
  const rules = [
    {
      id: 'a7e00000-0000-4000-8000-000000000701',
      workspace_id: workspaceId,
      rule_key: 'e2e-text-rule',
      rule_type: 'text_generation',
      title: 'E2E 텍스트 기준',
      status: 'active',
      version: 1,
      structured_rule: {},
      applies_to_channels: [],
      created_by_user_id: userId,
      approved_by_user_id: userId,
      approved_at: nowIso,
    },
    {
      id: 'a7e00000-0000-4000-8000-000000000702',
      workspace_id: workspaceId,
      rule_key: 'e2e-image-rule',
      rule_type: 'image_generation',
      title: 'E2E 이미지 기준',
      status: 'active',
      version: 1,
      structured_rule: {},
      applies_to_channels: [],
      created_by_user_id: userId,
      approved_by_user_id: userId,
      approved_at: nowIso,
    },
    {
      id: 'a7e00000-0000-4000-8000-000000000703',
      workspace_id: workspaceId,
      rule_key: 'e2e-policy-rule',
      rule_type: 'approval_policy',
      title: 'E2E 운영 정책',
      status: 'active',
      version: 1,
      structured_rule: {},
      applies_to_channels: [],
      created_by_user_id: userId,
      approved_by_user_id: userId,
      approved_at: nowIso,
    },
  ]

  for (const rule of rules) {
    const hrRes = await fetch(`${supabaseUrl}/rest/v1/harness_rules?on_conflict=id`, {
      method: 'POST',
      headers: {
        ...headers,
        'Prefer': 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(rule),
    })

    if (!hrRes.ok && hrRes.status !== 409) {
      const errorText = await hrRes.text()
      console.error(`Failed to upsert harness_rule ${rule.rule_key} (${hrRes.status}): ${errorText}`)
      process.exit(1)
    }
  }

  // 6. Verification GET queries to confirm row existence
  const bvCheck = await fetch(`${supabaseUrl}/rest/v1/business_verifications?workspace_id=eq.${workspaceId}&select=id,status`, { headers })
  const bvRows = await bvCheck.json()
  const wkhCheck = await fetch(`${supabaseUrl}/rest/v1/workspace_knowledge_harnesses?workspace_id=eq.${workspaceId}&select=harness_version_id,is_active`, { headers })
  const wkhRows = await wkhCheck.json()
  const hrCheck = await fetch(`${supabaseUrl}/rest/v1/harness_rules?workspace_id=eq.${workspaceId}&select=id,rule_type,status`, { headers })
  const hrRows = await hrCheck.json()
  const bpCheck = await fetch(`${supabaseUrl}/rest/v1/business_profiles?workspace_id=eq.${workspaceId}&select=workspace_id,business_name`, { headers })
  const bpRows = await bpCheck.json()

  const counts = {
    businessProfilesCount: Array.isArray(bpRows) ? bpRows.length : 0,
    businessVerificationsCount: Array.isArray(bvRows) ? bvRows.length : 0,
    workspaceKnowledgeHarnessesCount: Array.isArray(wkhRows) ? wkhRows.length : 0,
    harnessRulesCount: Array.isArray(hrRows) ? hrRows.length : 0,
  }

  // Write credentials and verification counts to temporary 0600 file
  const dir = mkdtempSync(join(tmpdir(), 'sohee-e2e-auth-'))
  const filePath = join(dir, 'credentials.json')
  writeFileSync(filePath, JSON.stringify({ email, password, userId, workspaceId, counts }, null, 2), {
    mode: 0o600,
  })

  // Output ONLY the file path to stdout
  console.log(filePath)
}

main().catch((err) => {
  console.error('Unexpected error during local E2E account seeding:', err.message)
  process.exit(1)
})
