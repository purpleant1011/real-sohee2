var module = globalThis.module = globalThis.module || { exports: {} };
var exports = globalThis.exports = globalThis.exports || {};

import openNextWorker from './.open-next/worker.js'
import { soheeBuildId } from './.open-next/sohee-build.js'

const worker = {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);

      // 0. Instant Probe & Scanner Blocker (Zero CPU, protects Worker isolate from resource exhaustion)
      if (
        /\.(env|git|svn|htaccess|aws|yml|yaml|sql|bak|conf|ini)($|\?)/i.test(url.pathname) ||
        /\/(wp-|cgi-bin|\.well-known\/security|phpmyadmin)/i.test(url.pathname)
      ) {
        return new Response('Not Found', {
          status: 404,
          headers: {
            'content-type': 'text/plain; charset=utf-8',
            'cache-control': 'public, max-age=86400',
          },
        });
      }

      // 1. Fast Static Asset Direct Router (Zero CPU overhead, eliminates Error 1102 on assets)
      const isStaticPath = url.pathname.startsWith('/_next/static/') ||
        url.pathname.startsWith('/brand/') ||
        url.pathname.startsWith('/fonts/') ||
        url.pathname.startsWith('/icons/') ||
        url.pathname === '/favicon.ico' ||
        url.pathname === '/robots.txt' ||
        url.pathname === '/sitemap.xml' ||
        /\.(?:ico|png|jpe?g|webp|svg|gif|css|js|mjs|woff2?|ttf|eot|map|txt|xml|json|html)$/i.test(url.pathname);

      if (env.ASSETS && isStaticPath) {
        try {
          const assetResponse = await env.ASSETS.fetch(request);
          if (assetResponse && assetResponse.status !== 404) {
            return assetResponse;
          }
        } catch {
          // Fall through to OpenNext if asset fetch fails
        }
      }

      // 2. Fast Pre-rendered Static HTML Router for Clean URLs (/login, /signup, etc.)
      if (env.ASSETS && request.method === 'GET' && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/_next/')) {
        try {
          const cleanHtmlPath = url.pathname === '/' ? '/index.html' : `${url.pathname.replace(/\/$/, '')}.html`;
          const htmlRequest = new Request(new URL(cleanHtmlPath, request.url), request);
          const htmlResponse = await env.ASSETS.fetch(htmlRequest);
          if (htmlResponse && htmlResponse.status === 200) {
            const headers = new Headers(htmlResponse.headers);
            headers.set('content-type', 'text/html; charset=utf-8');
            headers.set('x-sohee-build', soheeBuildId);
            headers.set('x-sohee-edge-asset', '1');
            return new Response(htmlResponse.body, {
              status: 200,
              headers,
            });
          }
        } catch {
          // Fall through
        }
      }

      // 3. Cloudflare Edge Cache for Public Pages (Zero CPU on cache hit)
      const cookieHeader = request.headers.get('cookie') || '';
      const hasAuthSession = cookieHeader.includes('sb-') || cookieHeader.includes('sohee-auth');
      const isCacheablePath =
        request.method === 'GET' &&
        !hasAuthSession &&
        !url.searchParams.has('error') &&
        (url.pathname === '/' || url.pathname === '/login' || url.pathname === '/signup' || url.pathname === '/admin-login');

      const cache = typeof caches !== 'undefined' ? caches.default : null;
      const cacheKey = new Request(url.toString(), { method: 'GET', headers: request.headers });

      if (cache && isCacheablePath) {
        try {
          const cached = await cache.match(cacheKey);
          if (cached) {
            const cachedHeaders = new Headers(cached.headers);
            cachedHeaders.set('x-sohee-cache', 'HIT');
            return new Response(cached.body, {
              status: cached.status,
              statusText: cached.statusText,
              headers: cachedHeaders,
            });
          }
        } catch {
          // Fall through to OpenNext
        }
      }

      // 4. OpenNext SSR Fetch Handler (All API and dynamic requests routed to Next.js Agent OS)
      const response = await openNextWorker.fetch(request, env, ctx)
      if (!response) {
        return new Response('Not Found', { status: 404 })
      }

      // Check if response is a redirect or null-body response
      const isNullBody = [101, 204, 205, 304].includes(response.status)
      const headers = new Headers(response.headers)
      headers.set('x-sohee-build', soheeBuildId)

      // Preserve multi-value Set-Cookie headers properly for OAuth sessions
      if (typeof response.headers.getSetCookie === 'function') {
        const setCookies = response.headers.getSetCookie()
        if (setCookies && setCookies.length > 0) {
          headers.delete('set-cookie')
          for (const cookie of setCookies) {
            headers.append('set-cookie', cookie)
          }
        }
      }

      const contentType = headers.get('content-type') ?? ''
      if (contentType.includes('text/html')) {
        if (isCacheablePath && response.status === 200) {
          headers.set('cache-control', 'public, max-age=60, s-maxage=300, stale-while-revalidate=600')
          if (cache) {
            try {
              const [bodyForCache, bodyForReturn] = response.body ? response.body.tee() : [null, null];
              ctx.waitUntil(cache.put(cacheKey, new Response(bodyForCache, {
                status: response.status,
                headers,
              })));
              return new Response(bodyForReturn, {
                headers,
                status: response.status,
                statusText: response.statusText,
              });
            } catch {
              // Fall through to standard response construction
            }
          }
        } else {
          headers.set('cache-control', 'private, no-cache, no-store, max-age=0, must-revalidate')
        }
      }

      // For redirects (301, 302, 307, 308) or null bodies, safely construct response
      return new Response(isNullBody ? null : response.body, {
        headers,
        status: response.status,
        statusText: response.statusText,
      })
    } catch (err) {
      console.error('Unhandled Worker error in worker-entry.js:', err)
      return new Response(
        `Application Error (${err instanceof Error ? err.message : 'Unknown'}): Please check server configuration.`,
        {
          status: 500,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        }
      )
    }
  },
  async scheduled(controller, env, ctx) {
    const { runScheduledTasks } = await import('./src/lib/cloudflare-scheduled.ts')
    await runScheduledTasks(controller, env, ctx)
  },
  async queue(batch, env) {
    const { dispatchLearningQueue } = await import('./src/lib/cloudflare-learning-queue.ts')
    const { runConfiguredLearningJob } = await import('./src/features/channel-learning/configured-runner.ts')
    const { handleConversationJobQueue } = await import('./src/lib/cloudflare-conversation-queue.ts')
    await dispatchLearningQueue(batch, {
      runLearning: (msg) => runConfiguredLearningJob(msg, env),
      runConversation: (subBatch) => handleConversationJobQueue(subBatch, env),
    })
  },
}

export default worker
