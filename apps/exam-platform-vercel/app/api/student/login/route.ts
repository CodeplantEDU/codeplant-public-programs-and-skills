import { cleanIdentifier, database, ensureDatabase, jsonResponseError, readActiveExamResources, readActiveQuestions, readExamState } from "../../../../lib/database";

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { studentId?: string; name?: string; examCode?: string; token?: string };
    const studentId = cleanIdentifier(body.studentId, 20);
    const name = cleanIdentifier(body.name, 20);
    const token = cleanIdentifier(body.token, 80);
    const examCode = String(body.examCode ?? "").trim();
    if (studentId.length < 2 || name.length < 2) return jsonResponseError("학생번호와 이름을 정확히 입력하세요.");

    await ensureDatabase();
    const state = await readExamState();
    const questions = await readActiveQuestions(state);
    const resources = await readActiveExamResources(state);
    if (state.status === "closed") return jsonResponseError("종료된 시험입니다.", 403);
    if (examCode !== state.examCode) return jsonResponseError("시험코드가 일치하지 않습니다.", 403);

    const db = database();
    const existing = await db.prepare("SELECT * FROM students WHERE student_id = ?").bind(studentId).first<Record<string, unknown>>();
    if (existing) {
      if (String(existing.name) !== name) return jsonResponseError("등록된 이름과 일치하지 않습니다.", 403);
      if (!existing.session_token) {
        const replacementToken = crypto.randomUUID().replaceAll("-", "");
        await db.prepare("UPDATE students SET session_token = ?, last_seen_at = ? WHERE student_id = ?")
          .bind(replacementToken, new Date().toISOString(), studentId)
          .run();
        return Response.json({ studentId, name, token: replacementToken, studentStatus: String(existing.status), examState: state, questions, resources });
      }
      if (!token || token !== String(existing.session_token)) {
        return jsonResponseError("이미 다른 기기에 연결된 학생번호입니다. 감독자에게 세션 초기화를 요청하세요.", 409);
      }
      await db.prepare("UPDATE students SET last_seen_at = ? WHERE student_id = ?").bind(new Date().toISOString(), studentId).run();
      return Response.json({ studentId, name, token, studentStatus: String(existing.status), examState: state, questions, resources });
    }

    const newToken = crypto.randomUUID().replaceAll("-", "");
    const now = new Date().toISOString();
    const studentStatus = state.status === "open" ? "active" : "waiting";
    await db.prepare(`INSERT INTO students
      (student_id, name, session_token, status, started_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .bind(studentId, name, newToken, studentStatus, state.startedAt, now)
      .run();
    await db.prepare("INSERT INTO events (student_id, event_type, details, created_at) VALUES (?, 'login', '{}', ?)")
      .bind(studentId, now)
      .run();

    return Response.json({ studentId, name, token: newToken, studentStatus, examState: state, questions, resources }, { status: 201 });
  } catch (error) {
    return jsonResponseError(error instanceof Error ? error.message : "로그인 처리 중 오류가 발생했습니다.", 500);
  }
}
