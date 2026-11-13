import fs from 'fs';
import { execSync } from 'child_process';

const script = `
const p = await openTab('https://example.com/signup');
await sleep(4500);

const signupInfo = await p.evaluate(() => {
  return {
    title: document.title,
    h1: document.querySelector('h1')?.innerText,
    hasStep1: document.body.innerText.includes('본인 인증') || document.body.innerText.includes('Google'),
    hasStep2: document.body.innerText.includes('사업자 정보') || document.body.innerText.includes('사업자등록번호'),
    bodySnippet: document.body.innerText.slice(0, 350)
  };
});
console.log('--- SIGNUP VERIFICATION ---');
console.log(JSON.stringify(signupInfo, null, 2));

const p2 = await openTab('https://example.com/pricing');
await sleep(3500);
const pricingInfo = await p2.evaluate(() => {
  return {
    title: document.title,
    hasStarter: document.body.innerText.includes('스타터') || document.body.innerText.includes('150,000'),
    hasGrowth: document.body.innerText.includes('그로스') || document.body.innerText.includes('300,000')
  };
});
console.log('--- PRICING VERIFICATION ---');
console.log(JSON.stringify(pricingInfo, null, 2));

await p.close();
await p2.close();
`;

fs.writeFileSync('/tmp/aside_verify_live.js', script, 'utf8');
const out = execSync('~/.local/bin/aside repl "$(< /tmp/aside_verify_live.js)"', { encoding: 'utf8', shell: '/bin/bash' });
console.log(out);
