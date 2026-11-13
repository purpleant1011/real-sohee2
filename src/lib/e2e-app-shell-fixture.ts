export function isAppShellFixtureEnabled(value: string | undefined) {
  return value === '1'
}

export function isLoopbackFixtureHost(value: string | undefined) {
  if (!value) return false
  const hostname = value.startsWith('[')
    ? value.slice(0, value.indexOf(']') + 1)
    : value.split(':', 1)[0]
  return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
}

export function isLocalFixtureRequestEnabled(flag: string | undefined, host: string | undefined) {
  return isAppShellFixtureEnabled(flag) && isLoopbackFixtureHost(host)
}

export function fixtureAppPath(value: string | undefined) {
  return value === 'work-content' ? '/app/work/content-123' : '/app'
}
