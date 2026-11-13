const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Isolates synthetic UI transport from production hosts, production data and deployed runtimes. */
export function isLearningPreviewAllowed(input: {
  nodeEnv: string | undefined; enabled: string | undefined; supabaseUrl: string | undefined; host: string | null
}): boolean {
  if (input.nodeEnv !== 'development' || input.enabled !== '1' || !input.host || !input.supabaseUrl) return false
  if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(input.host)) return false
  try {
    const db = new URL(input.supabaseUrl)
    return ['http:', 'https:'].includes(db.protocol) && LOOPBACK.has(db.hostname)
      && !db.username && !db.password
  } catch { return false }
}
