import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { DataTable } from './data-table'

describe('DataTable', () => {
  it('renders owned semantic table markup from headless columns', () => {
    render(
      <DataTable
        caption="콘텐츠 성과"
        columns={[{ key: 'title', header: '콘텐츠' }, { key: 'saved', header: '저장' }]}
        rows={[{ id: 'one', title: '상담 전 준비', saved: 12 }]}
      />,
    )

    expect(screen.getByRole('table', { name: '콘텐츠 성과' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: '저장' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: '12' })).toBeInTheDocument()
  })
})
