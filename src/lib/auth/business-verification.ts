/**
 * Sohee V0.8.9 Business Registration Verification Engine
 * 
 * Implements:
 * 1. Korean Business Registration Number (BRN) format validation & checksum verification (Hometax algorithm).
 * 2. Public NTS (National Tax Service) Business Status Verification integration.
 * 3. Strict Verification lifecycle management (UNVERIFIED, PENDING, VERIFIED, REJECTED, DOCUMENT_REQUIRED).
 *    (Anti-cheat invariant: Local checksum alone MUST NEVER grant automatic VERIFIED status!)
 */

export type BusinessVerificationStatus =
  | 'UNVERIFIED'
  | 'PENDING'
  | 'VERIFIED'
  | 'REJECTED'
  | 'DOCUMENT_REQUIRED';

export type BusinessType = 'INDIVIDUAL' | 'CORPORATION' | 'SIMPLIFIED' | 'NON_PROFIT';

export interface BusinessRegistrationData {
  businessNumber: string; // 10자리 숫자 (하이픈 제외)
  companyName: string;
  representativeName: string;
  startDate?: string;
  businessType?: BusinessType;
  businessAddress?: string;
  documentUrl?: string | null;
  rejectionReason?: string | null;
}

export interface VerificationResult {
  isValidChecksum: boolean;
  status: BusinessVerificationStatus;
  message: string;
  normalizedBusinessNumber: string;
  ntsTaxType?: string;
  ntsBStt?: string; // 01: 계속사업자, 02: 휴업자, 03: 폐업자
}

/**
 * 사업자등록번호 정규화 (하이픈 및 공백 제거)
 */
export function normalizeBusinessNumber(brn: string): string {
  return brn.replace(/[^0-9]/g, '');
}

/**
 * 국세청 사업자등록번호 체크섬 검증 알고리즘
 */
export function validateBusinessNumberChecksum(brn: string): boolean {
  const clean = normalizeBusinessNumber(brn);
  if (clean.length !== 10) return false;
  if (clean === '0000000000' || /^0+$/.test(clean)) return false;

  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;

  for (let i = 0; i < 9; i++) {
    sum += parseInt(clean.charAt(i), 10) * weights[i];
  }

  // 9번째 자리는 (숫자 * 5) / 10 의 몫을 추가
  sum += Math.floor((parseInt(clean.charAt(8), 10) * 5) / 10);

  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === parseInt(clean.charAt(9), 10);
}

export interface NtsValidationPayload {
  b_no: string;
  start_dt?: string;
  p_nm: string;
  b_nm?: string;
}

export interface NtsValidationResponse {
  success: boolean;
  status: 'VERIFIED' | 'MISMATCH' | 'CLOSED_BUSINESS' | 'NOT_FOUND' | 'PENDING_REVIEW';
  valid_msg?: string;
  b_stt?: string;
  error?: string;
}

/**
 * 국세청 공공데이터 포털 진위확인 API (사업자번호 + 대표자명 + 상호명 + 개업일자 일치 검증)
 */
