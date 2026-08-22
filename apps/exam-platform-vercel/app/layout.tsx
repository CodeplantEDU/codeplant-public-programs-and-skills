import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CODEPLANT 예시 시험",
  description: "내부망 전용 알고리즘·산업 AI 연구역량 선발시험",
  icons: { icon: "/codeplant/logo-icon.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
