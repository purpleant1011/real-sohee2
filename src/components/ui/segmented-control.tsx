'use client'

import { Radio, RadioGroup } from 'react-aria-components'
import styles from './segmented-control.module.css'

export type SegmentedControlItem<T extends string> = Readonly<{
  count?: number
  disabled?: boolean
  id: T
  label: string
}>

export function SegmentedControl<T extends string>({
  ariaLabel,
  items,
  onChange,
  value,
}: Readonly<{
  ariaLabel: string
  items: readonly SegmentedControlItem<T>[]
  onChange: (value: T) => void
  value: T
}>) {
  return (
    <RadioGroup
      aria-label={ariaLabel}
      className={styles.group}
      onChange={(next) => onChange(next as T)}
      orientation="horizontal"
      value={value}
    >
      {items.map((item) => (
        <Radio className={styles.item} id={item.id} isDisabled={item.disabled} key={item.id} value={item.id}>
          <span>{item.label}</span>
          {item.count === undefined ? null : <strong>{item.count}</strong>}
        </Radio>
      ))}
    </RadioGroup>
  )
}
