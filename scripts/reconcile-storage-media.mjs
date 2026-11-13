#!/usr/bin/env node

/**
 * Storage↔DB Media Reconciliation Script
 * ANI-1115
 */

import { createClient } from '@supabase/supabase-js';
import { reconcileStorageAndDb, MAX_STORAGE_FILE_SIZE_BYTES } from '../qa/11th/audit/storage-reconciliation.ts';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://your-project-ref.supabase.co';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function runReconciliation() {
  console.log('🔍 [Reconcile] Starting Storage↔DB Media Reconciliation...');
  console.log(`📏 [Config] Max file size limit: ${MAX_STORAGE_FILE_SIZE_BYTES} bytes (10MB)`);

  if (!SUPABASE_SERVICE_KEY) {
    console.warn('⚠️ [Reconcile] SUPABASE_SERVICE_ROLE_KEY missing. Running in local dry simulation mode.');
    return;
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // Fetch all media_assets
  const { data: dbRows, error: dbError } = await supabase
    .from('media_assets')
    .select('id, workspace_id, object_path, size_bytes, sha256_digest');

  if (dbError) {
    console.error('❌ [Reconcile] DB Query failed:', dbError);
    process.exit(1);
  }

  // Fetch storage objects from storage.objects directly to avoid non-recursive SDK limits
  const { data: storageObjects, error: storageError } = await supabase
    .schema('storage')
    .from('objects')
    .select('name, metadata')
    .eq('bucket_id', 'content-media');

  if (storageError) {
    console.error('❌ [Reconcile] Storage Query failed:', storageError);
    process.exit(1);
  }

  const formattedStorage = (storageObjects || []).map((o) => ({
    name: o.name,
    size_bytes: o.metadata?.size || 0,
    sha256_digest: null,
  }));

  const report = reconcileStorageAndDb(dbRows || [], formattedStorage);

  console.log('\n======================================================');
  console.log('📊 RECONCILIATION AUDIT SUMMARY');
  console.log('======================================================');
  console.log(`- Matched Healthy Objects: ${report.matched_count}`);
  console.log(`- Missing Storage Files (Row-Only): ${report.row_only_missing_files.length}`);
  console.log(`- Orphan Storage Files (Object-Only): ${report.object_only_orphans.length}`);
  console.log(`- Digest Mismatches: ${report.digest_mismatches.length}`);
  console.log(`- Cross-Workspace Path Leaks: ${report.cross_workspace_leaks.length}`);
  console.log(`- Oversized (> 10MB) Files: ${report.oversized_files.length}`);
  console.log(`- Overall Status: ${report.is_reconciled ? '✅ CLEAN' : '🟡 ANOMALIES DETECTED'}\n`);
}

runReconciliation().catch((err) => {
  console.error('Unhandled reconciliation error:', err);
});
