import { describe, expect, it } from 'vitest'
import { campaignAudience, contactCtas, displayName, listView, maskName, searchCustomers, type MobileCustomerDto } from './customer-model'

const base = (o: Partial<MobileCustomerDto> = {}): MobileCustomerDto => ({
  id: 'c1', workspaceId: 'w1', displayName: '김민지', segment: 'upcoming',
  consent: { status: 'granted', checkedAt: '2026-10-22T00:00:00Z', source: '예약 시 동의' },
  verifiedContacts: ['phone', 'message'], lastAction: null, sourceLabel: null, ...o,
})

describe('고객 동의/연락 CTA', () => {
  it('동의 철회 고객은 연락 CTA 비활성', () => {
    const ctas = contactCtas(base({ consent: { status: 'withdrawn', checkedAt: null, source: null } }))
    expect(ctas.every(c => !c.enabled)).toBe(true)
  })
  it('동의 미확인은 비활성(fail-closed)', () => {
    expect(contactCtas(base({ consent: { status: 'unknown', checkedAt: null, source: null } })).some(c => c.enabled)).toBe(false)
  })
  it('검증된 연락처만 활성', () => {
    const ctas = contactCtas(base({ verifiedContacts: ['phone'] }))
    expect(ctas.find(c => c.channel === 'phone')?.enabled).toBe(true)
    expect(ctas.find(c => c.channel === 'message')?.enabled).toBe(false)
  })
  it('캠페인 대상은 동의 고객·같은 워크스페이스만', () => {
    const list = [base(), base({ id: 'c2', consent: { status: 'withdrawn', checkedAt: null, source: null } }), base({ id: 'c3', workspaceId: 'w2' })]
    expect(campaignAudience(list, 'w1').map(c => c.id)).toEqual(['c1'])
  })
  it('이름 마스킹', () => {
    expect(maskName('김민지')).toBe('김○지')
    expect(maskName('김지')).toBe('김○')
  })

  // iOS/macOS 한글 입력은 자모가 분리된 NFD 로 들어올 수 있다. '김민지'가 8개 코드포인트가 되어
  // 글자 단위로 자르면 'ㄱ○○○○○○ㅣ' 처럼 자모가 그대로 노출된다. 마스킹이 깨지면 PII 표시가 망가진다.
  it('자모가 분리된(NFD) 이름도 글자 단위로 마스킹한다', () => {
    const nfd = '김민지'.normalize('NFD')
    expect([...nfd].length).toBeGreaterThan(3) // 전제 확인: 실제로 분리돼 있다
    expect(maskName(nfd)).toBe('김○지')
  })

  it('두 글자 NFD 이름도 한 글자만 가린다', () => {
    expect(maskName('김지'.normalize('NFD'))).toBe('김○')
  })

  it('긴 이름은 이름 길이만큼만 가리고 원래 글자 수를 넘기지 않는다', () => {
    const masked = maskName('가'.repeat(30))
    expect([...masked].length).toBe(30)
    expect(masked.startsWith('가')).toBe(true)
    expect(masked.endsWith('가')).toBe(true)
  })

  // 서버 스키마는 displayName 에 min(1) 만 요구하므로 공백만 있는 이름('   ')도 통과한다.
  // 그대로 그리면 카드·상세 제목이 비어 누구인지 알 수 없다.
  it('이름이 비어 있으면 화면에 빈 제목을 두지 않는다', () => {
    expect(displayName(base({ displayName: '' }))).toBe('이름 미확인')
    expect(displayName(base({ displayName: '   ' }))).toBe('이름 미확인')
  })

  it('철회 고객의 이름이 비어 있어도 대체 문구를 쓴다', () => {
    expect(displayName(base({
      displayName: '  ', consent: { status: 'withdrawn', checkedAt: null, source: null },
    }))).toBe('이름 미확인')
  })

  it('정상 이름은 그대로 보여준다', () => {
    expect(displayName(base({ displayName: '김민지' }))).toBe('김민지')
  })

  it('자모가 분리된 이름은 화면에서 완성형으로 보여준다', () => {
    expect(displayName(base({ displayName: '김민지'.normalize('NFD') }))).toBe('김민지')
  })
})

