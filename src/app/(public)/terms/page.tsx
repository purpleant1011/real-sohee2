import type { Metadata } from 'next'
import Link from 'next/link'
import { subscriptionOffers, subscriptionOfferPolicy } from '@/features/billing/subscription-offers'
import { OPERATOR_INFO } from '@/features/marketing/operator-information'
import { LegalDocument, OperatorNote, type LegalArticle } from '../legal-document'

export const metadata: Metadata = {
  title: '이용약관 | 소희',
  description: '소희(example.com) 서비스 이용에 관한 기본 조건과 절차를 안내합니다.',
}

const termsArticles: readonly LegalArticle[] = [
  {
    id: 'purpose',
    title: '목적',
    articleNumber: '제1조',
    content: (
      <div>
        <p>
          본 약관은 소희(example.com, 이하 &ldquo;서비스&rdquo;)를 제공하는 운영자(이하
          &ldquo;회사&rdquo;)와 서비스를 이용하는 고객(이하 &ldquo;이용자&rdquo; 또는
          &ldquo;사장님&rdquo;) 사이의 권리·의무 및 책임사항, 기타 서비스 이용에 필요한 기본적인
          사항을 규정함을 목적으로 합니다.
        </p>
        <p>
          회사의 사업자 정보는 다음과 같습니다.
        </p>
        <ul>
          <li><strong>상호:</strong> {OPERATOR_INFO.companyName} (대표자: {OPERATOR_INFO.representative})</li>
          <li><strong>사업자등록번호:</strong> {OPERATOR_INFO.businessRegistrationNumber}</li>
          <li><strong>통신판매업신고번호:</strong> {OPERATOR_INFO.telecomRegistrationNumber}</li>
          <li><strong>사업장 주소:</strong> {OPERATOR_INFO.address}</li>
          <li><strong>고객센터 전화:</strong> {OPERATOR_INFO.phone}</li>
          <li><strong>이메일:</strong> {OPERATOR_INFO.supportEmail}</li>
        </ul>
      </div>
    ),
  },
  {
    id: 'definitions',
    title: '정의',
    articleNumber: '제2조',
    content: (
      <div>
        <p>본 약관에서 사용하는 용어의 정의는 다음과 같습니다.</p>
        <ol>
          <li>
            <strong>서비스:</strong> 매장의 마케팅 업무를 보조하기 위해 소희가 제공하는 AI 마케팅
            에이전트 소프트웨어 및 관련 웹 서비스(콘텐츠 초안 작성, 승인 후 자동 게시, 성과 분석
            리포트, 고객 예약패스 등)를 의미합니다.
          </li>
          <li>
            <strong>이용자:</strong> 본 약관에 동의하고 계정을 생성하여 서비스를 이용하는 매장
            운영자 또는 사업자를 의미합니다.
          </li>
          <li>
            <strong>작업공간:</strong> 이용자가 매장의 프로필, 마케팅 채널, 멤버 및 실행 기록을
            관리하는 단위 환경을 의미합니다.
          </li>
          <li>
            <strong>승인:</strong> 소희가 제안한 콘텐츠 초안이나 외부 실행 작업에 대해 이용자가
            내용을 확인하고 발행 또는 발송을 최종 허가하는 행위를 의미합니다.
          </li>
        </ol>
        <OperatorNote item="작업공간 내 역할(소유자, 관리자, 직원)별 결제 및 채널 관리 권한 범위 확정" />
      </div>
    ),
  },
  {
    id: 'effectiveness-and-changes',
    title: '약관의 효력과 변경',
    articleNumber: '제3조',
    content: (
      <div>
        <p>
          1. 본 약관은 서비스 웹사이트(example.com)에 게시하거나 전자우편 등 합리적인 방법으로
          공지함으로써 효력이 발생합니다.
        </p>
        <p>
          2. 회사는 관련 법령을 위배하지 않는 범위에서 본 약관을 개정할 수 있으며, 약관을 개정할
          경우 적용일자 및 개정 사유를 명시하여 적용일 이전에 웹사이트를 통해 공지합니다.
        </p>
        <p>
          3. 이용자가 개정 약관의 적용에 동의하지 않는 경우 서비스 이용을 중단하고 탈퇴를 요청할 수
          있습니다.
        </p>
        <OperatorNote item="약관 개정 시 사전 공지 기간 명시" />
      </div>
    ),
  },
  {
    id: 'service-content',
    title: '서비스 내용',
    articleNumber: '제4조',
    content: (
      <div>
        <p>1. 소희는 매장 마케팅과 고객 소통을 지원하기 위해 다음 기능을 제공합니다.</p>
        <ul>
          <li>매장 정보와 스타일에 기반한 SNS 및 블로그 콘텐츠 초안 자동 작성</li>
          <li>
            외부 마케팅 채널 연동 및 발행 지원 (Instagram, Threads, Naver, Kakao, 당근)
          </li>
          <li>고객 예약패스 및 카카오 채널 안내 CTA 지원</li>
          <li>마케팅 성과 리포트 및 지표 확인</li>
        </ul>
        <p>
          2. 외부 마케팅 채널(Instagram, Threads, Naver, Kakao, 당근)의 API 정책 변경, 서비스 점검
          또는 기술적 장애가 발생하는 경우 일부 기능의 제공이 일시적으로 지연되거나 제한될 수
          있습니다.
        </p>
        <OperatorNote item="채널별 외부 플랫폼 정책 변경에 따른 서비스 사후 대응 기준 및 공지 절차 확정" />
      </div>
    ),
  },
  {
    id: 'account-and-obligations',
    title: '계정과 이용자의 의무',
    articleNumber: '제5조',
    content: (
      <div>
        <p>
          1. 이용자는 서비스 가입 시 현재의 사실과 일치하는 정확한 정보를 제공해야 하며, 변경사항이
          발생한 경우 즉시 정보를 갱신해야 합니다.
        </p>
        <p>
          2. 이용자는 본인의 계정 접속 정보와 연동된 마케팅 채널 자격 증명을 안전하게 관리할 책임이
          있으며, 이를 제3자에게 양도하거나 대여할 수 없습니다.
        </p>
        <p>
          3. 이용자는 관련 법령(표시·광고의 공정화에 관한 법률, 개인정보보호법, 정보통신망법 등), 본
          약관 및 각 외부 플랫폼의 운영 정책을 준수해야 합니다.
        </p>
        <p>4. 만 14세 미만의 아동은 서비스에 가입하거나 이용할 수 없습니다.</p>
        <OperatorNote item="사업자등록 진위확인 절차 및 법인 회원 가입 시 추가 제출 서류 기준 확정" />
      </div>
    ),
  },
  {
    id: 'pricing-and-billing',
    title: '이용요금·정기결제·자동 갱신',
    articleNumber: '제6조',
    content: (
      <div>
        <p>
          1. 서비스의 플랜별 기준 요금은 다음과 같으며, <strong>표시된 월 구독료는 부가가치세(VAT)를 포함한 최종 결제금액</strong>입니다.
        </p>
        <ul>
          {subscriptionOffers.map((plan) => (
            <li key={plan.code}>
              <strong>{plan.name}:</strong> 월 {plan.monthlyTotalPriceKrw.toLocaleString('ko-KR')}원 (부가가치세 포함)
            </li>
          ))}
        </ul>
        <p>
          2. {subscriptionOfferPolicy.notice}
        </p>
        <p>
          3. {subscriptionOfferPolicy.creditNotice}
        </p>
        <p>
          4. <strong>서비스 제공기간:</strong> {subscriptionOfferPolicy.servicePeriod.label} 기준이며, {subscriptionOfferPolicy.servicePeriod.boundaryNotice}
        </p>
        <p>
          5. <strong>정기결제 및 해지:</strong> 정기결제의 기본 해지 기준은 {subscriptionOfferPolicy.cancellation.label}이며, {subscriptionOfferPolicy.cancellation.notice}
        </p>
        <p>
          6. <strong>결제 상태 안내:</strong> 결제는 아직 연결되지 않았습니다. {subscriptionOfferPolicy.purchaseNotice}
        </p>
        <OperatorNote item="상용 결제 연동 후 정기결제 사전 고지 주기 및 청구일 기준 확정" />
        <OperatorNote item="결제 실패 시 재시도 횟수, 유예 기간 및 서비스 자동 정지 기준 확정" />
      </div>
    ),
  },
  {
    id: 'withdrawal-and-refund',
    title: '청약철회·환불',
    articleNumber: '제7조',
    content: (
      <div>
        <p>
          1. 유료 플랜 이용자의 청약철회 및 환불은 전자상거래 등에서의 소비자보호에 관한 법률 등 관련
          법령을 준수합니다.
        </p>
        <p>
          2. {subscriptionOfferPolicy.cancellation.refundNotice}
        </p>
        <p>
          3. 구체적인 환불 신청 및 접수는 <Link href="/refund">해지·환불 안내</Link> 페이지 및 공식 지원
          이메일(<a href={`mailto:${OPERATOR_INFO.supportEmail}`}>{OPERATOR_INFO.supportEmail}</a>)을
          통해 안내받으실 수 있습니다.
        </p>
        <OperatorNote item="법정 청약철회 요건 및 세부 환불 산식·기준 확정 (법률 검토 완료 후 반영)" />
      </div>
    ),
  },
  {
    id: 'termination',
    title: '계약 해지',
    articleNumber: '제8조',
    content: (
      <div>
        <p>
          1. 이용자는 서비스 내 설정 메뉴 또는 지원 이메일(
          <a href={`mailto:${OPERATOR_INFO.supportEmail}`}>{OPERATOR_INFO.supportEmail}</a>
          )을 통해 언제든지 이용계약 해지(회원 탈퇴)를 신청할 수 있습니다.
        </p>
        <p>
          2. 유료 구독 중인 이용자가 해지를 신청하는 경우, {subscriptionOfferPolicy.cancellation.label} 기준에 따라 {subscriptionOfferPolicy.cancellation.notice}
        </p>
        <p>
          3. 회사는 이용자가 본 약관의 중대한 의무를 위반하거나 관련 법령을 위반한 경우 사전 통지 후
          서비스 이용을 제한하거나 계약을 즉시 해지할 수 있습니다.
        </p>
        <OperatorNote item="유료 구독 즉시 해지 및 중도 일할 정산 신청 창구 운영 여부 확정" />
      </div>
    ),
  },
  {
    id: 'approval-and-responsibility',
    title: '게시·발송에 대한 이용자 승인과 책임',
    articleNumber: '제9조',
    content: (
      <div>
        <p>
          1. <strong>사전 승인 원칙:</strong> 소희는 이용자(사장님)의 명시적인 사전 검토 및 승인이
          있는 경우에만 외부 마케팅 채널에 콘텐츠를 게시하거나 고객에게 발송합니다. 이용자의 승인
          없이 자율적으로 게시하지 않습니다.
        </p>
        <p>
          2. <strong>내용 검토 의무:</strong> 소희가 생성한 문구, 이미지, 해시태그, 가격, 행사 정보
          등 모든 초안에 대해 매장의 실제 운영 현황과 일치하는지 최종 검토하고 확인할 책임은
          이용자에게 있습니다.
        </p>
        <p>
          3. <strong>법적 책임 귀속:</strong> 이용자의 승인을 거쳐 게시 또는 발송된 콘텐츠와
          관련하여 발생하는 공정거래위원회 표시·광고 심사지침 준수(#광고 표기 등), 저작권, 상표권,
          초상권, 소비자 분쟁 등 일체의 법적 책임은 최종 승인한 이용자에게 귀속됩니다.
        </p>
      </div>
    ),
  },
  {
    id: 'limitation-of-liability',
    title: '책임 제한',
    articleNumber: '제10조',
    content: (
      <div>
        <p>
          1. 회사는 천재지변, 외부 플랫폼(Instagram, Threads, Naver, Kakao, 당근)의 장애 또는 정책
          변경, 기간통신사업자의 회선 장애 등 불가항력적인 사유로 서비스를 제공할 수 없는 경우 이에
          대한 책임을 부담하지 않습니다.
        </p>
        <p>
          2. 소희는 매장 마케팅 업무를 보조하는 AI 솔루션으로서, 특정 수준의 매출 증대, 매장 방문객
          증가, 검색 상위 노출 등 상업적 성과를 보증하지 않습니다.
        </p>
        <OperatorNote item="회사의 손해배상 책임 한도 확정" />
      </div>
    ),
  },
  {
    id: 'dispute-resolution',
    title: '분쟁 해결',
    articleNumber: '제11조',
    content: (
      <div>
        <p>
          1. 회사와 이용자는 서비스 이용과 관련하여 발생한 분쟁을 원만하게 해결하기 위해 필요한 모든
          성실한 협의를 다합니다.
        </p>
        <p>
          2. 상호 협의로 분쟁이 해결되지 않는 경우, 대한민국 법률에 따라 관할 법원을 정하여 분쟁을
          해결합니다.
        </p>
        <OperatorNote item="소송 발생 시 전속 관할 법원 지정 확정" />
      </div>
    ),
  },
]

export default function TermsPage() {
  return (
    <LegalDocument
      articles={termsArticles}
      description="소희(example.com) 서비스 이용에 관한 권리와 의무, 주요 운영 정책을 안내합니다."
      effectiveDate="확정 전 (초안)"
      title="이용약관"
    />
  )
}
