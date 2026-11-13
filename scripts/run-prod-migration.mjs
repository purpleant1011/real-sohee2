import fs from 'fs';
import { execSync } from 'child_process';

const sqlPath = '/Volumes/Development/Github/real-sohee/supabase/migrations/20260903020000_v089_production_truth_recovery.sql';
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

const runSuccess = await p.evaluate(() => {
  const btns = Array.from(document.querySelectorAll('button'));
  const runBtn = btns.find(b => b.innerText && b.innerText.includes('Run'));
  if (runBtn) {
    runBtn.click();
    return true;
  }
  return false;
});

console.log('Run button clicked:', runSuccess);
await sleep(6000);

const output = await p.evaluate(() => {
  const statusEl = document.querySelector('[data-state=\"success\"], .text-foreground-light, [role=\"region\"]');
  return {
    statusText: statusEl ? statusEl.innerText : '',
    bodySnippet: document.body.innerText.slice(0, 1500)
  };
});

console.log('Execution Status:', output.statusText);
console.log('Snippet:\\n', output.bodySnippet.slice(0, 500));
await p.close();
`;

fs.writeFileSync('/tmp/aside_run_migration.js', script, 'utf8');
const out = execSync('~/.local/bin/aside repl "$(< /tmp/aside_run_migration.js)"', { encoding: 'utf8' });
console.log(out);
