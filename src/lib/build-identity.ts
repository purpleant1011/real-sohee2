export function normalizeBuildIdentity(value: string | undefined): string {
  const normalized = value?.trim().toLowerCase() ?? ''
  return /^[0-9a-f]{7,40}$/u.test(normalized) ? normalized.slice(0, 7) : 'development'
}

export const SOHEE_BUILD_ID = normalizeBuildIdentity(process.env.NEXT_PUBLIC_SOHEE_BUILD_SHA || '44306db');
/**
 * Code manifest migration head (codebase definition SSOT).
 * Note: This represents the latest migration file tracked in code/manifest (supabase/migrations-manifest.json),
 * NOT the operational live database verified state. Live schema status must be probed independently.
 */
export const SOHEE_SCHEMA_HEAD = '20261104000000_publish_scope_alignment';
export const SOHEE_WORKER_VERSION = 'v0.9.0-prod';

export interface DeploymentTruth {
  buildSha: string;
  workerVersion: string;
  schemaHead: string;
  deployedAt: string;
  nodeEnv: string;
}

export function getDeploymentTruth(): DeploymentTruth {
  return {
    buildSha: SOHEE_BUILD_ID,
    workerVersion: SOHEE_WORKER_VERSION,
    schemaHead: SOHEE_SCHEMA_HEAD,
    deployedAt: new Date().toISOString(),
    nodeEnv: process.env.NODE_ENV || 'production',
  };
}
