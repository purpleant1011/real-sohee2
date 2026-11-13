export function sanitizeSecretLeakage(input: unknown, tokenToRedact?: string): string {
  if (!input) return ''
  let text = typeof input === 'string' ? input : input instanceof Error ? input.message : String(input)
  if (tokenToRedact && text.includes(tokenToRedact)) {
    text = text.replaceAll(tokenToRedact, '[REDACTED]')
  }
  text = text.replace(/EAAB[a-zA-Z0-9_-]+/g, '[REDACTED]')
  text = text.replace(/EAA[a-zA-Z0-9_-]+/g, '[REDACTED]')
  text = text.replace(/(access_token|appsecret_proof|client_secret|code|secret|password)=([^&\s]+)/gi, '$1=[REDACTED]')
  text = text.replace(/"(access_token|appsecret_proof|client_secret|code|secret|password)"\s*:\s*"[^"]+"/gi, '"$1":"[REDACTED]"')
  text = text.replace(/Bearer\s+[a-zA-Z0-9._-]+/gi, 'Bearer [REDACTED]')
  return text
}
