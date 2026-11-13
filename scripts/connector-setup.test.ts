// @vitest-environment node
import { describe, expect, it } from 'vitest'
import path from 'node:path'

import {
  buildChromeLauncherScript,
  buildHostWrapperScript,
  buildNativeHostManifest,
  linuxManifestDirectories,
  macManifestDirectories,
} from '../connector/native-host/scripts/install.mjs'
import { SOHEE_EXTENSION_ID } from '../connector/shared/extension-id.mjs'
import { runConnectorSetup } from './connector-setup.mjs'

describe('connector setup pure logic', () => {
  it('buildNativeHostManifest generates valid Chrome native-messaging manifest', () => {
    const manifest = buildNativeHostManifest('/opt/sohee/sohee-native-host.sh', SOHEE_EXTENSION_ID)
    expect(manifest).toEqual({
      name: 'kr.ai.sohee.connector',
      description: '소희 게시 로컬 연결기',
      path: '/opt/sohee/sohee-native-host.sh',
      type: 'stdio',
      allowed_origins: [`chrome-extension://${SOHEE_EXTENSION_ID}/`],
    })
  })

  it('buildHostWrapperScript creates executable shell wrapper that invokes node', () => {
    const script = buildHostWrapperScript('/Users/test/connector/native-host/dist/sohee-native-host.cjs')
    expect(script).toContain('#!/bin/sh')
    expect(script).toContain('sohee-native-host.cjs')
    expect(script).toContain('exec "$NODE_EXEC"')
  })

  it('buildChromeLauncherScript generates macOS double-clickable launcher with debug port and dedicated profile', () => {
    const script = buildChromeLauncherScript({
      profileDir: '$HOME/.sohee/chrome-profile',
      targetUrl: 'https://example.com/app/content',
    })
    expect(script).toContain('#!/bin/bash')
    expect(script).toContain('PROFILE_DIR="$HOME/.sohee/chrome-profile"')
    expect(script).toContain('--remote-debugging-port=9229')
    expect(script).toContain('--remote-debugging-address=127.0.0.1')
    expect(script).toContain('--user-data-dir="$PROFILE_DIR"')
    expect(script).toContain('https://example.com/app/content')
  })

  it('macManifestDirectories returns Google Chrome and Chrome for Testing paths', () => {
    const dirs = macManifestDirectories('/Users/test-home')
    expect(dirs[0]).toBe(path.join('/Users/test-home', 'Library/Application Support/Google/Chrome/NativeMessagingHosts'))
    expect(dirs.length).toBeGreaterThanOrEqual(1)
  })

  it('linuxManifestDirectories returns Google Chrome and Chromium config paths', () => {
    const dirs = linuxManifestDirectories('/home/test-user')
    expect(dirs[0]).toBe(path.join('/home/test-user', '.config/google-chrome/NativeMessagingHosts'))
    expect(dirs.length).toBeGreaterThanOrEqual(1)
  })

  it('runConnectorSetup in --dry-run mode reports planned operations without modifying files', async () => {
    const result = await runConnectorSetup({
      dryRun: true,
      homeDir: '/tmp/test-home-dry-run',
      skipBuild: true,
      silent: true,
      skipPlaywrightCheck: true,
    })

    expect(result.ok).toBe(true)
    expect(result.dryRun).toBe(true)
    expect(result.manifest.allowed_origins).toEqual([`chrome-extension://${SOHEE_EXTENSION_ID}/`])
    expect(result.manifest.name).toBe('kr.ai.sohee.connector')
    expect(result.plannedFiles.length).toBeGreaterThan(0)
    expect(result.plannedFiles.some((f: string) => f.endsWith('kr.ai.sohee.connector.json'))).toBe(true)
  })

  it('runConnectorSetup supports cross-platform injection for both darwin and linux', async () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const result = await runConnectorSetup({
        dryRun: true,
        homeDir: '/tmp/test-home-isolated',
        skipBuild: true,
        silent: true,
        platform,
        skipPlaywrightCheck: true,
      })
      expect(result.ok).toBe(true)
      expect(result.plannedFiles.some((f: string) => f.endsWith('kr.ai.sohee.connector.json'))).toBe(true)
    }
  })
})
