import type { NextConfig } from 'next'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'
import { toNextRedirects } from './src/config/onboarding-redirects'
import { isLocalE2EEnabled } from './src/lib/env'
import { resolveTurbopackRoot } from './src/lib/turbopack-root'

initOpenNextCloudflareForDev()

const nextConfig: NextConfig = {
  ...(process.env.E2E_MOBILE_DECISION_FIXTURE === '1' ? { devIndicators: false as const } : {}),
  logging: false,
  // Mobile R2 QA 게이트는 127.0.0.1 로 dev 서버에 접근한다. Next dev 는 기본 허용 오리진(localhost)이
  // 아닌 오리진의 dev 리소스(/_next/static, /_next/hmr) 요청을 403 으로 막아 콘솔 에러 게이트가 오탐 실패한다.
  // 운영 빌드에는 영향이 없는 dev 전용 설정이다.
  allowedDevOrigins: ['127.0.0.1'],
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
  },
  typescript: {
    ignoreBuildErrors: process.env.SOHEE_CLOUDFLARE_WEBPACK === '1',
  },
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? { exclude: ['error', 'warn'] } : false,
  },
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.example.com' }],
        destination: 'https://example.com/:path*',
        permanent: true,
      },
      ...toNextRedirects(),
    ]
  },
  turbopack: {
    root: resolveTurbopackRoot({
      cwd: process.cwd(),
      isLocalE2E: isLocalE2EEnabled(),
      localE2ERoot: process.env.SOHEE_LOCAL_E2E_ROOT,
    }),
  },
  experimental: {
    optimizePackageImports: [
      'lucide-react',
      'motion',
      'recharts',
      'react-aria-components',
      'react-hook-form',
      '@number-flow/react',
      'nuqs',
      '@tanstack/react-table',
      '@tanstack/react-query',
      '@tanstack/react-virtual',
      '@ant-design/icons',
      '@ant-design/v5-patch-for-react-19',
      'antd',
      '@ant-design/pro-components',
      '@refinedev/core',
      '@refinedev/antd',
      '@refinedev/nextjs-router',
      'date-fns',
      'openai',
      'zod',
      'clsx',
      'tailwind-merge',
    ],
    serverActions: {
      bodySizeLimit: '12mb',
    },
  },
  webpack: (config, { isServer }) => {
    config.resolve = config.resolve || {}
    config.resolve.alias = {
      ...(config.resolve.alias || {}),
      sharp$: false,
      'onnxruntime-node$': false,
    }

    if (isServer) {
      config.plugins.push({
        apply(compiler: any) {
          compiler.hooks.afterEmit.tap('EnsurePagesManifestPlugin', (compilation: any) => {
            const fs = require('fs')
            const path = require('path')
            const serverDir = compiler.options.output.path
            if (serverDir && fs.existsSync(serverDir)) {
              const rootNextServer = path.join(process.cwd(), '.next', 'server')
              const dirs = [serverDir, rootNextServer]
              for (const d of dirs) {
                if (fs.existsSync(d)) {
                  if (!fs.existsSync(path.join(d, 'pages-manifest.json'))) {
                    fs.writeFileSync(path.join(d, 'pages-manifest.json'), '{}\n', 'utf8')
                  }
                  if (!fs.existsSync(path.join(d, 'app-paths-manifest.json'))) {
                    const srcAppPaths = path.join(d, 'app-paths-manifest.json')
                    const nested = path.join(d, 'app', 'app-paths-manifest.json')
                    if (fs.existsSync(nested)) {
                      fs.copyFileSync(nested, srcAppPaths)
                    } else {
                      fs.writeFileSync(srcAppPaths, '{}\n', 'utf8')
                    }
                  }
                  if (!fs.existsSync(path.join(d, 'middleware-manifest.json'))) {
                    fs.writeFileSync(path.join(d, 'middleware-manifest.json'), JSON.stringify({ version: 3, middleware: {}, sortedMiddleware: [], functions: {} }, null, 2), 'utf8')
                  }
                  if (!fs.existsSync(path.join(d, 'next-font-manifest.json'))) {
                    fs.writeFileSync(path.join(d, 'next-font-manifest.json'), JSON.stringify({ pages: {}, app: {}, appUsingSizeAdjust: false, pagesUsingSizeAdjust: false }, null, 2), 'utf8')
                  }
                  const globalErrorDir = path.join(d, 'app', '_global-error')
                  if (fs.existsSync(globalErrorDir)) {
                    const nftFile = path.join(globalErrorDir, 'page.js.nft.json')
                    if (!fs.existsSync(nftFile)) {
                      fs.writeFileSync(nftFile, JSON.stringify({ version: 1, files: [] }), 'utf8')
                    }
                  }
                }
              }
            }
          })
        },
      })
    }

    return config
  },
}


export default nextConfig
