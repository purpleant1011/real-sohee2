import { describe, expect, it, vi } from 'vitest';
import { getInstagramDirectMessageReadback, type MetaFetch } from './meta-api';

const payload = { id: 'mid-1', message: '승인한 그대로', created_time: '2026-10-20T10:00:00Z',
  from: { id: 'business-1' }, to: { data: [{ id: 'customer-1' }] } };
function readback(body: unknown, status = 200) {
  const fetcher = vi.fn<MetaFetch>().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  return getInstagramDirectMessageReadback({ messageId: 'mid-1', accessToken: 'fixture-token', fetcher });
}

describe('Instagram DM independent participant readback', () => {
  it('공식 from/to 상세 필드를 원문·ID와 함께 반환', async () => {
    expect(await readback(payload)).toMatchObject({ isLive: true, messageId: 'mid-1',
      text: payload.message, senderId: 'business-1', recipientId: 'customer-1', timestamp: payload.created_time });
  });

  it.each([{ from: null }, { to: null }, { to: { data: [] } },
    { to: { data: [{ id: 'one' }, { id: 'two' }] } }, { message: null },
    { created_time: 'invalid' }, { id: 'other-mid' }])('필수 증거 없으면 isLive로 승격하지 않음: %j', async (patch) => {
    expect((await readback({ ...payload, ...patch })).isLive).toBe(false);
  });

  it('공급자 오류에 포함된 토큰·원문을 반환하지 않음', async () => {
    const result = await readback({ error: { message: 'fixture-token customer-private-message' } }, 400);
    expect(result.isLive).toBe(false);
    expect(JSON.stringify(result)).not.toContain('fixture-token');
    expect(JSON.stringify(result)).not.toContain('customer-private-message');
  });
});
