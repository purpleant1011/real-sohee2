import { DiagnosisForm } from '@/features/diagnosis/diagnosis-form'
import styles from '@/features/marketing/v085-marketing.module.css'

export default function DiagnosisPage() { return <div className={styles.detailPage}><header className={styles.detailIntro}><p>비밀번호 없는 무료 진단</p><h1>내 매장의 첫 마케팅 기회를 먼저 확인하세요.</h1><span>공개 채널을 실제로 읽지 않은 상태에서는 입력 내용을 바탕으로 만든 예비 진단임을 분명히 표시합니다.</span></header><div className={styles.diagnosisWrap}><DiagnosisForm /></div></div> }
