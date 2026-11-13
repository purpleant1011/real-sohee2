import Image from 'next/image'
import { MARKETING_ASSETS } from './v085-assets'
import styles from './v085-marketing.module.css'

const boundaries = [
  ['소희가 자동으로 정리', '고객 신호, 답변 초안, 콘텐츠 버전과 결과 자료를 준비합니다.'],
  ['사장님 확인 뒤 실행', '정확한 계정, 대상, 버전, 시각과 외부 영향을 확인합니다.'],
  ['공식 화면에서 마무리', '보호된 로그인이나 공식 제출이 필요한 채널은 마지막 단계만 직접 마칩니다.'],
  ['소희가 하지 않는 일', '비밀번호 저장, 결과 불명 자동 재실행, 승인 밖의 게시와 고객 연락을 하지 않습니다.'],
] as const

export function DelegationProof() {
  const asset = MARKETING_ASSETS.delegationReceipt
  return <section aria-labelledby="delegation-title" className={styles.delegationSection}><header className={styles.sectionHeading}><p>안전은 약속이 아니라 확인 가능한 과정입니다</p><h2 id="delegation-title">자동화보다 먼저, 정확한 위임을 보여드립니다.</h2></header><div className={styles.delegationMedia}><Image alt={asset.alt} height={asset.height} sizes="(max-width: 760px) 100vw, 70vw" src={asset.src} width={asset.width} /></div><div className={styles.boundaryGrid}>{boundaries.map(([title, copy], index) => <article key={title}><span>{String(index + 1).padStart(2, '0')}</span><h3>{title}</h3><p>{copy}</p></article>)}</div></section>
}
