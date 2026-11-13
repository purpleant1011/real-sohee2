import styles from './marketing.module.css'

const operationSteps = [
  ['트렌드 발견', '이번 주 고객이 찾는 주제와 계절의 흐름을 모읍니다.'],
  ['콘텐츠 초안', '가게의 말투와 메뉴에 맞춰 첫 문장을 준비합니다.'],
  ['사장님 승인', '게시 전 문구와 사진을 보고 선택하거나 고칩니다.'],
  ['채널 게시', '승인된 내용을 정한 채널에 맞춰 보낼 준비를 합니다.'],
  ['댓글·성과', '반응을 함께 살펴보고 다음 준비에 반영합니다.'],
] as const

export function OperationsBoard() {
  return (
    <section className={styles.operationsSection} aria-labelledby="operations-title">
      <div className={styles.sectionIntro}>
        <p className={styles.kicker}>한눈에 보는 운영 흐름</p>
        <h2 id="operations-title">준비는 소희가, 최종 결정은 사장님이 합니다.</h2>
        <p>한 번의 게시를 끝내는 일이 아니라, 다음 판단까지 이어지는 흐름을 만듭니다.</p>
      </div>
      <div className={styles.exampleNotice}>
        <span>예시 데이터</span>
        <p>아래 상태와 문구는 같은 운영 흐름을 설명하기 위한 예시입니다.</p>
      </div>
      <ol className={styles.operationsBoard}>
        {operationSteps.map(([title, description], index) => (
          <li key={title} className={styles.operationStep}>
            <span className={styles.operationIndex} aria-hidden="true">
              {String(index + 1).padStart(2, '0')}
            </span>
            <div>
              <h3>{title}</h3>
              <p>{description}</p>
              <span className={styles.exampleTag}>예시 데이터</span>
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
