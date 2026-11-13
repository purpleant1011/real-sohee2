import React from 'react'

/** Restricted markdown subset: React escapes text; only http(s) links become anchors. */
function inline(text: string): React.ReactNode[] {
  const pieces: React.ReactNode[] = []
  const pattern = /\[([^\]\n]+)\]\(([^)\s]+)\)|\*\*([^*\n]+)\*\*/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > last) pieces.push(text.slice(last, index))
    if (match[3]) pieces.push(<strong key={index}>{match[3]}</strong>)
    else {
      let safe = false
      try {
        const url = new URL(match[2])
        safe = url.protocol === 'http:' || url.protocol === 'https:'
      } catch { /* relative and malformed URLs remain plain text */ }
      pieces.push(safe ? <a key={index} href={match[2]} rel="noopener noreferrer" target="_blank" className="underline">{match[1]}</a> : match[1])
    }
    last = index + match[0].length
  }
  pieces.push(text.slice(last))
  return pieces
}

export function SafeChatMarkdown({ content }: { content: string }) {
  const lines = content.replace(/\r\n?/g, '\n').split('\n')
  const nodes: React.ReactNode[] = []
  let list: string[] = []
  let quotes: string[] = []
  let fenced = false

  const flushList = () => {
    if (list.length) {
      nodes.push(
        <ul key={`list-${nodes.length}`} className="list-disc pl-4 space-y-1">
          {list.map((item, i) => (
            <li key={i}>{inline(item)}</li>
          ))}
        </ul>
      )
      list = []
    }
  }

  const flushQuotes = () => {
    if (quotes.length) {
      nodes.push(
        <blockquote
          key={`quote-${nodes.length}`}
          className="border-l-2 border-purple-400/80 dark:border-purple-500/80 pl-2.5 my-1 text-muted-foreground italic space-y-0.5"
        >
          {quotes.map((q, idx) => (
            <p key={idx}>{inline(q)}</p>
          ))}
        </blockquote>
      )
      quotes = []
    }
  }

  const flushAll = () => {
    flushList()
    flushQuotes()
  }

  for (const [i, line] of lines.entries()) {
    if (/^\s*```/.test(line)) {
      flushAll()
      fenced = !fenced
      continue
    }
    if (fenced || /^(?: {4}|\t)/.test(line)) continue

    // 구분선 (---)
    if (/^\s*---+\s*$/.test(line)) {
      flushAll()
      nodes.push(<hr key={`hr-${i}`} className="my-2 border-border" />)
      continue
    }

    // 인용구 (> ...)
    const quoteMatch = /^\s*>\s?(.*)$/.exec(line)
    if (quoteMatch) {
      flushList()
      quotes.push(quoteMatch[1])
      continue
    }

    // 목록 (- 또는 * 또는 +)
    const item = /^\s*[-*+]\s+(.+)$/.exec(line)
    if (item) {
      flushQuotes()
      list.push(item[1])
      continue
    }

    // 제목 (#~### -> 굵은 단락)
    const headerMatch = /^\s*#{1,3}\s+(.+)$/.exec(line)
    if (headerMatch) {
      flushAll()
      nodes.push(
        <p key={i} className="font-bold">
          {inline(headerMatch[1])}
        </p>
      )
      continue
    }

    flushAll()
    if (line.trim()) nodes.push(<p key={i}>{inline(line)}</p>)
  }

  flushAll()
  return <div className="space-y-1.5 whitespace-pre-wrap break-words">{nodes}</div>
}