describe('고객 검색 — 다른 사업장 고객 0', () => {
  // 같은 조회 응답에 두 사업장 행이 섞여 들어오는 경우(RLS 누락·어댑터 회귀)를 가정한다.
  // 검색은 화면에 이미 그려진 목록이 아니라 응답 배열을 그대로 받으므로, 여기가 마지막 방어선이다.
  const mixed = [
    base({ id: 'a1', workspaceId: 'w1', displayName: '김민지' }),
    base({ id: 'a2', workspaceId: 'w1', displayName: '이서연' }),
    base({ id: 'b1', workspaceId: 'w2', displayName: '김민지' }),
    base({ id: 'b2', workspaceId: 'w2', displayName: '박하늘' }),
  ]

  it('두 사업장에 같은 이름이 있어도 현재 사업장 행만 돌려준다', () => {
    const hits = searchCustomers(mixed, 'w1', '김민지')
    expect(hits.map(c => c.id)).toEqual(['a1'])
    expect(hits.map(c => c.workspaceId)).toEqual(['w1'])
  })

  it('검색어가 다른 사업장 고객 이름에만 걸리면 0건이다', () => {
    expect(searchCustomers(mixed, 'w1', '박하늘')).toEqual([])
  })

  it('검색어가 비면 현재 사업장 전체만 보인다', () => {
    expect(searchCustomers(mixed, 'w1', '').map(c => c.id)).toEqual(['a1', 'a2'])
    expect(searchCustomers(mixed, 'w1', '   ').map(c => c.id)).toEqual(['a1', 'a2'])
  })

  it('보는 사업장을 바꾸면 그 사업장 행만 나온다(반대 방향도 대칭)', () => {
    expect(searchCustomers(mixed, 'w2', '김').map(c => c.id)).toEqual(['b1'])
    expect(searchCustomers(mixed, 'w2', '').map(c => c.id)).toEqual(['b1', 'b2'])
  })

  it('사업장 id 가 비면 아무 고객도 돌려주지 않는다(fail-closed)', () => {
    expect(searchCustomers(mixed, '', '김')).toEqual([])
    expect(searchCustomers(mixed, '', '')).toEqual([])
  })
})

describe('고객 검색 — 한글 입력 정규화', () => {
  // 같은 이름이라도 입력기·플랫폼에 따라 NFC(완성형)와 NFD(자모 분리)가 섞인다.
  // 정규화 없이 비교하면 사장님이 방금 본 고객을 검색으로 찾지 못한다.
  const nfdName = '김민지'.normalize('NFD')
  const nfcName = '김민지'.normalize('NFC')

  it('자모 분리(NFD)로 저장된 이름을 완성형(NFC) 검색어로 찾는다', () => {
    const list = [base({ id: 'a1', workspaceId: 'w1', displayName: nfdName })]
    expect(searchCustomers(list, 'w1', nfcName).map(c => c.id)).toEqual(['a1'])
  })

  it('완성형(NFC)으로 저장된 이름을 자모 분리(NFD) 검색어로 찾는다', () => {
    const list = [base({ id: 'a1', workspaceId: 'w1', displayName: nfcName })]
    expect(searchCustomers(list, 'w1', nfdName).map(c => c.id)).toEqual(['a1'])
  })

  it('부분 검색도 두 표기에서 모두 동작한다', () => {
    const list = [
      base({ id: 'a1', workspaceId: 'w1', displayName: nfdName }),
      base({ id: 'a2', workspaceId: 'w1', displayName: '이서연' }),
    ]
    expect(searchCustomers(list, 'w1', '민지').map(c => c.id)).toEqual(['a1'])
    expect(searchCustomers(list, 'w1', '민지'.normalize('NFD')).map(c => c.id)).toEqual(['a1'])
  })

  it('정규화해도 다른 사업장 고객은 여전히 0건이다', () => {
    const list = [
      base({ id: 'a1', workspaceId: 'w1', displayName: nfdName }),
      base({ id: 'b1', workspaceId: 'w2', displayName: nfdName }),
    ]
    expect(searchCustomers(list, 'w1', nfcName).map(c => c.id)).toEqual(['a1'])
  })

  it('마스킹된 철회 고객은 원래 이름으로 검색되지 않는다', () => {
    const list = [base({ id: 'a1', workspaceId: 'w1', displayName: '김○지' })]
    expect(searchCustomers(list, 'w1', nfcName)).toEqual([])
    expect(searchCustomers(list, 'w1', nfdName)).toEqual([])
  })
})

describe('목록 상태', () => {
  it('조회 오류는 빈 목록이 아니다', () => expect(listView('error', null, false).kind).toBe('error'))
  it('완전 조회 + 0건만 confirmed_empty', () => {
    expect(listView('ready', [], true).kind).toBe('confirmed_empty')
    expect(listView('ready', [], false).kind).toBe('partial')
  })
  it('네트워크가 끊긴 것이 확인되면 조회 실패와 구분한다', () => {
    expect(listView('error', null, false, true).kind).toBe('offline')
    expect(listView('unknown', null, false, true).kind).toBe('offline')
  })
  it('오프라인이어도 이미 확인한 내용과 확인 중 상태는 지우지 않는다', () => {
    expect(listView('ready', [{}], true, true).kind).toBe('ready')
    expect(listView('loading', null, false, true).kind).toBe('loading')
  })
})
