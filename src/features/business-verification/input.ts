export const REJECTION_REASONS = {
  MISMATCH: '국세청 등록정보와 입력하신 대표자명 또는 상호명이 일치하지 않습니다.',
  CLOSED_BUSINESS: '국세청 조회 결과 폐업된 사업자등록번호입니다.',
} as const

export function isValidCompactDate(yyyymmdd: string, now: Date = new Date()): boolean {
  if (!/^[0-9]{8}$/.test(yyyymmdd)) return false
  const y = Number(yyyymmdd.slice(0, 4)), m = Number(yyyymmdd.slice(4, 6)), d = Number(yyyymmdd.slice(6, 8))
  if (y < 1900) return false
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return false
  return date.getTime() <= now.getTime()
}

export type VerificationInputCheck =
  | { ok: true; value: { businessNumber: string; companyName: string; representativeName: string; startDate: string } }
  | { ok: false; message: string }

export function parseVerificationInput(body: Record<string, unknown>): VerificationInputCheck {
  const rawBn = body.businessNumber
  const rawComp = body.companyName
  const rawRep = body.representativeName

  if (
    typeof rawBn !== 'string' || !rawBn.trim() ||
    typeof rawComp !== 'string' || !rawComp.trim() ||
    typeof rawRep !== 'string' || !rawRep.trim()
  ) {
    return { ok: false, message: '사업자등록번호, 상호명, 대표자명은 필수 입력 항목입니다.' }
  }

  const bn = rawBn.replace(/[^0-9]/g, '')
  if (bn.length !== 10) {
    return { ok: false, message: '사업자등록번호는 숫자 10자리로 입력해 주세요.' }
  }

  const comp = rawComp.trim()
  if (comp.length < 2 || comp.length > 60) {
    return { ok: false, message: '상호는 2~60자로 입력해 주세요.' }
  }

  const rep = rawRep.trim()
  if (rep.length < 2 || rep.length > 30) {
    return { ok: false, message: '대표자명은 2~30자로 입력해 주세요.' }
  }

  const sd = typeof body.startDate === 'string'
    ? body.startDate.replace(/[^0-9]/g, '')
    : typeof body.startDate === 'number'
      ? String(body.startDate).replace(/[^0-9]/g, '')
      : ''

  if (!isValidCompactDate(sd)) {
    return { ok: false, message: '개업일자를 8자리 숫자로 입력해 주세요. (예: 20240101)' }
  }

  return {
    ok: true,
    value: {
      businessNumber: bn,
      companyName: comp,
      representativeName: rep,
      startDate: sd,
    },
  }
}
