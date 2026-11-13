'use client';

import dynamic from 'next/dynamic';

export type { VisualKnowledgeHarness } from '../content-view';

const ContentView = dynamic(
  () => import('../content-view'),
  {
    ssr: false,
    loading: () => (
      <div className="space-y-6 animate-pulse p-6">
        <div className="h-8 w-64 bg-zinc-200 dark:bg-zinc-800 rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="h-48 bg-zinc-100 dark:bg-zinc-900 rounded-3xl" />
          <div className="h-48 bg-zinc-100 dark:bg-zinc-900 rounded-3xl" />
          <div className="h-48 bg-zinc-100 dark:bg-zinc-900 rounded-3xl" />
        </div>
      </div>
    ),
  }
);

export default function LegacyContentPage() {
  return <ContentView />;
}
