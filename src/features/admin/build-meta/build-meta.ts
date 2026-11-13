import generated from '@/generated/build-meta.json'

/** Written by scripts/write-build-meta.mjs at build time. Never hand-edit version strings in the UI. */
export interface BuildMeta {
  version: string | null
  sha: string | null
}

export const UNKNOWN_VERSION_LABEL = '알 수 없음'

export function parseBuildMeta(raw: unknown): BuildMeta {
  const record = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const version = typeof record.version === 'string' && /^\d+\.\d+\.\d+([-+][0-9A-Za-z.-]+)?$/.test(record.version) ? record.version : null
  const sha = typeof record.sha === 'string' && /^[0-9a-f]{7,40}$/i.test(record.sha) ? record.sha.toLowerCase() : null
  return { version, sha }
}

/** "v1.2.3 · abc1234"; a missing part falls back to the unknown label. */
export function formatBuildLabel(meta: BuildMeta): string {
  if (!meta.version && !meta.sha) return UNKNOWN_VERSION_LABEL
  return `${meta.version ? `v${meta.version}` : UNKNOWN_VERSION_LABEL} · ${meta.sha ? meta.sha.slice(0, 7) : UNKNOWN_VERSION_LABEL}`
}

export function formatShortVersion(meta: BuildMeta): string {
  return meta.version ? `v${meta.version}` : UNKNOWN_VERSION_LABEL
}

export function getBuildMeta(): BuildMeta {
  return parseBuildMeta(generated)
}
