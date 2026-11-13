import { defineConfig, globalIgnores } from 'eslint/config'
import nextCoreWebVitals from 'eslint-config-next/core-web-vitals'
import nextTypeScript from 'eslint-config-next/typescript'
import userCopyPlugin from './scripts/lint-user-copy/eslint-plugin.mjs'

const plugins = nextCoreWebVitals[0]?.plugins || {}

export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    plugins,
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@next/next/no-assign-module-variable': 'off',
      '@typescript-eslint/no-require-imports': 'warn',
      'prefer-const': 'warn',
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
    }
  },
  {
    name: 'sohee/user-copy-lint',
    files: [
      'src/app/(onboarding)/**/*.{ts,tsx}',
      'src/app/app/**/*.{ts,tsx}',
      'src/app/start/**/*.{ts,tsx}',
      'src/app/(auth)/**/*.{ts,tsx}',
      'src/components/**/*.{ts,tsx}',
      'src/features/**/*.{ts,tsx}',
    ],
    ignores: [
      '**/admin/**',
      '**/operator/**',
      '**/*admin*/**',
      '**/*operator*/**',
      '**/*.test.*',
      '**/*.spec.*',
    ],
    plugins: {
      'user-copy': userCopyPlugin,
    },
    rules: {
      'user-copy/no-internal-terms': 'warn',
    },
  },
  {
    name: 'sohee/no-testing-mocks-in-prod',
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['**/*.test.*', '**/*.spec.*', '**/__tests__/**', '**/testing/**'],
    rules: {
      // 값 import 만 막는다. `import type` 은 컴파일 시 소거되어 런타임 의존이 없으므로
      // 계약 타입(Context·Scope·TestVerifier 등)을 testing/ 에서 가져오는 것은 허용한다.
      // 기본 `no-restricted-imports` 는 allowTypeImports 를 지원하지 않아 typescript-eslint 판을 쓴다.
      'no-restricted-imports': 'off',
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/testing', '**/testing/*'],
              allowTypeImports: true,
              message:
                '테스트 전용 모의(testing/)를 운영 코드가 값으로 import할 수 없습니다. 런타임 의존은 포트 주입으로만 연결하세요. (타입 import는 허용)',
            },
          ],
        },
      ],
    },
  },
  globalIgnores([
    '.worktrees/**',
    '.claude/worktrees/**',
    '.next/**',
    '.open-next/**',
    '.wrangler/**',
    'connector/chrome-extension/dist/**',
    'connector/chrome-extension/dist-test/**',
    'connector/native-host/dist/**',
    'coverage/**',
    'node_modules/**',
    'playwright-report/**',
    'supabase/.temp/**',
    'test-results/**',
  ]),
])
