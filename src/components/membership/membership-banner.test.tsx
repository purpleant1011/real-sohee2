import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MembershipBanner } from './membership-banner';

describe('MembershipBanner', () => {
  it('체험회원(TRIAL)일 때 첫 포스팅 2건 무료 안내 및 사업자 등록 링크를 렌더링한다', () => {
    render(<MembershipBanner tier="TRIAL" />);

    const banner = screen.getByRole('status');
    expect(banner).toBeDefined();
    expect(
      screen.getByText(/1곳 이상 연결하면 첫 포스팅을 무료로 체험해 보세요/i)
    ).toBeDefined();
    expect(
      screen.getByText(/승인 시 혜택이 추가 지급돼요/i)
    ).toBeDefined();
    expect(screen.queryByText(/크레딧/)).toBeNull();

    const link = screen.getByRole('link', { name: /사업자 정보 등록하기/i });
    expect(link.getAttribute('href')).toBe('/start');
  });

  it('심사중(PENDING_REVIEW)일 때 심사 중 안내를 렌더링하고 등록 링크는 숨긴다', () => {
    render(<MembershipBanner tier="PENDING_REVIEW" />);

    const banner = screen.getByRole('status');
    expect(banner).toBeDefined();
    expect(
      screen.getByText(/사업자 인증 심사 중이에요/i)
    ).toBeDefined();
    expect(screen.queryByText(/크레딧/)).toBeNull();
    expect(screen.queryByRole('link', { name: /사업자 정보 등록하기/i })).toBeNull();
  });

  it('정식회원(FORMAL)일 때 배너를 렌더링하지 않는다', () => {
    const { container } = render(<MembershipBanner tier="FORMAL" />);
    expect(container.firstChild).toBeNull();
  });
});
