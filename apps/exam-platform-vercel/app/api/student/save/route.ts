import { authenticateStudent, database, jsonResponseError, readActiveQuestions, readExamState } from "../../../../lib/database";

function hasAnswer(value: unknown) {
  if (!value || typeof value !== "object") return false;
  return Object.values(value as Record<string, unknown>).some((entry) => String(entry ?? "").trim().length > 0);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { studentId?: string; token?: string; questionId?: string; answer?: unknown };
    const studentId = String(body.studentId ?? "");
    const token = String(body.token ?? "");
    const questionId = String(body.questionId ?? "");
    const serialized = JSON.stringify(body.answer ?? {});
    if (serialized.length > 30_000) return jsonResponseError("답안이 허용된 길이를 초과했습니다.");

    const student = await authenticateStudent(studentId, token);
    if (!student) return jsonResponseError("인증되지 않은 세션입니다.", 401);
    if (String(student.status) !== "active") return jsonResponseError("현재 답안을 수정할 수 없는 상태입니다.", 423);
    const state = await readExamState();
    const questions = await readActiveQuestions(state);
    if (!questions.some((question) => question.id === questionId)) return jsonResponseError("현재 시험에 존재하지 않는 문항입니다.");
    if (state.status !== "open") return jsonResponseError("시험이 진행 중이 아닙니다.", 423);
    if (state.endsAt && Date.now() > Date.parse(state.endsAt)) return jsonResponseError("시험 시간이 종료되었습니다.", 423);

    const now = new Date().toISOString();
    const db = database();
    await db.prepare(`INSERT INTO answers (student_id, question_id, answer_json, updated_at, version)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(student_id, question_id) DO UPDATE SET
        answer_json = excluded.answer_json,
        updated_at = excluded.updated_at,
        version = answers.version + 1`)
      .bind(studentId, questionId, serialized, now)
      .run();

    const saved = await db.prepare("SELECT answer_json FROM answers WHERE student_id = ?")
      .bind(studentId)
      .all<{ answer_json: string }>();
    const completedCount = saved.results.reduce((count: number, row: { answer_json: string }) => {
      try { return count + (hasAnswer(JSON.parse(row.answer_json)) ? 1 : 0); } catch { return count; }
    }, 0);
    await db.prepare("UPDATE students SET last_seen_at = ?, completed_count = ? WHERE student_id = ?")
      .bind(now, Math.min(completedCount, questions.length), studentId)
      .run();
    return Response.json({ savedAt: now, completedCount });
  } catch (error) {
    return jsonResponseError(error instanceof Error ? error.message : "답안 저장 중 오류가 발생했습니다.", 500);
  }
}
