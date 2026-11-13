import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { RecoveryCard } from '@/features/booking-recovery/components/recovery-card';
import { AvailabilityForm } from '@/features/booking-recovery/components/availability-form';
import { RecoveryView, RecoveryCommand } from '@/features/booking-recovery/contracts';

const sampleView: RecoveryView = {
  caseId: '11111111-1111-4111-8111-111111111111',
  missionId: '22222222-2222-4222-8222-222222222222',
  version: 1,
  stage: 'DRAFT_READY',
  statusLabel: '답변 초안 준비 완료',
  sourceThreadId: '33333333-3333-4333-8333-333333333333',
  sourceInboundMessageId: '44444444-4444-4444-8444-444444444444',
  observedAt: new Date().toISOString(),
  reply: {
    text: '안녕하세요 고객님! 문의주신 맞춤 펌 시술 예약 가능한 시간은 내일 오후 2시입니다. 예약금은 30,000원입니다. 이 시간으로 예약 진행해 드릴까요?',
    fingerprint: 'a'.repeat(64),
  },
  offer: {
    slotId: '77777777-7777-4777-8777-777777777777',
    serviceId: '66666666-6666-4666-8666-666666666666',
    serviceName: '맞춤 펌 시술',
    startsAt: new Date(Date.now() + 86400000).toISOString(),
    endsAt: new Date(Date.now() + 93600000).toISOString(),
    timezone: 'Asia/Seoul',
    totalAmountKrw: 120000,
    depositKrw: 30000,
    validUntil: new Date(Date.now() + 900000).toISOString(),
    proposalRevision: 1,
  },
  acceptance: null,
  approval: {
    kind: 'send',
    fingerprint: 'a'.repeat(64),
  },
  booking: null,
  nextAction: 'approve_send',
  revenue: {
    status: 'NOT_OBSERVED',
    amountKrw: null,
  },
};

function FixtureApp() {
  const [currentView, setCurrentView] = useState<RecoveryView>(sampleView);
  const [commandLog, setCommandLog] = useState<string[]>([]);

  const handleCommand = async (cmd: RecoveryCommand) => {
    setCommandLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${JSON.stringify(cmd)}`]);

    if (cmd.kind === 'approve_send') {
      setCurrentView((prev) => ({
        ...prev,
        stage: 'AWAITING_CUSTOMER',
        statusLabel: '고객 응답 대기',
        nextAction: 'confirm_acceptance',
        version: prev.version + 1,
        approval: null,
      }));
    } else if (cmd.kind === 'approve_booking') {
      setCurrentView((prev) => ({
        ...prev,
        stage: 'BOOKING_CONFIRMED',
        statusLabel: '예약 확정 완료',
        nextAction: null,
        version: prev.version + 1,
        booking: {
          id: 'bk_demo_12345',
          confirmedAt: new Date().toISOString(),
        },
        approval: null,
      }));
    }
  };

  const simulateCustomerAcceptance = () => {
    setCurrentView((prev) => ({
      ...prev,
      stage: 'CUSTOMER_ACCEPTED',
      statusLabel: '고객 예약 수락',
      nextAction: 'approve_booking',
      version: prev.version + 1,
      acceptance: {
        inboundMessageId: '88888888-8888-4888-8888-888888888888',
        receivedAt: new Date().toISOString(),
      },
      approval: {
        kind: 'booking',
        fingerprint: 'b'.repeat(64),
      },
    }));
  };

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <header className="border-b pb-4">
        <h1 className="text-xl font-bold">소희 예약 문의 회수 런타임 UI 검증 하네스</h1>
        <p className="text-sm text-zinc-500 mt-1">
          컴포넌트 단위 로컬 QA 픽스처 (독립 Vite 구동)
        </p>
      </header>

      {/* Control Panel */}
      <section className="bg-white dark:bg-zinc-900 p-4 rounded-xl border border-zinc-200 dark:border-zinc-800 space-y-2">
        <h2 className="text-sm font-semibold">시나리오 상태 시뮬레이터</h2>
        <div className="flex flex-wrap gap-2 pt-2">
          <button
            onClick={() => setCurrentView(sampleView)}
            className="px-3 py-1.5 text-xs rounded-lg bg-zinc-200 dark:bg-zinc-800 font-medium"
          >
            1. 답변 초안 (DRAFT_READY)
          </button>
          <button
            onClick={simulateCustomerAcceptance}
            className="px-3 py-1.5 text-xs rounded-lg bg-blue-100 text-blue-800 font-medium"
          >
            2. 고객 수락 시뮬레이션 (CUSTOMER_ACCEPTED)
          </button>
          <button
            onClick={() =>
              setCurrentView((prev) => ({
                ...prev,
                stage: 'RESULT_UNKNOWN',
                statusLabel: '전송 결과 확인 필요',
                nextAction: 'review',
                approval: null,
              }))
            }
            className="px-3 py-1.5 text-xs rounded-lg bg-rose-100 text-rose-800 font-medium"
          >
            3. 불확실 전송 (RESULT_UNKNOWN)
          </button>
        </div>
      </section>

      {/* Main Card Render */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-zinc-600 dark:text-zinc-400">
          실제 렌더링 카드 (RecoveryCard)
        </h2>
        <div className="max-w-md mx-auto">
          <RecoveryCard view={currentView} onCommand={handleCommand} />
        </div>
      </section>

      {/* Command Audit Log */}
      <section className="bg-zinc-950 text-zinc-200 p-4 rounded-xl text-xs font-mono space-y-1">
        <div className="font-bold text-zinc-400 mb-2">실행된 명령 로그 (Audit Log):</div>
        {commandLog.length === 0 ? (
          <div className="text-zinc-600">아직 실행된 명령이 없습니다.</div>
        ) : (
          commandLog.map((log, i) => <div key={i}>{log}</div>)
        )}
      </section>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<FixtureApp />);
