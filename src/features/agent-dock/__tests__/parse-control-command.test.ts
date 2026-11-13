import { describe, it, expect } from 'vitest';
import { parseControlCommand } from '../parse-control-command';

describe('parseControlCommand (ANI-809 Chat-to-Control Same Truth)', () => {
  it('correctly detects emergency stop / kill switch commands with highest precedence', () => {
    expect(parseControlCommand('긴급 정지해').type).toBe('EMERGENCY_STOP');
    expect(parseControlCommand('완전 중단해').type).toBe('EMERGENCY_STOP');
    expect(parseControlCommand('킬스위치 켜줘').type).toBe('EMERGENCY_STOP');
    expect(parseControlCommand('모든 작업 중단해').type).toBe('EMERGENCY_STOP');
    expect(parseControlCommand('kill switch now').type).toBe('EMERGENCY_STOP');
  });

  it('correctly detects pause commands', () => {
    expect(parseControlCommand('잠깐 멈춰').type).toBe('PAUSE');
    expect(parseControlCommand('멈춰').type).toBe('PAUSE');
    expect(parseControlCommand('일시 정지해줘').type).toBe('PAUSE');
    expect(parseControlCommand('잠시 멈춤').type).toBe('PAUSE');
    expect(parseControlCommand('pause').type).toBe('PAUSE');
  });

  it('correctly detects resume commands', () => {
    expect(parseControlCommand('다시 시작해').type).toBe('RESUME');
    expect(parseControlCommand('업무 재개해줘').type).toBe('RESUME');
    expect(parseControlCommand('계속 일해').type).toBe('RESUME');
    expect(parseControlCommand('resume').type).toBe('RESUME');
  });

  it('returns NONE for normal conversation and marketing queries', () => {
    expect(parseControlCommand('오늘 블로그 글 하나 써줘').type).toBe('NONE');
    expect(parseControlCommand('지난주 인스타 성과 어때?').type).toBe('NONE');
    expect(parseControlCommand('원장님 할인 프로모션 기획해줘').type).toBe('NONE');
  });
});
