import 'server-only';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';

export type PendingBusinessStatus =
  | 'PENDING'
  | 'DOCUMENT_REQUIRED'
  | 'MISMATCH'
  | 'UNVERIFIED'
  | 'NOT_SUBMITTED';

export interface PendingBusinessWorkspace {
  workspaceId: string;
  workspaceName: string;
  status: PendingBusinessStatus;
  companyName: string | null;
  businessNumber: string | null;
  representativeName: string | null;
  hasDocument: boolean;
  createdAt: string;
  updatedAt: string | null;
}

export function pendingBusinessStatusLabel(status: PendingBusinessStatus): string {
  switch (status) {
    case 'PENDING':
      return '심사 대기';
    case 'DOCUMENT_REQUIRED':
      return '서류 보완 필요';
    case 'MISMATCH':
      return '정보 불일치';
    case 'UNVERIFIED':
      return '미인증';
    case 'NOT_SUBMITTED':
      return '체험회원 (미제출)';
    default:
      return '심사 대기';
  }
}

export async function getPendingBusinessVerifications(): Promise<{
  data: PendingBusinessWorkspace[];
  error: string | null;
}> {
  try {
    const admin = createAdminSupabaseClient() as unknown as { from(table: string): any };

    // 1. business_verifications 중 VERIFIED가 아닌 항목 조회
    const { data: bvs, error: bvErr } = await admin
      .from('business_verifications')
      .select('workspace_id, status, company_name, business_number, representative_name, updated_at, document_url')
      .neq('status', 'VERIFIED')
      .order('updated_at', { ascending: false })
      .limit(50);

    if (bvErr) {
      return { data: [], error: bvErr.message };
    }

    // 2. 전체 워크스페이스 조회 (이름 매핑 및 미제출 체험회원 추출)
    const { data: workspaces, error: wsErr } = await admin
      .from('workspaces')
      .select('id, name, created_at')
      .order('created_at', { ascending: false })
      .limit(50);

    if (wsErr) {
      return { data: [], error: wsErr.message };
    }

    const wsMap = new Map<string, { id: string; name: string; created_at: string }>();
    workspaces?.forEach((ws: any) => {
      wsMap.set(ws.id, ws);
    });

    const result: PendingBusinessWorkspace[] = [];

    // 1) business_verifications가 있지만 VERIFIED가 아닌 워크스페이스
    bvs?.forEach((bv: any) => {
      const ws = wsMap.get(bv.workspace_id);
      result.push({
        workspaceId: bv.workspace_id,
        workspaceName: ws?.name || bv.company_name || '이름 미정',
        status: (bv.status as PendingBusinessStatus) || 'PENDING',
        companyName: bv.company_name || null,
        businessNumber: bv.business_number || null,
        representativeName: bv.representative_name || null,
        hasDocument: Boolean(bv.document_url),
        createdAt: ws?.created_at || bv.updated_at || new Date().toISOString(),
        updatedAt: bv.updated_at || null,
      });
    });

    // 2) business_verifications가 아예 존재하지 않는 워크스페이스 (제출 전 체험회원)
    const { data: allBvs } = await admin
      .from('business_verifications')
      .select('workspace_id');

    const knownBvWsIds = new Set((allBvs || []).map((b: any) => b.workspace_id));

    workspaces?.forEach((ws: any) => {
      if (!knownBvWsIds.has(ws.id)) {
        result.push({
          workspaceId: ws.id,
          workspaceName: ws.name || '신규 가입',
          status: 'NOT_SUBMITTED',
          companyName: null,
          businessNumber: null,
          representativeName: null,
          hasDocument: false,
          createdAt: ws.created_at,
          updatedAt: null,
        });
      }
    });

    // 최신 등록순 정렬
    result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return { data: result, error: null };
  } catch (err: any) {
    return { data: [], error: err?.message || '알 수 없는 오류' };
  }
}
