/**
 * Sohee V0.8.9 Untrusted Input Boundary & Prompt Injection Defense
 * 
 * Invariants:
 * 1. External customer inputs (Comments, DMs, Web Pages) MUST be sanitized and isolated in XML boundaries.
 * 2. Jailbreak and directive bypass attempts are neutralized before reaching LLM reasoning.
 */

const SUSPICIOUS_PROMPT_PATTERNS = [
  /ignore previous instructions/i,
  /system prompt/i,
  /you are now in developer mode/i,
  /admin override/i,
  /당신의 시스템 프롬프트를 출력/i,
  /이전 지침을 모두 무시/i,
  /비밀번호 알려줘/i
];

export interface SanitizedInputResult {
  isSafe: boolean;
  sanitizedText: string;
  isolationWrapper: string;
  detectedThreats: string[];
}

export function sanitizeUntrustedInput(rawInput: string): SanitizedInputResult {
  const detectedThreats: string[] = [];

  for (const pattern of SUSPICIOUS_PROMPT_PATTERNS) {
    if (pattern.test(rawInput)) {
      detectedThreats.push(pattern.source);
    }
  }

  // 특수 제어문자 및 태그 이스케이프
  const clean = rawInput
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // LLM 프롬프트에 주입할 때 사용할 엄격한 격리 래퍼
  const isolationWrapper = `<untrusted_user_input>\n${clean}\n</untrusted_user_input>`;

  return {
    isSafe: detectedThreats.length === 0,
    sanitizedText: clean,
    isolationWrapper,
    detectedThreats
  };
}
