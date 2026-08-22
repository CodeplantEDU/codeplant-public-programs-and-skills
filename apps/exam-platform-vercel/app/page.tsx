import type { Metadata } from "next";
import { StudentExamApp } from "./student-exam-app";

export const metadata: Metadata = {
  title: "CODEPLANT 예시 시험",
  description: "직접 수정하여 사용하는 CODEPLANT 공개 예시 시험 화면",
};

export default function Home() {
  return <StudentExamApp />;
}
