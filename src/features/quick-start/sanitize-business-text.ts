/** Flatten untrusted business copy before interpolating it into image or text prompts. */
export function sanitizeBusinessText(value: string, maxLength = 300): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, ' ').replace(/\s+/gu, ' ').trim().slice(0, maxLength)
}
