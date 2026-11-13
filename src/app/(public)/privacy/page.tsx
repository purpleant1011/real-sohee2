import type { Metadata } from 'next'
import Link from 'next/link'
import { OPERATOR_INFO } from '@/features/marketing/operator-information'
import { LegalDocument, OperatorNote, type LegalArticle } from '../legal-document'

export const metadata: Metadata = {
  title: '개인정보 처리방침 | 소희',
  description: '소희(example.com)의 개인정보 수집, 이용, 위탁 및 보호 조치에 관한 방침을 안내합니다.',
}

const privacyArticles: readonly LegalArticle[] = [
  {
    id: 'purposes-and-items',
    title: '개인정보의 처리 목적 및 수집 항목',
    articleNumber: '제1조',
    content: (
      <div>
        <p>1. 소희는 다음의 목적을 위해 필요한 최소한의 개인정보를 수집·이용합니다.</p>
        <ul>
          <li>
            <strong>회원 가입 및 계정 관리:</strong> 이메일 주소, 비밀번호, 작업공간 이름, 매장명,
            업종, 매장 소재지
          </li>
          <li>
            <strong>마케팅 채널 연동 및 발행:</strong> 외부 채널(Instagram, Threads, Naver, Kakao,
            당근) 계정 연동 식별자 및 접근 토큰
          </li>
          <li>
            <strong>고객 예약패스 및 문의 응대:</strong> 고객 식별 정보, 지원 문의 내역, 데이터
            삭제 요청 기록
          </li>
        </ul>
        <p>
          2. 서비스 이용 과정에서 IP 주소, 쿠키, 서비스 이용 기록, 기기 정보가 자동으로 생성되어
          수집될 수 있습니다.
        </p>
        <OperatorNote item="상용 결제 개시 시 수집할 결제자 정보(카드사명, 승인번호 등) 및 세금계산서 발행용 사업자등록증 정보 확정" />
      </div>
    ),
  },
  {
    id: 'retention-period',
    title: '개인정보의 보유 및 이용 기간',
    articleNumber: '제2조',
    content: (
      <div>
        <p>
          1. 소희는 이용자의 회원 탈퇴 시 또는 수집·이용 목적이 달성된 때에는 해당 개인정보를 지체
          없이 파기하는 것을 원칙으로 합니다.
        </p>
        <p>
          2. 단, 전자상거래 등에서의 소비자보호에 관한 법률 등 관련 법령의 규정에 따라 보존할 의무가
          있는 경우 해당 법정 기간 동안 분리 보관합니다.
        </p>
        <OperatorNote item="법정 보존 항목별 정확한 보존 연한 확정" />
      </div>
    ),
  },
  {
    id: 'outsourcing',
    title: '개인정보 처리의 위탁',
    articleNumber: '제3조',
    content: (
      <div>
        <p>
          소희는 원활한 서비스 제공과 기술 인프라 운영을 위해 다음과 같이 개인정보 처리 업무를
          위탁하고 있습니다.
        </p>
        <ul>
          <li>
            <strong>[코드 확인 인프라] Supabase Inc.:</strong> 데이터베이스 호스팅, 데이터 백업 및
            회원 인증 인프라 운영
          </li>
          <li>
            <strong>[코드 확인 인프라] Cloudflare Inc.:</strong> 클라우드 엣지 컴퓨팅, 웹 애플리케이션
            호스팅 및 글로벌 보안 네트워크(CDN)
          </li>
          <li>
            <strong>[코드 확인 AI 엔진] OpenAI, L.L.C.:</strong> 인공지능 언어 모델 기반 마케팅 콘텐츠
            초안 생성 및 텍스트 처리
          </li>
          <li>
            <strong>[결제 위탁 예정] 전자결제대행:</strong> 결제 서비스 제공을 위한 위탁 예정 (계약 확정 후 수탁사명 및 구체적 위탁 업무 범위 기재)
          </li>
        </ul>
        <OperatorNote item="상용 결제대행(PG) 및 문자/알림톡 발송 대행 계약 체결 후 수탁사 정보 확정 반영" />
      </div>
    ),
  },
  {
    id: 'third-party-provision',
    title: '개인정보의 제3자 제공',
    articleNumber: '제4조',
    content: (
      <div>
        <p>
          1. 소희는 이용자의 사전 동의 없이 개인정보를 제3자에게 유상 또는 무상으로 제공하지
          않습니다.
        </p>
        <p>
          2. 다만, 법률의 특별한 규정이 있거나 수사 목적으로 법령에 정해진 절차와 방법에 따라
          수사기관의 요구가 있는 경우는 예외로 합니다.
        </p>
        <OperatorNote item="외부 채널 연동 또는 비즈니스 제휴 시 제3자 제공 동의 절차 및 대상 사업자 확정" />
      </div>
    ),
  },
  {
    id: 'cross-border-transfer',
    title: '개인정보의 국외 이전',
    articleNumber: '제5조',
    content: (
      <div>
        <p>
          소희 서비스의 글로벌 클라우드 및 AI 인프라 환경에 따라, 코드 및 시스템 의존성으로 확인된
          다음 외부 서비스를 통해 개인정보가 국외로 이전(위탁 보관 및 처리)될 수 있습니다.
        </p>
        <ul>
          <li>
            <strong>Supabase Inc. (미국 AWS 리전 등):</strong> 암호화된 데이터베이스 보관 및 인증 정보
            처리 (보유 기간: 회원 탈퇴 또는 계약 종료 시까지)
          </li>
          <li>
            <strong>Cloudflare Inc. (미국 및 글로벌 네트워크):</strong> 엣지 네트워크 프록시 전송 및
            웹 보안 방화벽 캐싱
          </li>
          <li>
            <strong>OpenAI, L.L.C. (미국):</strong> 마케팅 초안 생성 요청 텍스트 처리 (API 정책에 따라
            제공된 데이터는 기본 모델 학습에 활용되지 않음)
          </li>
        </ul>
        <OperatorNote item="국외 이전되는 구체적 데이터 항목, 이전 일시, 이전 방법 및 정보관리책임자 연락처 법무 실사 확정" />
      </div>
    ),
  },
  {
    id: 'data-subject-rights',
    title: '이용자의 권리와 행사 방법',
    articleNumber: '제6조',
    content: (
      <div>
        <p>
          1. 이용자는 언제든지 본인의 개인정보에 대해 열람, 정정, 삭제, 처리정지를 요구할 수
          있습니다.
        </p>
        <p>
          2. 계정 데이터 및 연동된 Meta(Instagram/Threads) 관련 데이터 삭제를 원하시는 경우, 서비스 내{' '}
          <Link href="/data-deletion">사용자 데이터 삭제 안내 페이지</Link>를 통해 직접 요청을 접수할 수
          있으며 발급된 확인 코드로 처리 상태를 확인하실 수 있습니다.
        </p>
        <p>
          3. 공식 지원 이메일(<a href={`mailto:${OPERATOR_INFO.supportEmail}`}>{OPERATOR_INFO.supportEmail}</a>)을
          통해서도 개인정보 권리 행사를 요청하실 수 있습니다.
        </p>
      </div>
    ),
  },
  {
    id: 'privacy-officer',
    title: '개인정보 보호책임자',
    articleNumber: '제7조',
    content: (
      <div>
        <p>
          소희({OPERATOR_INFO.companyName})는 개인정보 처리에 관한 업무를 총괄해서 책임지고, 개인정보 처리와 관련한 정보주체의 불만
          처리 및 피해 구제 등을 위하여 아래와 같이 개인정보 보호책임자를 지정할 예정입니다.
        </p>
        <OperatorNote item="개인정보 보호책임자 성명, 부서/직책 확정 (운영사 대표 연락처로 문의 접수)" />
        <ul>
          <li><strong>운영 주체:</strong> {OPERATOR_INFO.companyName} (대표자: {OPERATOR_INFO.representative})</li>
          <li><strong>고객센터 전화:</strong> <a href={`tel:${OPERATOR_INFO.phone}`}>{OPERATOR_INFO.phone}</a></li>
          <li><strong>문의 이메일:</strong> <a href={`mailto:${OPERATOR_INFO.supportEmail}`}>{OPERATOR_INFO.supportEmail}</a></li>
        </ul>
      </div>
    ),
  },
  {
    id: 'cookies',
    title: '쿠키 및 자동 수집 장치의 설치·운영 및 거부',
    articleNumber: '제8조',
    content: (
      <div>
        <p>
          1. 서비스는 이용자에게 개별화된 맞춤 서비스와 안전한 로그인 세션을 제공하기 위해 쿠키(Cookie)를
          사용합니다.
        </p>
        <p>
          2. 이용자는 웹 브라우저의 옵션을 설정함으로써 모든 쿠키를 허용하거나, 쿠키가 저장될 때마다
          확인을 거치거나, 모든 쿠키의 저장을 거부할 수 있습니다. 다만, 쿠키 저장을 거부할 경우
          로그인이 필요한 일부 기능 이용에 어려움이 있을 수 있습니다.
        </p>
      </div>
    ),
  },
  {
    id: 'policy-amendments',
    title: '개인정보 처리방침의 변경',
    articleNumber: '제9조',
    content: (
      <div>
        <p>
          본 방침은 관련 법령이나 서비스의 변경 사항을 반영하기 위해 수정될 수 있습니다. 처리방침이
          변경되는 경우 웹사이트 공지사항 또는 개별 이메일을 통해 공지합니다.
        </p>
        <OperatorNote item="처리방침 개정 시 사전 공지 기간 확정" />
      </div>
    ),
  },
]

export default function PrivacyPage() {
  return (
    <LegalDocument
      articles={privacyArticles}
      description="소희(example.com)가 회원의 개인정보를 어떻게 수집, 이용, 위탁 및 보호하는지 투명하게 안내합니다."
      effectiveDate="확정 전 (초안)"
      title="개인정보 처리방침"
    />
  )
}
