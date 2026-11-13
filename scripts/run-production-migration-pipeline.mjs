import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.join(ROOT_DIR, 'supabase/migrations');

// 18 migrations to bring Production from 20260903060000 to 20260907060000
const files = fs.readdirSync(MIGRATIONS_DIR)
  .filter(f => f.endsWith('.sql') && f.slice(0, 14) >= '20260903070000' && f.slice(0, 14) <= '20260907060000')
  .sort();

const TARGET_MIGRATIONS = files.map(f => ({
  version: f.slice(0, 14),
  file: f,
  name: f.slice(15, -4),
}));

function runEgoBrowserSql(sql, waitMs = 5000, maxRetries = 2) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const runnerScript = `
const task = await useOrCreateTaskSpace("supabase-mig-pipeline");
try {
  await openOrReuseTab("https://supabase.com/dashboard/project/your-project-ref/sql/new", { wait: true, timeout: 25 });
  await wait(3);

  const targetSql = ${JSON.stringify(sql)};
  await js(\`(() => {
    if (window.monaco && window.monaco.editor && window.monaco.editor.getModels().length > 0) {
      window.monaco.editor.getModels()[0].setValue(\${JSON.stringify(targetSql)});
    }
  })()\`);
  await wait(1);

  await js(\`(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const runBtn = btns.find(b => b.textContent && b.textContent.trim().startsWith("Run"));
    if (runBtn) runBtn.click();
  })()\`);
  await wait(${Math.max(4, Math.floor(waitMs / 1000))});

  const res = await js(\`(() => {
    const errEl = Array.from(document.querySelectorAll('*')).find(el => 
      el.children.length === 0 && el.textContent.includes('Failed to run sql query')
    );
    const grid = document.querySelector('[role="grid"], .sb-grid, [data-testid="sql-results"]');
    const hasSuccess = document.body.innerText.includes('Success. No rows returned');
    return {
      isError: !!errEl,
      errorMsg: errEl ? errEl.textContent : null,
      grid: grid ? grid.innerText : (hasSuccess ? 'Success. No rows returned' : null),
      sample: document.body.innerText.slice(0, 1000)
    };
  })()\`);

  cliLog("EVAL_JSON:" + JSON.stringify(res));
} finally {
  await completeTaskSpace(task.id, { keep: false });
}
`;

    const tmpPath = '/tmp/ego_run_mig.js';
    fs.writeFileSync(tmpPath, runnerScript, 'utf8');

    try {
      const rawOut = execSync(`ego-browser nodejs < ${tmpPath} 2>&1`, {
        encoding: 'utf8',
        timeout: waitMs + 45000,
      });

      const idx = rawOut.indexOf('EVAL_JSON:');
      if (idx === -1) {
        if (attempt < maxRetries) {
          console.warn(`[runEgoBrowserSql] Attempt ${attempt} could not parse EVAL_JSON, retrying in 3s...`);
          execSync('sleep 3');
          continue;
        }
        return { success: false, error: 'Could not parse EVAL_JSON', raw: rawOut };
      }
      const jsonStr = rawOut.slice(idx + 'EVAL_JSON:'.length).trim();
      try {
        const result = JSON.parse(jsonStr);
        if (result.isError) {
          return { success: false, error: result.errorMsg || 'SQL query error reported in UI', details: result.sample };
        }
        return { success: true, grid: result.grid };
      } catch (parseErr) {
        return { success: false, error: 'JSON.parse failed: ' + parseErr.message, rawJson: jsonStr.slice(-100) };
      }
    } catch (err) {
      if (attempt < maxRetries) {
        console.warn(`[runEgoBrowserSql] Attempt ${attempt} failed (${err.message}), retrying in 3s...`);
        execSync('sleep 3');
        continue;
      }
      return { success: false, error: err.message };
    }
  }
}

async function main() {
  console.log('================================================================');
  console.log('🚀 Supabase Production Migration Pipeline (8th Revision Wave 0)');
  console.log('================================================================\n');

  console.log(`Total target migrations to evaluate: ${TARGET_MIGRATIONS.length}`);

  // 1. Fetch current schema_migrations
  console.log('1. Fetching applied target migrations from Supabase Production...');
  const checkSql = `SELECT version FROM supabase_migrations.schema_migrations WHERE version >= '20260903070000' ORDER BY version;`;
  const checkRes = runEgoBrowserSql(checkSql);
  if (!checkRes.success) {
    console.error('❌ Failed to check schema_migrations:', checkRes.error);
    process.exit(1);
  }
  
  const appliedVersions = new Set();
  if (checkRes.grid) {
    const lines = checkRes.grid.split('\n').map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (/^\d{14}$/.test(line)) {
        appliedVersions.add(line);
      }
    }
  }
  console.log(`Already applied migrations count: ${appliedVersions.size}`);
  console.log('Applied versions in range:', Array.from(appliedVersions).filter(v => v >= '20260903060000').sort());

  // 2. Filter pending migrations
  const pending = TARGET_MIGRATIONS.filter(m => !appliedVersions.has(m.version));
  console.log(`\nPending migrations to apply: ${pending.length} of ${TARGET_MIGRATIONS.length}`);

  for (let idx = 0; idx < pending.length; idx++) {
    const mig = pending[idx];
    console.log(`\n----------------------------------------------------------------`);
    console.log(`[${idx + 1}/${pending.length}] Applying: ${mig.version} - ${mig.name}`);
    console.log(`----------------------------------------------------------------`);

    const migFilePath = path.join(MIGRATIONS_DIR, mig.file);
    if (!fs.existsSync(migFilePath)) {
      console.error(`❌ Migration file not found: ${migFilePath}`);
      process.exit(1);
    }

    const sqlContent = fs.readFileSync(migFilePath, 'utf8');
    console.log(`Reading ${mig.file} (${sqlContent.length} bytes)...`);

    // Wrap in BEGIN/COMMIT transaction with ledger recording
    const transactionalSql = `
BEGIN;

${sqlContent}

INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('${mig.version}', '${mig.name}', ARRAY[]::text[])
ON CONFLICT (version) DO NOTHING;

COMMIT;
`;

    console.log(`Executing migration + ledger record for ${mig.version}...`);
    const execRes = runEgoBrowserSql(transactionalSql, 10000);
    if (!execRes.success) {
      console.error(`❌ Migration execution failed for ${mig.file}!`);
      console.error('Error:', execRes.error);
      console.error('Details:', execRes.details);
      process.exit(1);
    }
    console.log(`✔ Version ${mig.version} (${mig.name}) applied and recorded into ledger!`);
  }

  // 3. Final verification of schema_migrations
  console.log(`\n================================================================`);
  console.log(`3. Final Production Migration Ledger Verification`);
  console.log(`================================================================`);
  const finalCheckSql = `SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 20;`;
  const finalRes = runEgoBrowserSql(finalCheckSql);
  console.log('Latest Migration Ledger Rows:\n', finalRes.grid);

  console.log('\n🎉 Production Migration Pipeline Completed Successfully!\n');
}

main().catch(err => {
  console.error('Unhandled pipeline error:', err);
  process.exit(1);
});
