import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'

const localClient = fileURLToPath(new URL('./restart-client.ts', import.meta.url))
export default defineConfig({
  resolve: {
    alias: [
      { find: '@/lib/supabase/server', replacement: localClient },
      { find: '@/lib/supabase/admin', replacement: localClient },
      { find: '@', replacement: fileURLToPath(new URL('../../../../src', import.meta.url)) },
    ],
  },
})
