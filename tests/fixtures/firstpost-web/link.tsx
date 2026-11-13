import React from 'react'
import type { AnchorHTMLAttributes } from 'react'
/** 격리 Vite에서 Next Link의 화면 이동만 브라우저 링크로 대체한다. 앱 상태·저장은 실제 컴포넌트다. */
export default function Link(props: AnchorHTMLAttributes<HTMLAnchorElement>) { return <a {...props} /> }
