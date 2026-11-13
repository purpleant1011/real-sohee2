'use client'

import {
  Button,
  UNSTABLE_Toast as Toast,
  UNSTABLE_ToastContent as ToastContent,
  UNSTABLE_ToastQueue as ToastQueue,
  UNSTABLE_ToastRegion as ToastRegion,
} from 'react-aria-components'
import { X } from 'lucide-react'
import styles from './toast-region.module.css'

export type SoheeToast = Readonly<{
  description?: string
  title: string
}>

export const soheeToastQueue = new ToastQueue<SoheeToast>({ maxVisibleToasts: 3 })

export function SoheeToastRegion() {
  return (
    <ToastRegion className={styles.region} queue={soheeToastQueue}>
      {({ toast }) => (
        <Toast className={styles.toast} toast={toast}>
          <ToastContent className={styles.content}>
            <strong>{toast.content.title}</strong>
            {toast.content.description ? <span>{toast.content.description}</span> : null}
          </ToastContent>
          <Button aria-label="알림 닫기" className={styles.close} slot="close"><X aria-hidden="true" /></Button>
        </Toast>
      )}
    </ToastRegion>
  )
}
