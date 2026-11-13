import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { evaluateChannelSpec } from '@/features/vault/channel-spec';
import type { SpecEvaluationResult } from '@/features/vault/channel-spec/types';
import { SpecCheckPanel } from './spec-check-panel';

describe('SpecCheckPanel', () => {
  describe('요약 및 보관 가능 여부 (role="status")', () => {
    it('FAIL 항목이 있으면 "고쳐야 할 게 N개 있어요" 요약을 렌더링한다', () => {
      const mockResult: SpecEvaluationResult = {
        specVersion: '2026.10.1',
        blocksVault: true,
        checks: [
          {
            id: 'instagram-carousel-max',
            label: '캐러셀 최대 이미지 장수',
            status: 'FAIL',
            evidence: 'OFFICIAL_DOC',
            detail: '미디어 항목 수: 11개 (최대 허용: 10개)',
            userMessage: '인스타그램 캐러셀은 최대 10장까지 등록할 수 있어요. 현재 11장이 등록되어 수정이 필요해요.',
          },
        ],
      };

      render(<SpecCheckPanel result={mockResult} />);

      const statusElement = screen.getByRole('status');
      expect(statusElement).toHaveTextContent('고쳐야 할 게 1개 있어요');
      expect(screen.getByText('사진을 10장 이하로 줄여 주세요')).toBeInTheDocument();
      // 영문 rule id가 노출되지 않아야 함
      expect(screen.queryByText('instagram-carousel-max')).not.toBeInTheDocument();
      // 영문 상태 코드가 노출되지 않아야 함
      expect(screen.queryByText('FAIL')).not.toBeInTheDocument();
    });

    it('모두 PASS이거나 통과 가능한 경우 "보관할 수 있어요" 요약을 렌더링한다', () => {
      const mockResult: SpecEvaluationResult = {
        specVersion: '2026.10.1',
        blocksVault: false,
        checks: [
          {
            id: 'threads-text-length',
            label: '포스트 본문 최대 글자 수',
            status: 'PASS',
            evidence: 'OFFICIAL_DOC',
            detail: '본문 120자',
            userMessage: '본문 길이가 스레드 기준을 만족해요.',
          },
        ],
      };

      render(<SpecCheckPanel result={mockResult} initialExpanded={true} />);

      const statusElement = screen.getByRole('status');
      expect(statusElement).toHaveTextContent('보관할 수 있어요');
      expect(screen.getByText('통과')).toBeInTheDocument();
      expect(screen.queryByText('PASS')).not.toBeInTheDocument();
    });
  });

  describe('근거 라벨 및 안내 문구', () => {
    it('근거 유형을 사용자 친화적 문구("공식 문서 기준", "소희 기본 설정", "확인이 필요해요")로 표시한다', () => {
      const mockResult: SpecEvaluationResult = {
        specVersion: '2026.10.1',
        blocksVault: false,
        checks: [
          {
            id: 'threads-text-length',
            label: '스레드 본문 글자 수',
            status: 'PASS',
            evidence: 'OFFICIAL_DOC',
            detail: '100자',
            userMessage: '정상',
          },
          {
            id: 'naver-blog-title-required',
            label: '네이버 블로그 제목 필수',
            status: 'PASS',
            evidence: 'CONFIG',
            detail: '제목 있음',
            userMessage: '정상',
          },
          {
            id: 'daangn-text-length',
            label: '당근 권장 본문 길이',
            status: 'WARN',
            evidence: 'UNVERIFIED',
            detail: '2100자',
            userMessage: '주의',
          },
        ],
      };

      render(<SpecCheckPanel result={mockResult} initialExpanded={true} />);

      expect(screen.getByText('공식 문서 기준')).toBeInTheDocument();
      expect(screen.getByText('소희 기본 설정')).toBeInTheDocument();
      expect(screen.getByText('확인이 필요해요')).toBeInTheDocument();

      // 영문 evidence 코드가 노출되지 않아야 함
      expect(screen.queryByText('OFFICIAL_DOC')).not.toBeInTheDocument();
      expect(screen.queryByText('CONFIG')).not.toBeInTheDocument();
      expect(screen.queryByText('UNVERIFIED')).not.toBeInTheDocument();
    });

    it('UNVERIFIED 또는 UNKNOWN 항목이 있을 때 보관을 막지 않는다는 안내를 제공한다', () => {
      const mockResult: SpecEvaluationResult = {
        specVersion: '2026.10.1',
        blocksVault: false,
        checks: [
          {
            id: 'daangn-gallery-display',
            label: '갤러리 노출 안내',
            status: 'PASS',
            evidence: 'UNVERIFIED',
            detail: '안내',
            userMessage: '안내 문구',
          },
        ],
      };

      render(<SpecCheckPanel result={mockResult} initialExpanded={true} />);

      expect(
        screen.getByText('확인이 필요하거나 미검증된 항목은 보관을 막지 않아요')
      ).toBeInTheDocument();
    });
  });

  describe('해결 행동(resolution action) 및 출처 링크', () => {
    it('FAIL 항목에 대해 해결 행동 문구를 렌더링하고 매핑 없는 id는 일반 문구로 대체한다', () => {
      const mockResult: SpecEvaluationResult = {
        specVersion: '2026.10.1',
        blocksVault: true,
        checks: [
          {
            id: 'naver-blog-title-required',
            label: '블로그 포스트 제목 필수',
            status: 'FAIL',
            evidence: 'CONFIG',
            detail: '제목 없음',
            userMessage: '네이버 블로그 포스트는 제목이 필수입니다.',
          },
          {
            id: 'custom-unknown-rule',
            label: '임의의 사용자 정의 규칙',
            status: 'FAIL',
            evidence: 'UNVERIFIED',
            detail: '세부 사유',
            userMessage: '수정이 필요합니다.',
          },
        ],
      };

      render(<SpecCheckPanel result={mockResult} />);

      expect(screen.getByText('제목을 입력해 주세요')).toBeInTheDocument();
      expect(
        screen.getByText('해당 항목의 안내를 확인하고 내용을 수정한 뒤 다시 시도해 주세요')
      ).toBeInTheDocument();
      expect(screen.queryByText('naver-blog-title-required')).not.toBeInTheDocument();
      expect(screen.queryByText('custom-unknown-rule')).not.toBeInTheDocument();
    });

    it('출처 URL이 존재할 때 URL 원문 노출 없이 "근거 보기" 접근성 링크로만 제공한다', () => {
      const mockResult: SpecEvaluationResult = {
        specVersion: '2026.10.1',
        blocksVault: false,
        checks: [
          {
            id: 'instagram-caption-length',
            label: '캡션 최대 글자 수',
            status: 'PASS',
            evidence: 'OFFICIAL_DOC',
            detail: '500자',
            userMessage: '통과',
          },
        ],
      };

      render(<SpecCheckPanel result={mockResult} initialExpanded={true} />);

      const sourceLink = screen.getByRole('link', { name: /근거 보기/i });
      expect(sourceLink).toBeInTheDocument();
      expect(sourceLink).toHaveAttribute('target', '_blank');
      expect(sourceLink).toHaveAttribute('rel', 'noopener noreferrer');

      // URL 원문 문자열이 텍스트로 화면에 노출되지 않는지 확인
      expect(screen.queryByText(/https:\/\/developers\.facebook\.com/i)).not.toBeInTheDocument();
    });
  });

  describe('접기/펼치기 인터랙션 및 목록 시맨틱', () => {
    it('접기/펼치기 토글 버튼으로 항목 목록 표시 여부를 전환하고 aria-expanded를 갱신한다', () => {
      const mockResult: SpecEvaluationResult = {
        specVersion: '2026.10.1',
        blocksVault: false,
        checks: [
          {
            id: 'threads-text-length',
            label: '포스트 본문 최대 글자 수',
            status: 'PASS',
            evidence: 'OFFICIAL_DOC',
            detail: '100자',
            userMessage: '정상',
          },
        ],
      };

      // PASS인 경우 기본 접힘 상태
      render(<SpecCheckPanel result={mockResult} initialExpanded={false} />);

      const toggleButton = screen.getByRole('button', { name: /검사 항목 펼치기|상세 보기/i });
      expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('list')).not.toBeInTheDocument();

      fireEvent.click(toggleButton);

      expect(toggleButton).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('list')).toBeInTheDocument();
      expect(screen.getByText('포스트 본문 최대 글자 수')).toBeInTheDocument();

      fireEvent.click(toggleButton);
      expect(toggleButton).toHaveAttribute('aria-expanded', 'false');
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });
  });

  describe('4채널 대표 evaluateChannelSpec 실제 결과 테스트', () => {
    it('1) Instagram 경계값 FAIL (캐러셀 11장) 렌더링', () => {
      const evalResult = evaluateChannelSpec('instagram', {
        media: Array.from({ length: 11 }, (_, i) => ({
          id: `img-${i}`,
          type: 'image',
          format: 'jpeg',
        })),
      });

      render(<SpecCheckPanel result={evalResult} channel="instagram" />);

      expect(screen.getByRole('status')).toHaveTextContent('고쳐야 할 게 1개 있어요');
      expect(screen.getByText('사진을 10장 이하로 줄여 주세요')).toBeInTheDocument();
      expect(screen.getByText('수정 필요')).toBeInTheDocument();
    });

    it('2) Naver Blog - UNVERIFIED 권장 항목만 있는 경우 보관 가능 렌더링', () => {
      const evalResult = evaluateChannelSpec('naver_blog', {
        title: '멋진 블로그 포스트 제목입니다',
        text: '본문 내용입니다. 충분히 작성되었습니다.',
        media: [{ id: 'img-1', type: 'image', format: 'jpeg' }],
      });

      render(<SpecCheckPanel result={evalResult} channel="naver_blog" initialExpanded={true} />);

      expect(screen.getByRole('status')).toHaveTextContent('보관할 수 있어요');
      expect(
        screen.getByText('확인이 필요하거나 미검증된 항목은 보관을 막지 않아요')
      ).toBeInTheDocument();
      expect(screen.getAllByText('확인이 필요해요').length).toBeGreaterThan(0);
    });

    it('3) Threads - 모두 PASS인 경우 렌더링', () => {
      const evalResult = evaluateChannelSpec('threads', {
        text: '스레드 테스트 포스트 본문입니다.',
        media: [
          { id: 'img-1', type: 'image', format: 'jpeg', fileSizeBytes: 1024 * 1024 },
          { id: 'img-2', type: 'image', format: 'jpeg', fileSizeBytes: 1024 * 1024 },
        ],
      });

      render(<SpecCheckPanel result={evalResult} channel="threads" initialExpanded={true} />);

      expect(screen.getByRole('status')).toHaveTextContent('보관할 수 있어요');
      expect(screen.getAllByText('통과').length).toBeGreaterThan(0);
      expect(screen.getAllByText('공식 문서 기준').length).toBeGreaterThan(0);
    });

    it('4) Naver Blog - 제목 필수 누락 시 FAIL 및 해결 행동 렌더링', () => {
      const evalResult = evaluateChannelSpec('naver_blog', {
        title: '',
        text: '본문 내용입니다.',
        media: [{ id: 'img-1', type: 'image', format: 'jpeg' }],
      });

      render(<SpecCheckPanel result={evalResult} channel="naver_blog" />);

      expect(screen.getByRole('status')).toHaveTextContent('고쳐야 할 게 1개 있어요');
      expect(screen.getByText('제목을 입력해 주세요')).toBeInTheDocument();
      expect(screen.getByText('수정 필요')).toBeInTheDocument();
    });

    it('5) Daangn - 모든 항목 UNVERIFIED 및 권장 초과(WARN) 시 보관 가능 안내 렌더링', () => {
      const evalResult = evaluateChannelSpec('daangn_business', {
        text: '당근 비즈프로필 소식입니다.',
        media: [
          { id: 'v1', type: 'video' },
          { id: 'v2', type: 'video' },
        ],
      });

      render(<SpecCheckPanel result={evalResult} channel="daangn_business" initialExpanded={true} />);

      // UNVERIFIED 및 WARN은 보관을 막지 않음
      expect(screen.getByRole('status')).toHaveTextContent('보관할 수 있어요');
      expect(screen.getByText('주의')).toBeInTheDocument();
      expect(
        screen.getByText('확인이 필요하거나 미검증된 항목은 보관을 막지 않아요')
      ).toBeInTheDocument();
    });
  });
});
