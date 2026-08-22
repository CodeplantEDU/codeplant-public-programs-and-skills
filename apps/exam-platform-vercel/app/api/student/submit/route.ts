import { authenticateStudent, database, jsonResponseError, readExamState } from "../../../../lib/database";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { studentId?: string; token?: string; automatic?: boolean };
    const studentId = String(body.studentId ?? "");
    const student = await authenticateStudent(studentId, String(body.token ?? ""));
    if (!student) return jsonResponseError("인증되지 않은 세션입니다.", 401);
    if (String(student.status) === "disqualified") return jsonResponseError("실격 처리된 시험입니다.", 423);
    if (String(student.status) === "submitted") {
      const state = await readExamState();
      const prefix = state.isTestMode ? "TEST" : "EX";
      return Response.json({ status: "submitted", submittedAt: student.submitted_at, receipt: `${prefix}-${studentId}-${String(student.submitted_at).slice(11, 19).replaceAll(":", "")}` });
    }
    const state = await readExamState();
    if (!state.startedAt) return jsonResponseError("아직 시험이 시작되지 않았습니다.", 423);
    const now = new Date().toISOString();
    const db = database();
    await db.prepare("UPDATE students SET status = 'submitted', submitted_at = ?, last_seen_at = ? WHERE student_id = ?")
      .bind(now, now, studentId)
      .run();
    await db.prepare("INSERT INTO events (student_id, event_type, details, created_at) VALUES (?, 'submitted', ?, ?)")
      .bind(studentId, JSON.stringify({ automatic: Boolean(body.automatic) }), now)
      .run();
    const prefix = state.isTestMode ? "TEST" : "EX";
    return Response.json({ status: "submitted", submittedAt: now, receipt: `${prefix}-${studentId}-${now.slice(11, 19).replaceAll(":", "")}` });
  } catch (error) {
    return jsonResponseError(error instanceof Error ? error.message : "제출 처리 중 오류가 발생했습니다.", 500);
  }
}
