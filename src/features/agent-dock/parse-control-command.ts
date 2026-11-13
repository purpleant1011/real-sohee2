import { ParsedControlCommand } from './types';

export function parseControlCommand(input: string): ParsedControlCommand {
  const trimmed = input.trim();
  const normalized = trimmed.toLowerCase().replace(/\s+/g, ' ');

  // 1. Emergency Stop (Kill Switch) patterns - highest precedence
  const emergencyStopPatterns = [
    /긴급\s*정지/,
    /완전\s*중단/,
    /비상\s*정지/,
    /킬\s*스위치/,
    /\bkill\s*switch\b/,
    /\bemergency\s*stop\b/,
    /강제\s*종료/,
    /모든\s*작업\s*중단/,
  ];

  for (const pattern of emergencyStopPatterns) {
    if (pattern.test(normalized)) {
      return {
        type: 'EMERGENCY_STOP',
        rawQuery: trimmed,
        confidence: 0.95,
        reason: '사장님 비상 명령: 모든 외부 쓰기 작업 즉각 긴급 차단(Kill Switch)',
      };
    }
  }

  // 2. Pause patterns
  const pausePatterns = [
    /^(잠깐\s*)?멈춰(봐|줘)?$/,
    /일시\s*정지/,
    /잠시\s*멈춤/,
    /잠깐\s*쉬어/,
    /작업\s*일시\s*중단/,
    /\bpause\b/,
    /그만\s*해/,
  ];

  for (const pattern of pausePatterns) {
    if (pattern.test(normalized)) {
      return {
        type: 'PAUSE',
        rawQuery: trimmed,
        confidence: 0.9,
        reason: '사장님 지침: 소희의 실시간 자율 업무 일시정지',
      };
    }
  }

  // 3. Resume patterns
  const resumePatterns = [
    /다시\s*시작/,
    /업무\s*재개/,
    /계속\s*일해/,
    /다시\s*해줘?/,
    /\bresume\b/,
    /재개해(줘)?/,
    /작업\s*시작/,
  ];

  for (const pattern of resumePatterns) {
    if (pattern.test(normalized)) {
      return {
        type: 'RESUME',
        rawQuery: trimmed,
        confidence: 0.9,
        reason: '사장님 승인: 소희의 실시간 자율 업무 재개',
      };
    }
  }

  return {
    type: 'NONE',
    rawQuery: trimmed,
    confidence: 0,
    reason: '일반 대화 및 마케팅 지시',
  };
}
