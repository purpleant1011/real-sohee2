import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { OutlookFolderSelector, type OutlookFolder } from './outlook-folder-selector';

describe('OutlookFolderSelector Component (MC/O02 - ANI-2168)', () => {
  const workspaceId = 'ws-test-outlook-123';
  const mockFolders: OutlookFolder[] = [
    { id: 'inbox', displayName: '받은편지함', totalItemCount: 120, unreadItemCount: 3 },
    { id: 'business', displayName: '업무 관련', totalItemCount: 45, unreadItemCount: 0 },
    { id: 'orders', displayName: '발주/주문', totalItemCount: 15, unreadItemCount: 1 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders folder choices, period selection, and consent checkbox', () => {
    render(
      <OutlookFolderSelector
        workspaceId={workspaceId}
        initialFolders={mockFolders}
      />
    );

    expect(screen.getByText(/Outlook 업무 폴더 연동/i)).toBeInTheDocument();
    expect(screen.getByText('받은편지함')).toBeInTheDocument();
    expect(screen.getByText('업무 관련')).toBeInTheDocument();
    expect(screen.getByText('발주/주문')).toBeInTheDocument();

    expect(screen.getByText(/동기화 기간/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /소희 업무 지원 활용에 동의/i })).toBeInTheDocument();

    const saveButton = screen.getByRole('button', { name: /선택한 폴더 연동 시작/i });
    expect(saveButton).not.toBeDisabled();
  });

  it('allows selecting a different folder', () => {
    const handleSave = vi.fn();
    render(
      <OutlookFolderSelector
        workspaceId={workspaceId}
        initialFolders={mockFolders}
        onSave={handleSave}
      />
    );

    const businessFolderBtn = screen.getByRole('button', { name: /업무 관련/i });
    fireEvent.click(businessFolderBtn);

    const saveButton = screen.getByRole('button', { name: /선택한 폴더 연동 시작/i });
    fireEvent.click(saveButton);

    expect(handleSave).toHaveBeenCalledWith(
      expect.objectContaining({
        folderId: 'business',
        folderName: '업무 관련',
      }),
      true
    );
  });

  it('allows changing the sync period', () => {
    const handleSave = vi.fn();
    render(
      <OutlookFolderSelector
        workspaceId={workspaceId}
        initialFolders={mockFolders}
        onSave={handleSave}
      />
    );

    const period7dBtn = screen.getByRole('button', { name: /최근 7일/i });
    fireEvent.click(period7dBtn);

    const saveButton = screen.getByRole('button', { name: /선택한 폴더 연동 시작/i });
    fireEvent.click(saveButton);

    expect(handleSave).toHaveBeenCalledWith(
      expect.objectContaining({
        folderId: 'inbox',
        period: '7d',
      }),
      true
    );
  });

  it('disables save button when consent checkbox is unchecked', () => {
    render(
      <OutlookFolderSelector
        workspaceId={workspaceId}
        initialFolders={mockFolders}
      />
    );

    const checkbox = screen.getByRole('checkbox', { name: /소희 업무 지원 활용에 동의/i });
    expect(checkbox).toBeChecked();

    fireEvent.click(checkbox);
    expect(checkbox).not.toBeChecked();

    const saveButton = screen.getByRole('button', { name: /선택한 폴더 연동 시작/i });
    expect(saveButton).toBeDisabled();
  });

  it('invokes onCancel when cancel button is clicked', () => {
    const handleCancel = vi.fn();
    render(
      <OutlookFolderSelector
        workspaceId={workspaceId}
        initialFolders={mockFolders}
        onCancel={handleCancel}
      />
    );

    const cancelButton = screen.getByRole('button', { name: /취소/i });
    fireEvent.click(cancelButton);

    expect(handleCancel).toHaveBeenCalledTimes(1);
  });

  it('shows saving spinner or text when isSaving is true', () => {
    render(
      <OutlookFolderSelector
        workspaceId={workspaceId}
        initialFolders={mockFolders}
        isSaving={true}
      />
    );

    const saveButton = screen.getByRole('button', { name: /연동 중\.\.\./i });
    expect(saveButton).toBeDisabled();
  });
});
