import { authenticateStudent, database, jsonResponseError, readActiveExamResources, readActiveQuestions, readExamState } from "../../../../lib/database";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { studentId?: string; token?: string };
    const studentId = String(body.studentId ?? "");
    const token = String(body.token ?? "");
    const student = await authenticateStudent(studentId, token);
    if (!student) return jsonResponseError("인증되지 않은 세션입니다.", 401);

    const db = database();
    const rows = await db.prepare("SELECT question_id, answer_json, updated_at FROM answers WHERE student_id = ?")
      .bind(studentId)
      .all<{ question_id: string; answer_json: string; updated_at: string }>();
    const answers = Object.fromEntries(rows.results.map((row: { question_id: string; answer_json: string; updated_at: string }) => {
      try { return [row.question_id, JSON.parse(row.answer_json)]; } catch { return [row.question_id, {}]; }
    }));
    const examState = await readExamState();
    return Response.json({
      student: {
        studentId,
        name: String(student.name),
        status: String(student.status),
        violationCount: Number(student.violation_count ?? 0),
        submittedAt: student.submitted_at,
      },
      examState,
      questions: await readActiveQuestions(examState),
      resources: await readActiveExamResources(examState),
      answers,
    });
  } catch (error) {
    return jsonResponseError(error instanceof Error ? error.message : "상태 조회 중 오류가 발생했습니다.", 500);
  }
}
