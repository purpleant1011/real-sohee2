import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ManagerCockpitBriefing } from '@/components/v087/cockpit/ManagerCockpitBriefing';
import { getRevenueCommandReadModel } from '@/lib/read-models/revenue-command-read-model';

describe('unobserved revenue consumer rendering', () => {
  it('renders the missing source state without measured zeroes, sync time or revenue cards', () => {
    const data = getRevenueCommandReadModel('00000000-0000-4000-8000-0000000000a2', true);
    const html = renderToStaticMarkup(<ManagerCockpitBriefing data={data} />);
    expect(html).toContain('미관측');
    expect(html).toContain('예약·매출 원장이 연결되지 않아');
    expect(html).not.toMatch(/이번 주 가동률|확정 예약\(P0\)|0건|실측 시각|네이버 예약 원장 실시간 동기화/);
  });
});
