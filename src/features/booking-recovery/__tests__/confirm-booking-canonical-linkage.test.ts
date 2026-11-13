import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Task 8: confirm_booking_recovery canonical booking_id linkage contract', () => {
  const migrationPath = resolve(
    process.cwd(),
    'supabase/migrations/20261027160000_booking_recovery_confirm_canonical_booking_id.sql'
  );

  it('신규 immutable migration 파일이 존재해야 한다', () => {
    expect(existsSync(migrationPath)).toBe(true);
  });

  it('RPC 정의에 SECURITY DEFINER 및 search_path="" 보안 설정이 포함되어야 한다', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION public.confirm_booking_recovery');
    expect(sql).toContain('SECURITY DEFINER');
    expect(sql).toContain("SET search_path = ''");
  });

  it('marketing_missions 갱신 시 canonical booking_id와 metadata.bookingId를 모두 원자적으로 기록해야 한다', () => {
    const sql = readFileSync(migrationPath, 'utf8');

    // canonical column + metadata compat
    const missionUpdateRegex =
      /UPDATE\s+public\.marketing_missions\s+SET\s+status\s*=\s*'BOOKED',\s*booking_id\s*=\s*v_reservation_id,\s*metadata\s*=\s*jsonb_set\(\s*coalesce\(metadata,\s*'\{\}'::jsonb\),\s*'\{bookingId\}',\s*to_jsonb\(v_reservation_id\)\s*\)/i;

    expect(sql).toMatch(missionUpdateRegex);
  });

  it('service_role 권한 부여 및 public/anon/authenticated 권한 박탈이 엄격히 선언되어야 한다', () => {
    const sql = readFileSync(migrationPath, 'utf8');
    expect(sql).toContain(
      'REVOKE ALL ON FUNCTION public.confirm_booking_recovery(uuid, uuid, int, int, uuid, uuid, text) FROM PUBLIC, anon, authenticated;'
    );
    expect(sql).toContain(
      'GRANT EXECUTE ON FUNCTION public.confirm_booking_recovery(uuid, uuid, int, int, uuid, uuid, text) TO service_role;'
    );
  });

  it('mission-read-model 및 mission-state-machine의 booking_id 소비 계약과 일치해야 한다', () => {
    const readModelSource = readFileSync(
      resolve(process.cwd(), 'src/lib/mission-os/mission-read-model.ts'),
      'utf8'
    );
    const stateMachineSource = readFileSync(
      resolve(process.cwd(), 'src/lib/mission-os/mission-state-machine.ts'),
      'utf8'
    );

    // read-model은 aggregate.booking_id 컬럼을 직접 읽음
    expect(readModelSource).toContain('bookingId: aggregate.booking_id');

    // state-machine은 BOOKED 전이 시 mission.booking_id를 필수로 검증함
    expect(stateMachineSource).toContain('if (!mission.booking_id)');
  });
});
