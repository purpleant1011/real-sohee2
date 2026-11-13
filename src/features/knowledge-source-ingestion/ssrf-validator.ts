/**
 * SSRF and Private Network Protection Validator (HF-55 / ANI-1405)
 */

export class SsrfProtectionError extends Error {
  readonly code = 'SSRF_PROTECTION_BLOCKED'
  constructor(message = 'SSRF_PROTECTION_BLOCKED: Target URL resolves to private or disallowed network') {
    super(message.includes('SSRF_PROTECTION_BLOCKED') ? message : `SSRF_PROTECTION_BLOCKED: ${message}`)
    this.name = 'SsrfProtectionError'
  }
}

export function validateUrlForSsrf(urlStr: string): void {
  let parsed: URL
  try {
    parsed = new URL(urlStr)
  } catch {
    throw new SsrfProtectionError(`Invalid URL format: ${urlStr}`)
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new SsrfProtectionError(`Disallowed protocol: ${parsed.protocol}`)
  }

  const hostname = parsed.hostname.toLowerCase()

  // Loopback / localhost
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0'
  ) {
    throw new SsrfProtectionError(`Loopback address blocked: ${hostname}`)
  }

  // AWS/Cloud metadata
  if (hostname === '169.254.169.254' || hostname.startsWith('169.254.')) {
    throw new SsrfProtectionError(`Cloud metadata address blocked: ${hostname}`)
  }

  // Private IPv4 ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16
  const parts = hostname.split('.').map((p) => Number.parseInt(p, 10))
  if (parts.length === 4 && parts.every((n) => !Number.isNaN(n) && n >= 0 && n <= 255)) {
    const [p0, p1] = parts
    if (p0 === 10) {
      throw new SsrfProtectionError(`Private IP address blocked: ${hostname}`)
    }
    if (p0 === 172 && p1 >= 16 && p1 <= 31) {
      throw new SsrfProtectionError(`Private IP address blocked: ${hostname}`)
    }
    if (p0 === 192 && p1 === 168) {
      throw new SsrfProtectionError(`Private IP address blocked: ${hostname}`)
    }
    if (p0 === 127 || p0 === 0) {
      throw new SsrfProtectionError(`Loopback IP address blocked: ${hostname}`)
    }
  }
}
