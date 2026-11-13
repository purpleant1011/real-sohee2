import fs from 'fs';
import { execSync } from 'child_process';

const sqlPath = '/Volumes/Development/Github/real-sohee/supabase/migrations/20260903030000_trial_journey_milestones.sql';
const sql = fs.readFileSync(sqlPath, 'utf8');
const escapedSql = JSON.stringify(sql);

const script = `
const p = await openTab('https://supabase.com/dashboard/project/your-project-ref/sql/new');
await sleep(4500);

const targetSql = ${escapedSql};

await p.evaluate((s) => {
  const monaco = window.monaco;
  if (monaco && monaco.editor.getModels().length > 0) {
    monaco.editor.getModels()[0].setValue(s);
  }
}, targetSql);
await sleep(1500);

await p.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  const runBtn = btns.find(b => b.innerText && b.innerText.includes('Run'));
  if (runBtn) runBtn.click();
});
await sleep(4000);
console.log('Trial journey milestones SQL executed successfully!');
await p.close();
`;

fs.writeFileSync('/tmp/aside_run_milestone.js', script, 'utf8');
const out = execSync('~/.local/bin/aside repl "$(< /tmp/aside_run_milestone.js)"', { encoding: 'utf8', shell: '/bin/bash' });
console.log(out);
