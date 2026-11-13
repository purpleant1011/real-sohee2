import type { Metadata } from 'next'
import { OPERATOR_FIELDS, OPERATOR_INFO } from '@/features/marketing/operator-information'
import styles from '@/features/marketing/marketing.module.css'

export const metadata: Metadata = {
  title: '사업자 정보 | 소희',
  description: '소희를 운영하는 예시회사의 사업자 정보와 고객 문의 방법입니다.',
}

export default function BusinessInfoPage() {
  return (
    <article className={styles.legalPage}>
      <h1>사업자 정보</h1>
      <p className={styles.legalLead}>
        소희(example.com)는 예시회사가 직접 기획하고 운영하는 소상공인 마케팅 서비스입니다.
      </p>
      <div className={styles.legalSections}>
        <section>
          <h2>운영 주체</h2>
          <dl>
            {OPERATOR_FIELDS.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section>
          <h2>고객 문의</h2>
          <p>
            고객센터 전화{' '}
            <a href={`tel:${OPERATOR_INFO.phone}`}>{OPERATOR_INFO.phone}</a>
            {' | '}
            이메일{' '}
            <a href={`mailto:${OPERATOR_INFO.supportEmail}`}>{OPERATOR_INFO.supportEmail}</a>
            {' '}로 문의해 주세요. 카카오톡 채널 &lsquo;예시회사 소희&rsquo;에서도 안내를 받을 수 있습니다.
          </p>
        </section>
      </div>
    </article>
  )
}
