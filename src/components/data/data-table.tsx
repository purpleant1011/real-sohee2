'use client'

import type { ReactNode } from 'react'
import { flexRender, tableFeatures, useTable } from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import styles from './data-table.module.css'

const features = tableFeatures({})

export type DataColumn<T extends object> = Readonly<{
  header: string
  key: Extract<keyof T, string>
  render?: (row: T) => ReactNode
}>

export function DataTable<T extends object>({ caption, columns, rows }: Readonly<{
  caption: string
  columns: readonly DataColumn<T>[]
  rows: readonly T[]
}>) {
  const tableColumns: ColumnDef<typeof features, T>[] = columns.map((column) => ({
    accessorKey: column.key,
    cell: column.render ? ({ row }) => column.render?.(row.original) : undefined,
    header: column.header,
  }))
  const table = useTable({ columns: tableColumns, data: rows, features })

  return (
    <div className={styles.wrap}>
      <table aria-label={caption}>
        <caption>{caption}</caption>
        <thead>
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => <th key={header.id}>{flexRender(header.column.columnDef.header, header.getContext())}</th>)}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id}>
              {row.getAllCells().map((cell) => <td data-label={String(cell.column.columnDef.header ?? '')} key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext()) ?? String(cell.getValue() ?? '')}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