export async function queryNtsBusinessValidation(
  payload: NtsValidationPayload
): Promise<NtsValidationResponse> {
  const cleanBNo = normalizeBusinessNumber(payload.b_no);
  const cleanStartDt = payload.start_dt ? payload.start_dt.replace(/[^0-9]/g, '') : '';
  const rawApiKey = process.env.NTS_API_KEY || process.env.DATA_GO_KR_API_KEY;

  if (!rawApiKey) {
    // API 키 미설정 시 자동 승인하지 않고 PENDING_REVIEW로 degrade
    return {
      success: true,
      status: 'PENDING_REVIEW',
      valid_msg: '진위확인 API 키 미설정으로 수동 심사로 전환되었습니다.'
    };
  }

  let normalizedKey = rawApiKey;
  if (rawApiKey.includes('%')) {
    try {
      normalizedKey = decodeURIComponent(rawApiKey);
    } catch {
      normalizedKey = rawApiKey;
    }
  }

  const requestBody = JSON.stringify({
    businesses: [
      {
        b_no: cleanBNo,
        start_dt: cleanStartDt,
        p_nm: payload.p_nm.trim(),
        b_nm: payload.b_nm?.trim() || ''
      }
    ]
  });

  const requestHeaders = {
    'Content-Type': 'application/json',
    'Accept': 'application/json'
  };

  try {
    // 1. If start_dt is provided, query /validate
    if (cleanStartDt) {
      let res = await fetch(
        `https://api.odcloud.kr/api/nts-businessman/v1/validate?serviceKey=${encodeURIComponent(normalizedKey)}`,
        {
          method: 'POST',
          headers: requestHeaders,
          body: requestBody
        }
      );

      if (!res.ok && (res.status === 401 || res.status === 500) && normalizedKey !== rawApiKey) {
        // Retry with exact raw key if pre-encoded
        res = await fetch(
          `https://api.odcloud.kr/api/nts-businessman/v1/validate?serviceKey=${rawApiKey}`,
          {
            method: 'POST',
            headers: requestHeaders,
            body: requestBody
          }
        );
      }

      if (res.ok) {
        const json = await res.json();
        const item = json?.data?.[0];

        if (item?.valid === '01') {
          const bSttCd = item.status?.b_stt_cd;
          if (bSttCd === '03') {
            return {
              success: true,
              status: 'CLOSED_BUSINESS',
              b_stt: '폐업자',
              valid_msg: '폐업된 사업자등록번호입니다.'
            };
          }
          return {
            success: true,
            status: 'VERIFIED',
            b_stt: item.status?.b_stt || '계속사업자',
            valid_msg: item.valid_msg || '국세청 정보와 정상 일치합니다.'
          };
        }
      }
    }

    // 2. Query /status API as fallback or when start_dt is absent
    const statusBody = JSON.stringify({ b_no: [cleanBNo] });
    let statusRes = await fetch(
      `https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${encodeURIComponent(normalizedKey)}`,
      {
        method: 'POST',
        headers: requestHeaders,
        body: statusBody
      }
    );

    if (!statusRes.ok && (statusRes.status === 401 || statusRes.status === 500) && normalizedKey !== rawApiKey) {
      statusRes = await fetch(
        `https://api.odcloud.kr/api/nts-businessman/v1/status?serviceKey=${rawApiKey}`,
        {
          method: 'POST',
          headers: requestHeaders,
          body: statusBody
        }
      );
    }

    if (statusRes.ok) {
      const statusJson = await statusRes.json();
      const statusItem = statusJson?.data?.[0];

      if (statusItem) {
        if (statusItem.b_stt_cd === '01') {
          // 번호가 실제로 존재하는 계속사업자라는 뜻일 뿐, 제출한 상호·대표자와의 일치는 확인되지 않았다.
          // 자동 VERIFIED 금지 — 서류 기반 수동 심사로 넘긴다.
          return {
            success: true,
            status: 'PENDING_REVIEW',
            b_stt: statusItem.b_stt || '계속사업자',
            valid_msg: '사업자 상태는 정상이에요. 상호·대표자 일치는 서류로 확인해요.'
          };
        } else if (statusItem.b_stt_cd === '03') {
          return {
            success: true,
            status: 'CLOSED_BUSINESS',
            b_stt: '폐업자',
            valid_msg: '국세청 조회 결과 폐업된 사업자등록번호입니다.'
          };
        } else if (statusItem.tax_type?.includes('등록되지 않은')) {
          return {
            success: true,
            status: 'MISMATCH',
            valid_msg: '국세청에 등록되지 않은 사업자등록번호입니다.'
          };
        }
      }
    }

    return {
      success: false,
      status: 'PENDING_REVIEW',
      valid_msg: '국세청 시스템 점검 또는 지연으로 심사 대기 중입니다.'
    };
  } catch (err: any) {
    return {
      success: false,
      status: 'PENDING_REVIEW',
      error: err?.message || 'NETWORK_ERROR'
    };
  }
}

/**
 * 1차 사업자등록 접수 및 검증기 (Anti-cheat: 체크섬 통과 시에도 즉시 VERIFIED가 아닌 PENDING으로 접수!)
 */
export function verifyBusinessRegistration(
  data: BusinessRegistrationData
): VerificationResult {
  const normalized = normalizeBusinessNumber(data.businessNumber);

  if (normalized.length !== 10) {
    return {
      isValidChecksum: false,
      status: 'REJECTED',
      message: '사업자등록번호는 10자리 숫자여야 합니다.',
      normalizedBusinessNumber: normalized
    };
  }

  const isValid = validateBusinessNumberChecksum(normalized);
  if (!isValid) {
    return {
      isValidChecksum: false,
      status: 'REJECTED',
      message: '유효하지 않은 사업자등록번호 형식입니다. 번호를 다시 확인해 주세요.',
      normalizedBusinessNumber: normalized
    };
  }

  if (!data.companyName.trim() || !data.representativeName.trim()) {
    return {
      isValidChecksum: true,
      status: 'DOCUMENT_REQUIRED',
      message: '상호명과 대표자명을 정확히 입력해 주세요.',
      normalizedBusinessNumber: normalized
    };
  }

  // 체크섬 및 기본 필드가 유효한 경우, 국세청/운영자 심사 대기(PENDING) 상태로 안전하게 접수
  return {
    isValidChecksum: true,
    status: 'PENDING',
    message: '사업자등록번호 형식이 확인되었습니다. 국세청 진위 확인 및 운영팀 심사가 진행됩니다.',
    normalizedBusinessNumber: normalized
  };
}
