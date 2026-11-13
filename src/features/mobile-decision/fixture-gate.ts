export function allowMobileFixture(nodeEnv: string | undefined, flag: string | undefined, host: string | null): boolean {
  if (nodeEnv !== 'development' || flag !== '1' || !host) return false
  try {
    const hostname = new URL(`http://${host}`).hostname
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch { return false }
}
