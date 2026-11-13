import fs from 'fs';
import { execSync } from 'child_process';

const script = `
const p = await openTab('https://example.com/app/channels');
await sleep(4000);

const channelsInfo = await p.evaluate(() => {
  return {
    title: document.title,
    h2: document.querySelector('h2')?.innerText,
    hasInstagram: document.body.innerText.includes('인스타그램'),
    hasNaverBlog: document.body.innerText.includes('네이버 블로그'),
    hasButtons: document.body.innerText.includes('계정 설정') || document.body.innerText.includes('계정 연동하기'),
    bodySnippet: document.body.innerText.slice(0, 350)
  };
});
console.log('--- CHANNELS VERIFICATION ---');
console.log(JSON.stringify(channelsInfo, null, 2));

await p.close();
`;

fs.writeFileSync('/tmp/aside_script.js', script, 'utf8');
const out = execSync('~/.local/bin/aside repl "$(< /tmp/aside_script.js)"', { encoding: 'utf8', shell: '/bin/bash' });
console.log(out);
