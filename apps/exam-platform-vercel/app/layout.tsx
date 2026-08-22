import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CODEPLANT 예시 시험",
  description: "학교와 교육기관에서 수정해 사용할 수 있는 공개 예시 시험 플랫폼",
  icons: { icon: "/codeplant/logo-icon.png" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
