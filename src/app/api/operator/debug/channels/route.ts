export const dynamic = 'force-dynamic';
import { NextResponse } from 'next/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

export async function GET() {
  try {
    const admin = createAdminSupabaseClient();
    
    const { data: conns } = await (admin as any).from('channel_connections').select('*');
    const { data: txs } = await (admin as any).from('oauth_transactions').select('*').order('created_at', { ascending: false }).limit(10);
    const { data: workspaces } = await (admin as any).from('workspaces').select('id, name, created_at');

    return NextResponse.json({
      success: true,
      workspaces,
      connections: conns,
      transactions: txs
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
