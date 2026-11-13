import { randomUUID } from 'node:crypto'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from '@/lib/supabase/database.types'

import { readIntegrationEnv } from './integration-env'

type DatabaseClient = SupabaseClient<Database>

interface RunPasswords {
  passwordA: string
  passwordB: string
}

export interface RunIdentity extends RunPasswords {
  emailA: string
  emailB: string
  workspaceNameA: string
  workspaceNameB: string
}

export interface RemoteActor {
  userId: string
  workspaceId: string
  client: DatabaseClient
}

export interface RemoteTestContext {
  runId: string
  admin: DatabaseClient
  actorA: RemoteActor
  actorB: RemoteActor
  registerStorageObject: (bucketId: string, objectPath: string) => void
  cleanup: () => Promise<void>
}

function createDatabaseClient(projectUrl: string, key: string): DatabaseClient {
  return createClient<Database>(projectUrl, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

function normalizeRunId(runId: string): string {
  const normalized = runId.toLowerCase().replace(/[^a-z0-9-]/g, '-')
  return normalized.slice(0, 48) || 'integration'
}

export function createRunIdentity(
  runId: string,
  passwords: RunPasswords = {
    passwordA: `Sohee-A9!${randomUUID()}`,
    passwordB: `Sohee-B9!${randomUUID()}`,
  },
): RunIdentity {
  const normalizedRunId = normalizeRunId(runId)

  return {
    emailA: `test+codex-${normalizedRunId}-a@example.com`,
    emailB: `test+codex-${normalizedRunId}-b@example.com`,
    passwordA: passwords.passwordA,
    passwordB: passwords.passwordB,
    workspaceNameA: `Codex integration ${normalizedRunId} A`,
    workspaceNameB: `Codex integration ${normalizedRunId} B`,
  }
}

export function redactRunIdentity(identity: RunIdentity) {
  return {
    emailA: identity.emailA,
    emailB: identity.emailB,
    workspaceNameA: identity.workspaceNameA,
    workspaceNameB: identity.workspaceNameB,
  }
}

export async function createRemoteTestContext(): Promise<RemoteTestContext> {
  const env = readIntegrationEnv()
  const runId = randomUUID()
  const identity = createRunIdentity(runId)
  const admin = createDatabaseClient(env.projectUrl, env.adminSecretKey)
  const storageObjects: Array<{ bucketId: string; objectPath: string }> = []
  const workspaceIds: string[] = []
  const userIds: string[] = []
  let cleaned = false

  const cleanup = async () => {
    if (cleaned) return

    let cleanupFailed = false

    for (const object of storageObjects.toReversed()) {
      const { error } = await admin.storage.from(object.bucketId).remove([object.objectPath])
      cleanupFailed ||= error !== null
    }

    for (const workspaceId of workspaceIds.toReversed()) {
      const { error } = await admin.from('workspaces').delete().eq('id', workspaceId)
      cleanupFailed ||= error !== null
    }

    for (const userId of userIds.toReversed()) {
      const { error } = await admin.auth.admin.deleteUser(userId)
      cleanupFailed ||= error !== null
    }

    if (cleanupFailed) {
      throw new Error('integration_cleanup_failed')
    }

    cleaned = true
  }

  const createActor = async (
    email: string,
    password: string,
    workspaceName: string,
  ): Promise<RemoteActor> => {
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    })

    if (createError || !created.user) {
      throw new Error('integration_user_create_failed')
    }

    userIds.push(created.user.id)

    const client = createDatabaseClient(env.projectUrl, env.publishableKey)
    const { data: signedIn, error: signInError } = await client.auth.signInWithPassword({
      email,
      password,
    })

    if (signInError || signedIn.user?.id !== created.user.id) {
      throw new Error('integration_sign_in_failed')
    }

    const { data: workspaceId, error: workspaceError } = await client.rpc(
      'create_initial_workspace',
      {
        p_display_name: `Codex ${workspaceName.slice(-1)}`,
        p_timezone: 'Asia/Seoul',
        p_workspace_name: workspaceName,
      },
    )

    if (workspaceError || !workspaceId) {
      throw new Error('integration_workspace_create_failed')
    }

    workspaceIds.push(workspaceId)

    return {
      userId: created.user.id,
      workspaceId,
      client,
    }
  }

  try {
    const actorA = await createActor(identity.emailA, identity.passwordA, identity.workspaceNameA)
    const actorB = await createActor(identity.emailB, identity.passwordB, identity.workspaceNameB)

    return {
      runId,
      admin,
      actorA,
      actorB,
      registerStorageObject: (bucketId, objectPath) => {
        storageObjects.push({ bucketId, objectPath })
      },
      cleanup,
    }
  } catch (error) {
    await cleanup()

    if (error instanceof Error && error.message.startsWith('integration_')) {
      throw error
    }

    throw new Error('integration_setup_failed')
  }
}
