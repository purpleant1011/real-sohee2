# Ego 공식 가이드 확인 영수증

ANI-1635 골격 구현자가 설치된 `ego-browser skill` 전체 출력을 보존하고, Sol이 버전·주요 API·종료 marker를 source review했다.

- 확인 버전: **v2.1.0**.
- 시작 marker: `[ego-browser:skill] ego-browser usage guide v2.1.0`.
- 종료 marker: `[ego-browser:skill] end of guide v2.1.0`.
- 전체 출력: 551줄, 로컬 `.claude/w3-e2e-ego-guide-v2.1.0.txt`에 보존(공개 PR에는 전문 대신 이 영수증 제출).
- 확인한 규약: global `taskSpace(name)`·spaceId 재사용, 기존 page와 newPage 구분, snapshot/ref 기반 조작, 자신의 성공 작업만 finish, 사용자 제어/오류 중단.
- 이번 실제 브라우저/TaskSpace 생성: **미실행**. SDK runtime/API 호환성·viewport UI·실계정/Provider 검증을 이 영수증으로 통과 처리하지 않는다.

현재 설치 버전의 가이드를 확인하는 명령:

```bash
ego-browser skill
```

CLI/가이드가 없거나 version/API가 달라지면 임의 설치·upgrade·다른 브라우저 전환을 하지 말고 해당 실행을 NOT_VERIFIED로 남긴다. upgrade가 사용자 승인으로 수행된 경우 guide를 다시 확인한다.
