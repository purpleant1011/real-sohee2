const GENERAL_REPLACEMENT = '관련 작업의 처리 상태를 확인해 주세요.'
const PUBLISH_REPLACEMENT = '게시 처리 상태를 확인해 주세요.'
const MAX_BODY_LENGTH = 200

const unicodeWhitespacePattern = /[\p{White_Space}\ufeff]+/gu
const markupPattern = /[<>]/u
const bidiControlPattern = /[\u202a-\u202e\u2066-\u2069]/u
const uriSchemePattern = /(?:^|[^a-z\d+.-])[a-z][a-z\d+.-]*:[^\s]/iu
const schemeRelativeUrlPattern = /(?:^|[\s([{])\/\/[^\s/]+(?:\/[^\s]*)?/u
const domainNamePattern =
  /(?:^|[^a-z\d-])(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?\.)+[a-z]{2,63}(?=$|[^a-z\d-])/iu
const ipv4HostPattern = /(?:^|[^\d.])(?:\d{1,3}\.){3}\d{1,3}(?=$|[/:?#\s])/u
const ipv6HostPattern =
  /(?:^|[^a-f\d:])\[(?=[a-f\d:.]*:)[a-f\d:.]+\](?=$|[/:?#\s])/iu
const localhostPattern =
  /(?:^|[^a-z\d-])localhost(?=$|:\d{1,5}(?:$|[/?#])|[/?#])/iu
const queryOrFragmentPayloadPattern = /[?#][a-z\d_.~-]+\s*=\s*[^\s&#]+/iu
const englishSensitiveLabelPattern =
  /(?:^|[^a-z\d])(?:access[\s._:/-]*token|refresh[\s._:/-]*token|authorization|bearer|password|passwd|secret|api[\s._:/-]*key|apikey|credential|cookie|session|private[\s._:/-]*key|client[\s._:/-]*secret|token)(?=$|[^a-z\d])/iu
const koreanSensitiveLabelPattern =
  /(?:비밀번호|접근[\p{White_Space}._:/-]*토큰|인증[\p{White_Space}._:/-]*토큰|비밀[\p{White_Space}._:/-]*키)/u
const jwtPattern =
  /(?:^|[^a-z\d_-])[a-z\d_-]{3,}\.[a-z\d_-]{3,}\.(?:[a-z\d_-]{3,})?(?=$|[^a-z\d_-])/iu
const credentialPrefixPattern =
  /(?:^|[^a-z\d])(?:sk-|ghp_|github_pat_)[a-z\d_-]+/iu
const longHexPattern = /(?:^|[^a-f\d])[a-f\d]{32,}(?=$|[^a-f\d])/iu
const opaqueRunPattern = /[a-z\d_+/=-]{32,}/giu

function replacementFor(normalized: string): string {
  return normalized.includes('게시') ? PUBLISH_REPLACEMENT : GENERAL_REPLACEMENT
}

function containsForbiddenCodePoint(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)

    if (codePoint === undefined) {
      return true
    }

    if (
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff)
    ) {
      return true
    }
  }

  return false
}

function containsOpaqueCredential(value: string): boolean {
  const candidates = value.match(opaqueRunPattern)

  if (candidates === null) {
    return false
  }

  return candidates.some((candidate) => /[a-z]/iu.test(candidate) && /\d/u.test(candidate))
}

function isUnsafeBody(value: string): boolean {
  return (
    markupPattern.test(value) ||
    bidiControlPattern.test(value) ||
    containsForbiddenCodePoint(value) ||
    uriSchemePattern.test(value) ||
    schemeRelativeUrlPattern.test(value) ||
    domainNamePattern.test(value) ||
    ipv4HostPattern.test(value) ||
    ipv6HostPattern.test(value) ||
    localhostPattern.test(value) ||
    queryOrFragmentPayloadPattern.test(value) ||
    englishSensitiveLabelPattern.test(value) ||
    koreanSensitiveLabelPattern.test(value) ||
    jwtPattern.test(value) ||
    credentialPrefixPattern.test(value) ||
    longHexPattern.test(value) ||
    containsOpaqueCredential(value)
  )
}

export function sanitizeNotificationBody(input: unknown): string {
  if (typeof input !== 'string') {
    return GENERAL_REPLACEMENT
  }

  try {
    const normalized = input.replace(unicodeWhitespacePattern, ' ').trim()
    const replacement = replacementFor(normalized)

    if (normalized.length === 0 || normalized.length > MAX_BODY_LENGTH) {
      return replacement
    }

    return isUnsafeBody(normalized) ? replacement : normalized
  } catch {
    return GENERAL_REPLACEMENT
  }
}
