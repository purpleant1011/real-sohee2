import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "채널 연결 | 소희",
  description: "인스타그램과 스레드 계정을 연결하고 연결 상태를 확인하세요.",
};

export default function ChannelsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
