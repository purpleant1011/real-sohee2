import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { literal, query } from '../vault/pg-client';
import { createProductionBookingRecoveryService } from '@/features/booking-recovery/production';
import { BookingRecoveryRepository } from '@/features/booking-recovery/repository';
import { BookingRecoveryService } from '@/features/booking-recovery/service';
import { RecoveryActor } from '@/features/booking-recovery/contracts';
import { projectInboundMessageToRecovery } from '@/features/booking-recovery/inbound-projector';
import { ingestDmMessage } from '@/features/engagement/dm/ingest';
import { approvalFingerprint, bookingApprovalFingerprint } from '@/features/booking-recovery/approval-binding';

describe('Booking Recovery Vertical End-to-End & Hardening Integration (PostgreSQL 16)', () => {
  const envBackup = { ...process.env };

  // Helper to build a pg-backed Supabase client adapter for the isolated PostgreSQL cluster
  function createPgSupabaseClient() {
    return {
      rpc: async (name: string, args: Record<string, unknown>) => {
        try {
          const argKeys = Object.keys(args);
          const paramList = argKeys
            .map((k) => {
              const val = args[k];
              if (val === null || val === undefined) return `${k} => null`;
              if (typeof val === 'number') return `${k} => ${val}`;
              if (typeof val === 'boolean') return `${k} => ${val ? 'true' : 'false'}`;
              return `${k} => '${String(val).replaceAll("'", "''")}'`;
            })
            .join(', ');

          const sql = `select public.${name}(${paramList}) as res`;
          const rows = query<any>(sql);
          if (!rows || rows.length === 0) {
            return { data: null, error: null };
          }
          return { data: rows[0].res, error: null };
        } catch (err: any) {
          console.error('[createPgSupabaseClient.rpc error]', name, args, err?.message || err);
          const msg = err?.message || String(err);
          let code = 'RPC_ERROR';
          if (msg.includes('42501') || msg.includes('FORBIDDEN')) code = '42501';
          if (msg.includes('40001') || msg.includes('VERSION_CONFLICT') || msg.includes('SLOT_')) code = '40001';
          if (msg.includes('P0002') || msg.includes('NOT_FOUND')) code = 'P0002';
          return { data: null, error: { message: msg, code } };
        }
      },
      from: (table: string) => {
        let whereClauses: string[] = [];
        let orderClause = '';
        let limitClause = '';

        const builder: any = {
          select: () => builder,
          eq: (col: string, val: any) => {
            if (col.includes('->>')) {
              const [jsonCol, key] = col.split('->>');
              whereClauses.push(`("${jsonCol}"->>'${key}') = '${String(val).replaceAll("'", "''")}'`);
            } else {
              whereClauses.push(`"${col}" = '${String(val).replaceAll("'", "''")}'`);
            }
            return builder;
          },
          gt: (col: string, val: any) => {
            whereClauses.push(`"${col}" > '${String(val).replaceAll("'", "''")}'`);
            return builder;
          },
          lte: (col: string, val: any) => {
            whereClauses.push(`"${col}" <= '${String(val).replaceAll("'", "''")}'`);
            return builder;
          },
          in: (col: string, vals: any[]) => {
            const list = vals.map((v) => `'${String(v).replaceAll("'", "''")}'`).join(', ');
            whereClauses.push(`"${col}" in (${list})`);
            return builder;
          },
          order: (col: string, opts?: { ascending?: boolean }) => {
            orderClause += `${orderClause ? ', ' : 'order by '}"${col}" ${opts?.ascending ? 'asc' : 'desc'}`;
            return builder;
          },
          limit: (n: number) => {
            limitClause = `limit ${n}`;
            return builder;
          },
          then: (resolve: any, reject?: any) => {
            try {
              const where = whereClauses.length > 0 ? `where ${whereClauses.join(' and ')}` : '';
              const sql = `select * from public.${table} ${where} ${orderClause} ${limitClause}`;
              const rows = query<any>(sql);
              resolve({ data: rows, error: null });
            } catch (err: any) {
              if (reject) reject(err);
              else resolve({ data: null, error: { message: err?.message || String(err) } });
            }
          },
          maybeSingle: async () => {
            const where = whereClauses.length > 0 ? `where ${whereClauses.join(' and ')}` : '';
            const sql = `select * from public.${table} ${where} ${orderClause} limit 1`;
            const rows = query<any>(sql);
            return { data: rows[0] || null, error: null };
          },
          single: async () => {
            const where = whereClauses.length > 0 ? `where ${whereClauses.join(' and ')}` : '';
            const sql = `select * from public.${table} ${where} ${orderClause} limit 1`;
            const rows = query<any>(sql);
            if (!rows || rows.length === 0) {
              return { data: null, error: { message: 'Row not found', code: 'P0002' } };
            }
            return { data: rows[0], error: null };
          },
          insert: (row: Record<string, unknown>) => {
            const cols = Object.keys(row).map((c) => `"${c}"`).join(', ');
            // `literal` JSON-encodes object/array values, matching supabase-js, which
            // JSON.stringify's the request body. String(obj) produced '[object Object]'
            // and made jsonb inserts fail with "invalid input syntax for type json".
            const vals = Object.values(row).map((v) => literal(v)).join(', ');
            const sql = `with ins as (insert into public.${table} (${cols}) values (${vals}) returning *) select '{"data":' || coalesce(json_agg(ins)::text, '[]') || '}' from ins;`;
            const execute = () => {
              const rows = query<any>(sql);
              return rows[0] || null;
            };

            const insertBuilder: any = {
              select: () => ({
                single: async () => ({ data: execute(), error: null }),
                maybeSingle: async () => ({ data: execute(), error: null }),
              }),
              then: (resolve: any) => resolve({ data: execute(), error: null }),
            };
            return insertBuilder;
          },
          update: (fields: Record<string, unknown>) => {
            const makeBuilder = () => {
              const b: any = {
                eq: (col: string, val: any) => {
                  if (col.includes('->>')) {
                    const [jsonCol, key] = col.split('->>');
                    whereClauses.push(`("${jsonCol}"->>'${key}') = '${String(val).replaceAll("'", "''")}'`);
                  } else {
                    whereClauses.push(`"${col}" = '${String(val).replaceAll("'", "''")}'`);
                  }
                  return b;
                },
                select: () => ({
                  single: async () => {
                    const sets = Object.entries(fields)
                      .map(([k, v]) => `"${k}" = ${literal(v)}`)
                      .join(', ');
                    const where = whereClauses.length > 0 ? `where ${whereClauses.join(' and ')}` : '';
                    const sql = `with written as (update public.${table} set ${sets} ${where} returning *) select '{"data":' || coalesce(json_agg(written)::text, '[]') || '}' from written`;
                    const rows = query<any>(sql);
                    return { data: rows[0] || null, error: null };
                  },
                  maybeSingle: async () => {
                    const sets = Object.entries(fields)
                      .map(([k, v]) => `"${k}" = ${literal(v)}`)
                      .join(', ');
                    const where = whereClauses.length > 0 ? `where ${whereClauses.join(' and ')}` : '';
                    const sql = `with written as (update public.${table} set ${sets} ${where} returning *) select '{"data":' || coalesce(json_agg(written)::text, '[]') || '}' from written`;
                    const rows = query<any>(sql);
                    return { data: rows[0] || null, error: null };
                  },
                }),
                then: async (resolve: any) => {
                  const sets = Object.entries(fields)
                    .map(([k, v]) => `"${k}" = ${literal(v)}`)
                    .join(', ');
                  const where = whereClauses.length > 0 ? `where ${whereClauses.join(' and ')}` : '';
                  const sql = `with written as (update public.${table} set ${sets} ${where} returning *) select '{"data":' || coalesce(json_agg(written)::text, '[]') || '}' from written`;
                  const rows = query<any>(sql);
                  resolve({ data: rows[0] || null, error: null });
                },
              };
              return b;
            };
            return makeBuilder();
          },
          upsert: async (row: Record<string, unknown>, opts?: { onConflict?: string }) => {
            const cols = Object.keys(row).map((c) => `"${c}"`).join(', ');
            const vals = Object.values(row).map((v) => literal(v)).join(', ');
            const conflictCols = opts?.onConflict || 'id';
            const conflictTargets = conflictCols.split(',').map((c) => `"${c.trim()}"`).join(', ');
            const updates = Object.keys(row)
              .filter((c) => !opts?.onConflict?.includes(c))
              .map((c) => `"${c}" = excluded."${c}"`)
              .join(', ');
            const onConflictClause = updates.length > 0
              ? `on conflict (${conflictTargets}) do update set ${updates}`
              : `on conflict (${conflictTargets}) do nothing`;
            const sql = `insert into public.${table} (${cols}) values (${vals}) ${onConflictClause} returning *`;
            const rows = query<any>(sql);
            return { data: rows[0] || null, error: null };
          },
        };
        return builder;
      },
    } as any;
  }

  function setupTestWorkspace() {
    const wsId = randomUUID();
    const ownerId = randomUUID();
    const customerRef = 'cust_e2e_real';
    const channelConnId = randomUUID();
    const threadId = randomUUID();
    const inboundMsgId = randomUUID();
    const serviceId = randomUUID();
    const slotId = randomUUID();

    const externalAccountId = 'ig_acc_' + randomUUID().replaceAll('-', '');

    // 1. Auth & Workspace
    query(`insert into auth.users (id) values ('${ownerId}')`);
    query(`insert into public.workspaces (id, name, created_by) values ('${wsId}', '소희 헤어샵 E2E', '${ownerId}')`);
    query(`insert into public.workspace_members (workspace_id, user_id, role, status)
      values ('${wsId}', '${ownerId}', 'owner', 'active')
      on conflict (workspace_id, user_id) do update set role = excluded.role, status = excluded.status`);

    // 2. Channel & Thread & Inbound Message
    query(`insert into public.channel_connections (id, workspace_id, channel, status, external_account_id)
      values ('${channelConnId}', '${wsId}', 'instagram', 'connected', '${externalAccountId}')`);

    query(`insert into public.instagram_dm_threads (id, workspace_id, channel_connection_id, provider_thread_id, customer_id, customer_handle, last_message_at, expires_at, status, last_message_text)
      values ('${threadId}', '${wsId}', '${channelConnId}', '${externalAccountId}:${customerRef}', '${customerRef}', 'minji_customer', now(), now() + interval '24 hours', 'NEEDS_REPLY', '내일 오후 2시 예약 가능한가요?')`);

    query(`insert into public.instagram_dm_messages (id, workspace_id, thread_id, provider_message_id, sender_type, sender_id, text, sent_at)
      values ('${inboundMsgId}', '${wsId}', '${threadId}', 'mid_e2e_inbound_1', 'customer', '${customerRef}', '내일 오후 2시 예약 가능한가요?', now() - interval '5 minutes')`);

    // 3. Service Catalog & Slot
    // duration_minutes is part of the catalog contract (ANI-1609): the 60-minute slot below must cover it.
    query(`insert into public.workspace_products_services (id, workspace_id, name, price, active, duration_minutes)
      values ('${serviceId}', '${wsId}', '시그니처 커트 & 헤드스파', 120000, true, 60)`);

    const catalogVersion = query<{ updated_at: string }>(`select updated_at from public.workspace_products_services where id = '${serviceId}'`)[0].updated_at;
    // Slots must be minute-aligned: acceptance-temporal-binding.ts:74 rejects a slot whose
    // Asia/Seoul second is not 0, so a Date.now()-derived slot with arbitrary seconds can never
    // match a customer acceptance. Real appointment slots start on the minute.
    const minuteAligned = (ms: number) => new Date(Math.floor(ms / 60000) * 60000).toISOString();
    const slotStart = minuteAligned(Date.now() + 24 * 3600 * 1000);
    const slotEnd = minuteAligned(Date.now() + 25 * 3600 * 1000);
    const validUntil = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    query(`insert into public.booking_recovery_slots (id, workspace_id, service_id, starts_at, ends_at, timezone, deposit_krw, catalog_version, confirmed_by, confirmed_at, valid_until, status, version)
      values ('${slotId}', '${wsId}', '${serviceId}', '${slotStart}', '${slotEnd}', 'Asia/Seoul', 30000, '${catalogVersion}', '${ownerId}', now(), '${validUntil}', 'AVAILABLE', 1)`);

    const actor: RecoveryActor = {
      workspaceId: wsId,
      userId: ownerId,
      role: 'owner',
    };

    return {
      wsId,
      ownerId,
      customerRef,
      channelConnId,
      threadId,
      inboundMsgId,
      serviceId,
      slotId,
      slotStart,
      slotEnd,
      validUntil,
      actor,
      externalAccountId,
    };
  }

  // Explicit W4 receipt contract fixture, not a claim that the legacy adapter emits v2 proof.
  function recordDeliveryFixture(
    f: ReturnType<typeof setupTestWorkspace>, caseId: string, fingerprint: string,
    providerMessageId: string, observedAt: string
  ) {
    const proof = JSON.stringify({
      schemaVersion: 1, channel: 'instagram', providerMessageId, payloadFingerprint: fingerprint,
      senderId: f.externalAccountId, recipientRef: f.customerRef,
      requestedAt: new Date(Date.parse(observedAt) - 1000).toISOString(), observedAt,
    }).replaceAll("'", "''");
    query(`insert into public.booking_recovery_steps
      (workspace_id, case_id, kind, status, input_fingerprint, idempotency_key, actor_id, provider_message_id, evidence_ref, occurred_at)
      values ('${f.wsId}', '${caseId}', 'RECONCILE_VERIFIED', 'COMPLETED', '${fingerprint}',
        'receipt-fixture:${randomUUID()}', '${f.ownerId}', '${providerMessageId}', '${proof}', now())`);
  }

  beforeEach(() => {
    process.env.BOOKING_RECOVERY_ENABLED = 'true';
    process.env.BOOKING_RECOVERY_WORKSPACE_ALLOWLIST = '*';
    process.env.ENGAGEMENT_SEND_ENABLED = '1';
    process.env.ENGAGEMENT_WORKSPACE_ALLOWLIST = '*';
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  it('실제 PG에서 open -> prepare -> approve_send -> 독립 readback -> 실제 ingest -> acceptance -> approve_booking 전과정 수직 완결', async () => {
    const f = setupTestWorkspace();
    const client = createPgSupabaseClient();

    // Provider transport mocks (I/O ONLY, real credentials passed from DB)
    const providerSendMock = vi.fn().mockResolvedValue({ providerMessageId: 'prov_mid_meta_live_777' });
    // Independent readback must echo the delivered message. dm-adapter.ts:508-511 only accepts a
    // live readback whose messageId/text/recipientId/senderId/observedAt all match the send and the
    // approved reply; an `{ isLive: true }` stub can never satisfy that tuple (23a3bea2).
    const readbackMock = vi.fn(async () => {
      const sent = providerSendMock.mock.calls.at(-1)?.[0] as { pageId: string; recipientId: string; text: string };
      return {
        isLive: true,
        messageId: 'prov_mid_meta_live_777',
        text: sent.text,
        senderId: sent.pageId,
        recipientId: sent.recipientId,
        observedAt: new Date().toISOString(),
      };
    });

    // Initialize production service wired to isolated PG
    const service = createProductionBookingRecoveryService(client, {
      sendProviderDm: providerSendMock,
      readbackFetcher: readbackMock,
      getChannelCredential: async () => ({
        accessToken: 'real_production_meta_token',
        externalAccountId: f.externalAccountId,
        grantedScopes: ['instagram_manage_messages'],
      }),
      evaluateAdmission: async () => ({ admitted: true, message: 'admitted' }),
    });

    // 1. Open Case
    const openRes = await service.openCase(f.actor, f.inboundMsgId);
    if (!openRes.ok) {
      console.error('OPEN CASE ERROR DETAILED:', openRes);
    }
    expect(openRes.ok).toBe(true);
    if (!openRes.ok) return;

    const caseId = openRes.value.caseId;
    expect(openRes.value.stage).toBe('DISCOVERED');
    expect(openRes.value.version).toBe(1);

    // Verify Marketing Mission lineage
    const missionRows = query<any>(`select * from public.marketing_missions where id = '${openRes.value.missionId}'`);
    expect(missionRows).toHaveLength(1);
    expect(missionRows[0].workspace_id).toBe(f.wsId);

    // 2. Prepare Reply Proposal
    const prepareRes = await service.prepareReply(f.actor, {
      caseId,
      expectedVersion: 1,
      slotId: f.slotId,
    });
    if (!prepareRes.ok) {
      console.error('PREPARE RES ERROR:', prepareRes);
    }
    expect(prepareRes.ok).toBe(true);
    if (!prepareRes.ok) return;

    expect(prepareRes.value.stage).toBe('DRAFT_READY');
    expect(prepareRes.value.version).toBe(2);
    expect(prepareRes.value.offer).not.toBeNull();
    expect(prepareRes.value.offer?.slotId).toBe(f.slotId);
    expect(prepareRes.value.offer?.totalAmountKrw).toBe(120000);
    expect(prepareRes.value.offer?.depositKrw).toBe(30000);

    const proposalFp = prepareRes.value.reply!.fingerprint;

    // Verify durable proposal snapshot in PG
    const proposalRows = query<any>(`select * from public.booking_recovery_proposals where case_id = '${caseId}' and revision = 1`);
    expect(proposalRows).toHaveLength(1);
    expect(proposalRows[0].payload_fingerprint).toBe(proposalFp);

    // 3. Owner Approve Send
    const sendRes = await service.approveSend(f.actor, {
      caseId,
      expectedVersion: 2,
      fingerprint: proposalFp,
    });
    expect(sendRes.ok).toBe(true);
    if (!sendRes.ok) return;

    // Verify provider transport received ACTUAL credentials, NOT fake literals
    expect(providerSendMock).toHaveBeenCalledTimes(1);
    expect(providerSendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pageId: f.externalAccountId,
        accessToken: 'real_production_meta_token',
        recipientId: f.customerRef,
      })
    );

    // Verify independent readback verification occurred
    expect(readbackMock).toHaveBeenCalledTimes(1);
    expect(readbackMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 'prov_mid_meta_live_777',
        accessToken: 'real_production_meta_token',
      })
    );

    // Verify durable transitions: SEND_REQUESTED -> PROVIDER_ACCEPTED -> SEND_VERIFIED -> AWAITING_CUSTOMER
    expect(sendRes.value.stage).toBe('AWAITING_CUSTOMER');

    // Negative guard: before any verified customer acceptance exists, confirmation must be refused and
    // write nothing. approveBooking checks accepted_inbound_message_id first (service.ts:812), so the
    // fingerprint value is irrelevant here.
    const preAcceptanceBooking = await service.approveBooking(f.actor, {
      caseId, expectedVersion: sendRes.value.version, fingerprint: proposalFp,
    });
    expect(preAcceptanceBooking).toMatchObject({ ok: false, code: 'CONTEXT_REQUIRED' });
    expect(query(`select id from public.reservations where workspace_id = '${f.wsId}'`)).toHaveLength(0);

    // 4. Customer Inbound Acceptance Ingest via ingestDmMessage + Projector Hook
    const customerAcceptanceMsgId = randomUUID();
    const acceptanceSentAt = new Date().toISOString();

    const mockDmRepo = {
      findThreadByProviderThreadId: async () => {
        const rows = query<any>(`select * from public.instagram_dm_threads where id = '${f.threadId}'`);
        return rows[0] || null;
      },
      upsertThread: async (thread: any) => thread,
      insertMessageIfAbsent: async (msg: any) => {
        query(`insert into public.instagram_dm_messages (id, workspace_id, thread_id, provider_message_id, sender_type, sender_id, text, sent_at)
          values ('${msg.provider_message_id}', '${msg.workspace_id}', '${msg.thread_id}', '${msg.provider_message_id}', '${msg.sender_type}', '${msg.sender_id}', '${msg.text}', '${msg.sent_at}')
          on conflict do nothing`);
        return { inserted: true };
      },
      listMessages: async () => {
        return query<any>(`select * from public.instagram_dm_messages where thread_id = '${f.threadId}' order by sent_at asc`);
      },
    };

    // Actual ingest call with projector hook
    await ingestDmMessage(
      {
        workspaceId: f.wsId,
        channelConnectionId: f.channelConnId,
        businessIgId: 'ig_acc_real_999',
        mid: customerAcceptanceMsgId,
        fromId: f.customerRef,
        toId: 'ig_acc_real_999',
        // Phrasing must stay inside the bounded acceptance grammar in
        // acceptance-temporal-binding.ts:61 ('예약해 주세요' is supported; '예약 진행해 주세요' is not,
        // and is intentionally treated as needs_review rather than guessed).
        text: '네 그 시간으로 예약해 주세요!',
        createdAt: acceptanceSentAt,
      },
      mockDmRepo as any,
      new Date(),
      async ({ workspaceId, threadId, message }) => {
        await projectInboundMessageToRecovery(client, {
          workspaceId,
          threadId,
          message: {
            id: message.id,
            sender_type: message.sender_type,
            sender_id: message.sender_id,
            text: message.text,
            sent_at: message.sent_at,
          },
        });
      }
    );

    // Verify case transitioned to CUSTOMER_ACCEPTED in PG
    const caseAfterAccept = query<any>(`select * from public.booking_recovery_cases where id = '${caseId}'`);
    expect(caseAfterAccept[0].stage).toBe('CUSTOMER_ACCEPTED');
    expect(caseAfterAccept[0].accepted_inbound_message_id).toBe(customerAcceptanceMsgId);

    // 5. Owner Approve Booking (Commits confirmed reservation spine atomically)
    const activeRepo = new BookingRecoveryRepository(client);
    const activeProposal = (await activeRepo.getLatestProposal(f.wsId, caseId))!;

    const bookingFp = bookingApprovalFingerprint({
      workspaceId: f.wsId,
      caseId,
      slotId: f.slotId,
      serviceId: f.serviceId,
      totalAmountKrw: 120000,
      depositKrw: 30000,
      customerRef: f.customerRef,
      acceptedMessageId: customerAcceptanceMsgId,
      proposalRevision: 1,
      catalogVersion: activeProposal.catalog_version,
      slotVersion: 1,
    });

    // The send already recorded a verified SEND_DM_VERIFIED receipt (dm-adapter.ts:519), so the
    // pre-fixture "no evidence yet" refusal is no longer reproducible at this point; that guard is
    // asserted above, before acceptance. This keeps exercising the reconcile-evidence path.
    recordDeliveryFixture(f, caseId, proposalFp, 'prov_mid_meta_live_777',
      new Date(Date.parse(acceptanceSentAt) - 1).toISOString());

    const bookRes = await service.approveBooking(f.actor, {
      caseId,
      expectedVersion: caseAfterAccept[0].version,
      fingerprint: bookingFp,
    });
    if (!bookRes.ok) {
      console.error('BOOK RES ERROR DETAILED:', bookRes);
    }

    expect(bookRes.ok).toBe(true);
    if (!bookRes.ok) return;

    expect(bookRes.value.stage).toBe('BOOKING_CONFIRMED');
    expect(bookRes.value.booking).not.toBeNull();
    const reservationId = bookRes.value.booking!.id;
    expect(reservationId).toMatch(/^bk_/);

    // 6. Detailed Assertions on PG Database State (Zero-Synthetic Proof)
    // 6.1 Reservation Spine Table
    const reservationRows = query<any>(`select * from public.reservations where id = '${reservationId}'`);
    expect(reservationRows).toHaveLength(1);
    expect(reservationRows[0].workspace_id).toBe(f.wsId);
    expect(reservationRows[0].slot_id).toBe(f.slotId);
    expect(reservationRows[0].status).toBe('CONFIRMED');
    expect(reservationRows[0].total_amount_krw).toBe(120000);
    expect(reservationRows[0].deposit_krw).toBe(30000);
    expect(reservationRows[0].customer_id).toBe(f.customerRef);
    expect(reservationRows[0].proof_id).toBe(customerAcceptanceMsgId);

    // 6.2 Slot Status Updated to BOOKED
    const slotRows = query<any>(`select * from public.booking_recovery_slots where id = '${f.slotId}'`);
    expect(slotRows[0].status).toBe('BOOKED');

    // 6.3 Marketing Mission Updated to BOOKED & Lineage Preserved
    const finalMissions = query<any>(`select * from public.marketing_missions where id = '${openRes.value.missionId}'`);
    expect(finalMissions[0].status).toBe('BOOKED');
    expect(finalMissions[0].metadata.bookingId).toBe(reservationId);

    // 6.4 Durable Approval Consumed
    const approvalRows = query<any>(`select * from public.booking_recovery_approvals where case_id = '${caseId}' and step_kind = 'BOOK'`);
    expect(approvalRows[0].consumed_at).not.toBeNull();

    // 6.5 Exactly ONE confirmed reservation exists for this case (No duplication)
    const countRes = query<{ n: number }>(`select count(*)::int as n from public.reservations where (metadata->>'caseId') = '${caseId}'`);
    expect(countRes[0].n).toBe(1);

    // 7. Idempotent Confirmation Replay: Re-calling approveBooking returns identical booking without error
    const replayRes = await service.approveBooking(f.actor, {
      caseId,
      expectedVersion: bookRes.value.version,
      fingerprint: bookingFp,
    });
    if (!replayRes.ok) {
      console.error('REPLAY RES ERROR DETAILED:', replayRes);
    }
    expect(replayRes.ok).toBe(true);
    if (replayRes.ok) {
      expect(replayRes.value.booking?.id).toBe(reservationId);
      expect(replayRes.value.stage).toBe('BOOKING_CONFIRMED');
    }
  });

  it('20분 후 고객 수락 시 슬롯 장부 재확인(fresh attestation, revision 2)을 통해 정상 확정된다', async () => {
    const f = setupTestWorkspace();
    const client = createPgSupabaseClient();

    const providerSendMock = vi.fn().mockResolvedValue({ providerMessageId: 'prov_mid_meta_live_888' });
    // Same strict tuple as the first scenario (dm-adapter.ts:508-511): the readback must echo the send.
    const readbackMock = vi.fn(async () => {
      const sent = providerSendMock.mock.calls.at(-1)?.[0] as { pageId: string; recipientId: string; text: string };
      return {
        isLive: true,
        messageId: 'prov_mid_meta_live_888',
        text: sent.text,
        senderId: sent.pageId,
        recipientId: sent.recipientId,
        observedAt: new Date().toISOString(),
      };
    });

    const service = createProductionBookingRecoveryService(client, {
      sendProviderDm: providerSendMock,
      readbackFetcher: readbackMock,
      getChannelCredential: async () => ({
        accessToken: 'real_production_meta_token',
        externalAccountId: f.externalAccountId,
        grantedScopes: ['instagram_manage_messages'],
      }),
      evaluateAdmission: async () => ({ admitted: true, message: 'admitted' }),
    });

    // 1. Open Case
    const openRes = await service.openCase(f.actor, f.inboundMsgId);
    if (!openRes.ok) {
      console.error('OPEN CASE ERROR DETAILED:', openRes);
    }
    expect(openRes.ok).toBe(true);
    if (!openRes.ok) return;
    const caseId = openRes.value.caseId;

    // 2. Prepare Proposal Revision 1 (valid_until = 15 minutes)
    const prep1 = await service.prepareReply(f.actor, { caseId, expectedVersion: 1, slotId: f.slotId });
    expect(prep1.ok).toBe(true);
    if (!prep1.ok) return;

    // 3. Approve Send
    await service.approveSend(f.actor, {
      caseId,
      expectedVersion: 2,
      fingerprint: prep1.value.reply!.fingerprint,
    });

    // 4. Simulate 20 minutes elapsed:
    // Proposal 1 was sent 20 minutes ago
    query(`update public.booking_recovery_proposals set created_at = now() - interval '20 minutes' where case_id = '${caseId}' and revision = 1`);

    // Slot 1 valid_until was 15 minutes TTL, so it expired 5 minutes ago
    query(`update public.booking_recovery_slots set valid_until = now() - interval '5 minutes' where id = '${f.slotId}'`);

    // Customer accepts after 20 minutes (sent_at is 2 minutes ago, which is after proposal 1 creation 20 minutes ago)
    const acceptMsgId = randomUUID();
    query(`insert into public.instagram_dm_messages (id, workspace_id, thread_id, provider_message_id, sender_type, sender_id, text, sent_at)
      values ('${acceptMsgId}', '${f.wsId}', '${f.threadId}', 'mid_20min_accept', 'customer', '${f.customerRef}', '네 그 시간으로 예약할게요!', now() - interval '2 minutes')`);

    // Ingest acceptance to case
    const caseAfterSend = query<any>(`select * from public.booking_recovery_cases where id = '${caseId}'`);
    const legacyAcceptance = await service.confirmAcceptance(f.actor, {
      caseId, expectedVersion: caseAfterSend[0].version, inboundMessageId: acceptMsgId, slotId: f.slotId,
    });
    expect(legacyAcceptance).toMatchObject({ ok: false, code: 'CONTEXT_REQUIRED' });
    recordDeliveryFixture(f, caseId, prep1.value.reply!.fingerprint, 'prov_mid_meta_live_888',
      new Date(Date.now() - 19 * 60 * 1000).toISOString());
    const accepted = await service.confirmAcceptance(f.actor, {
      caseId, expectedVersion: caseAfterSend[0].version, inboundMessageId: acceptMsgId, slotId: f.slotId,
    });
    expect(accepted.ok).toBe(true);

    // 5. Owner reconfirms slot in ledger via reattestSchedule command (fresh attestation)
    const caseBeforeReattest = query<any>(`select * from public.booking_recovery_cases where id = '${caseId}'`);
    const reattestRes = await service.reattestSchedule(f.actor, {
      caseId,
      expectedVersion: caseBeforeReattest[0].version,
      slotId: f.slotId,
    });
    expect(reattestRes.ok).toBe(true);
    if (!reattestRes.ok) return;

    expect(reattestRes.value.stage).toBe('AWAITING_BOOKING_APPROVAL');
    expect(reattestRes.value.offer?.proposalRevision).toBe(2);
    expect(reattestRes.value.acceptance?.inboundMessageId).toBe(acceptMsgId);

    // 6. Final Booking approval using the fresh fingerprint from reattestSchedule
    const confirmRes = await service.approveBooking(f.actor, {
      caseId,
      expectedVersion: reattestRes.value.version,
      fingerprint: reattestRes.value.approval!.fingerprint,
    });
    if (!confirmRes.ok) {
      console.error('CONFIRM RES 2 ERROR DETAILED:', confirmRes);
    }

    expect(confirmRes.ok).toBe(true);
    if (!confirmRes.ok) return;

    expect(confirmRes.value.stage).toBe('BOOKING_CONFIRMED');
    expect(confirmRes.value.booking?.id).toMatch(/^bk_/);
    const confirmedBookingId = confirmRes.value.booking!.id;

    // 7. Restart-After-Confirm Resumption Test (New service instance, dock reopen / page refresh)
    const freshClient = createPgSupabaseClient();
    const freshService = createProductionBookingRecoveryService(freshClient);

    const resumedView = await freshService.getCaseView(f.wsId, caseId);
    expect(resumedView).not.toBeNull();
    expect(resumedView?.stage).toBe('BOOKING_CONFIRMED');
    expect(resumedView?.booking?.id).toBe(confirmedBookingId);
    expect(resumedView?.booking?.status).toBe('CONFIRMED');
    expect(resumedView?.acceptance?.inboundMessageId).toBe(acceptMsgId);

    // List view verification
    const listViews = await freshService.listCaseViews(f.wsId);
    const listedCase = listViews.find((v) => v.caseId === caseId);
    expect(listedCase?.booking?.id).toBe(confirmedBookingId);
    expect(listedCase?.booking?.status).toBe('CONFIRMED');
  });
});
