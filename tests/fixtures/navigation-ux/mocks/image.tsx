/* eslint-disable @next/next/no-img-element */
import React from 'react'

export interface ImageProps extends Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  src: string | { src: string; height: number; width: number }
  alt: string
  width?: number | string
  height?: number | string
  priority?: boolean
}

export default function Image({ src, alt, width, height, className, priority, ...props }: ImageProps) {
  const resolvedSrc = typeof src === 'string' ? src : src?.src || ''
  return (
    <img
      src={resolvedSrc}
      alt={alt || ''}
      width={width}
      height={height}
      className={className}
      loading={priority ? 'eager' : 'lazy'}
      {...props}
    />
  )
}
