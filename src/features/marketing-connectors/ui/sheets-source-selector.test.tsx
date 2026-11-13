import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SheetsSourceSelector } from './sheets-source-selector';

describe('SheetsSourceSelector Component (MC/S02 - ANI-2164)', () => {
  const workspaceId = 'ws-test-selector-123';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders input fields for spreadsheet ID/URL, sheet name, A1 range, and consent checkbox', () => {
    render(<SheetsSourceSelector workspaceId={workspaceId} />);

    expect(screen.getByLabelText(/스프레드시트 주소 또는 ID/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/시트 이름/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/수집 범위 \(A1 표기법\)/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /소희 마케팅 지식 활용에 동의/i })).toBeInTheDocument();

    const saveButton = screen.getByRole('button', { name: /시트 범위 확정 및 연동/i });
    expect(saveButton).toBeDisabled();
  });

  it('allows user to enter Google Sheets URL and extracts spreadsheet ID on save', () => {
    const handleSave = vi.fn();
    render(
      <SheetsSourceSelector
        workspaceId={workspaceId}
        onSave={handleSave}
      />
    );

    const urlInput = screen.getByLabelText(/스프레드시트 주소 또는 ID/i);
    fireEvent.change(urlInput, {
      target: {
        value: 'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0',
      },
    });

    const sheetNameInput = screen.getByLabelText(/시트 이름/i);
    fireEvent.change(sheetNameInput, { target: { value: '메뉴판' } });

    const rangeInput = screen.getByLabelText(/수집 범위 \(A1 표기법\)/i);
    fireEvent.change(rangeInput, { target: { value: 'A1:D50' } });

    const saveButton = screen.getByRole('button', { name: /시트 범위 확정 및 연동/i });
    expect(saveButton).not.toBeDisabled();

    fireEvent.click(saveButton);

    expect(handleSave).toHaveBeenCalledWith(
      '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms!메뉴판!A1:D50',
      true
    );
  });

  it('applies preset range when preset button is clicked', () => {
    render(<SheetsSourceSelector workspaceId={workspaceId} />);

    const presetButton = screen.getByRole('button', { name: /A1:D50/i });
    fireEvent.click(presetButton);

    const rangeInput = screen.getByLabelText(/수집 범위 \(A1 표기법\)/i) as HTMLInputElement;
    expect(rangeInput.value).toBe('A1:D50');
  });

  it('validates invalid A1 range format and shows warning message', () => {
    render(
      <SheetsSourceSelector
        workspaceId={workspaceId}
        initialSpreadsheetId="valid-spreadsheet-id-12345"
      />
    );

    const rangeInput = screen.getByLabelText(/수집 범위 \(A1 표기법\)/i);
    fireEvent.change(rangeInput, { target: { value: 'invalid_range_123' } });

    expect(screen.getByText(/올바른 A1 범위 형식/i)).toBeInTheDocument();
    const saveButton = screen.getByRole('button', { name: /시트 범위 확정 및 연동/i });
    expect(saveButton).toBeDisabled();
  });

  it('disables save button when AI processing consent checkbox is unchecked', () => {
    render(
      <SheetsSourceSelector
        workspaceId={workspaceId}
        initialSpreadsheetId="valid-spreadsheet-id-12345"
        initialRange="A1:D50"
      />
    );

    const consentCheckbox = screen.getByRole('checkbox', {
      name: /소희 마케팅 지식 활용에 동의/i,
    });
    expect(consentCheckbox).toBeChecked();

    const saveButton = screen.getByRole('button', { name: /시트 범위 확정 및 연동/i });
    expect(saveButton).not.toBeDisabled();

    fireEvent.click(consentCheckbox);
    expect(consentCheckbox).not.toBeChecked();
    expect(saveButton).toBeDisabled();
  });

  it('calls onCancel when cancel button is clicked', () => {
    const handleCancel = vi.fn();
    render(<SheetsSourceSelector workspaceId={workspaceId} onCancel={handleCancel} />);

    const cancelButton = screen.getByRole('button', { name: /취소/i });
    fireEvent.click(cancelButton);

    expect(handleCancel).toHaveBeenCalledTimes(1);
  });
});
