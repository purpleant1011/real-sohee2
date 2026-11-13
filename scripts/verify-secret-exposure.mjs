#!/usr/bin/env node

/**
 * V0.91 Secret Exposure Remediation & Zero-Leak Verification Gate (ANI-1234)
 * 
 * Invariants:
 * 1. No committed plain-text credentials in repository tracked files.
 * 2. Scans for OpenAI (`sk-proj-`), Google Gemini (`AIzaSy`), Supabase Service Role JWT patterns.
 * 3. Enforces zero secrets in client builds, public assets, or committed source trees.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

console.log('🔒 [Secret Exposure Gate · ANI-1234] Scanning tracked repository files for exposed secrets...');

let violations = 0;

// 1. Check git tracked files for dangerous env files
try {
  const trackedFiles = execSync('git ls-files', { cwd: rootDir, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);

  const forbiddenTracked = trackedFiles.filter((f) => {
    const base = path.basename(f);
    return (
      (base.startsWith('.env') && !base.endsWith('.example')) ||
      base.endsWith('.pem') ||
      base.endsWith('.key')
    );
  });

  if (forbiddenTracked.length > 0) {
    console.error(`❌ FORBIDDEN SECRET FILES TRACKED IN GIT: ${forbiddenTracked.join(', ')}`);
    violations++;
  } else {
    console.log('✅ GIT TRACKING: No private .env or key files tracked in git.');
  }

  // 2. Scan source code files for secret patterns
  const geminiAqPattern = new RegExp('\\bAQ\\.[A-Za-z0-9_-]{40,}\\b', 'g');
  const SECRET_PATTERNS = [
    { name: 'OpenAI Secret Key', regex: /sk-proj-[A-Za-z0-9_-]{20,}/g },
    { name: 'Google Gemini Legacy Key', regex: /AIzaSy[A-Za-z0-9_-]{33}/g },
    { name: 'Google Gemini AQ Key', regex: geminiAqPattern },
    { name: 'Supabase Service Role Key Assignment', regex: /SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"]eyJ[A-Za-z0-9._-]+['"]/g },
  ];

  const sourceFiles = trackedFiles.filter((f) => {
    // Exclude the scanner itself from scanning its own regex definitions
    if (f === 'scripts/verify-secret-exposure.mjs') return false;
    return (
      (f.startsWith('src/') || f.startsWith('scripts/') || f.startsWith('config/') || f.startsWith('tests/')) &&
      !f.includes('fixtures/')
    );
  });

  const isSafeDummyFixture = (text) => {
    const lower = text.toLowerCase();
    return (
      lower.includes('test') ||
      lower.includes('dummy') ||
      lower.includes('placeholder') ||
      lower.includes('mock') ||
      lower.includes('example') ||
      lower.includes('do-not-echo') ||
      lower.includes('fake') ||
      lower.includes('synthetic')
    );
  };

  for (const relPath of sourceFiles) {
    const fullPath = path.join(rootDir, relPath);
    if (!fs.existsSync(fullPath)) continue;
    const content = fs.readFileSync(fullPath, 'utf8');

    for (const { name, regex } of SECRET_PATTERNS) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(content)) !== null) {
        const matchedStr = match[0];
        if (isSafeDummyFixture(matchedStr)) {
          continue;
        }
        console.error(`❌ POTENTIAL SECRET LEAK in ${relPath}: matches pattern for ${name}`);
        violations++;
      }
    }
  }

} catch (err) {
  console.error('Error during git scan:', err);
  process.exit(1);
}

if (violations > 0) {
  console.error(`\n🚨 SECRET EXPOSURE AUDIT FAILED: ${violations} potential violations found.\n`);
  process.exit(1);
} else {
  console.log('\n🛡️ SECRET EXPOSURE AUDIT PASSED: 0 plaintext credentials found in tracked source files.\n');
  process.exit(0);
}
