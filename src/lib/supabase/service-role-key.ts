const serviceRoleKeyPattern = /^sb_secret_[A-Za-z0-9._-]+$/
const nativeReflectApply = Reflect.apply
const nativeRegExpTest = RegExp.prototype.test

export function parseServiceRoleKey(value: string | undefined): string {
  if (
    typeof value !== 'string' ||
    !nativeReflectApply(nativeRegExpTest, serviceRoleKeyPattern, [value])
  ) {
    throw new Error('서버 전용 Supabase 비밀키가 설정되지 않았습니다.')
  }

  return value
}
