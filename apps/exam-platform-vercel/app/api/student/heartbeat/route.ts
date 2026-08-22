import { authenticateStudent, database, jsonResponseError, readExamState } from "../../../../lib/database";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { studentId?: string; token?: string };
    const studentId = String(body.studentId ?? "");
    const token = String(body.token ?? "");
    const student = await authenticateStudent(studentId, token);
    if (!student) return jsonResponseError("인증되지 않은 세션입니다.", 401);
    const now = new Date().toISOString();
    await database().prepare("UPDATE students SET last_seen_at = ? WHERE student_id = ?").bind(now, studentId).run();
    return Response.json({
      serverTime: now,
      status: String(student.status),
      violationCount: Number(student.violation_count ?? 0),
      examState: await readExamState(),
    });
  } catch (error) {
    return jsonResponseError(error instanceof Error ? error.message : "연결 확인 중 오류가 발생했습니다.", 500);
  }
}
