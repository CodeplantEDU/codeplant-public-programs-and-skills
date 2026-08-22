import type { Metadata } from "next";
import { AdminExamApp } from "./admin-exam-app";

export const metadata: Metadata = { title: "감독자 화면 | CODEPLANT 예시 시험" };

export default function AdminPage() {
  return <AdminExamApp />;
}
