import { changeAdminPin, database, ensureDatabase, jsonResponseError, readActiveExamResources, readActiveQuestions, readExamProjects, readExamResources, readExamResourcesUpdatedAt, readExamState, readQuestionBankUpdatedAt, readQuestions, replaceExamResources, replaceQuestions, verifyAdminPin } from "../../../lib/database";
import { defaultExamResources, examInfo, gradingSystemPrompt, normalizeQuestionBank, questions as defaultQuestions, testExamInfo, testExamResources, testQuestions } from "../../../lib/exam";

async function summary() {
  const db = database();
  const examState = await readExamState();
  const questions = await readQuestions(examState.projectId);
  const students = await db.prepare(`SELECT student_id, name, status, last_seen_at, submitted_at,
    violation_count, completed_count, created_at FROM students ORDER BY student_id`).all<Record<string, unknown>>();
  const events = await db.prepare("SELECT id, student_id, event_type, details, created_at FROM events ORDER BY id DESC LIMIT 100")
    .all<Record<string, unknown>>();
  return {
    examState,
    projects: await readExamProjects(),
    questions,
    activeQuestionCount: questions.length,
    activeTotalPoints: questions.reduce((sum, question) => sum + question.points, 0),
    questionBankUpdatedAt: await readQuestionBankUpdatedAt(examState.projectId),
    resources: await readExamResources(examState.projectId),
    resourcesUpdatedAt: await readExamResourcesUpdatedAt(examState.projectId),
    students: students.results,
    events: events.results,
    serverTime: new Date().toISOString(),
  };
}

async function assertContentEditingAllowed() {
  const state = await readExamState();
  if (state.status !== "waiting") throw new Error("문항과 공통자료는 시험 대기 상태에서만 변경할 수 있습니다.");
  const count = await database().prepare("SELECT COUNT(*) AS count FROM students").first<{ count: number }>();
  if (Number(count?.count ?? 0) > 0) throw new Error("입장한 학생이 있습니다. 답안을 백업하고 새 시험 초기화 후 문항을 변경하세요.");
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { action?: string; pin?: string; studentId?: string; strictMode?: boolean; examCode?: string; durationMinutes?: number; coverEyebrow?: string; coverTitle?: string; coverDescription?: string; newPin?: string; questions?: unknown; resources?: unknown; projectId?: string; clearTestRecords?: boolean };
    await ensureDatabase();
    if (!(await verifyAdminPin(String(body.pin ?? "")))) return jsonResponseError("관리자 암호가 일치하지 않습니다.", 401);
    const db = database();
    const action = String(body.action ?? "summary");
    const now = new Date().toISOString();

    if (action === "start") {
      const current = await readExamState();
      if (current.status !== "waiting") return jsonResponseError("시험 대기 상태에서만 시작할 수 있습니다.");
      if (current.isTestMode) {
        const waitingCount = await db.prepare("SELECT COUNT(*) AS count FROM students WHERE status = 'waiting'").first<{ count: number }>();
        if (Number(waitingCount?.count ?? 0) === 0) return jsonResponseError("테스트시험에 입장한 학생이 없습니다. 학생 기기 접속을 먼저 확인하세요.");
      }
      await db.prepare("UPDATE exam_state SET status = 'open', started_at = ?, ended_at = NULL WHERE id = 1").bind(now).run();
      await db.prepare("UPDATE students SET status = 'active', started_at = ?, submitted_at = NULL WHERE status = 'waiting'").bind(now).run();
    } else if (action === "close") {
      if ((await readExamState()).status !== "open") return jsonResponseError("진행 중인 시험만 종료할 수 있습니다.");
      await db.prepare("UPDATE exam_state SET status = 'closed', ended_at = ? WHERE id = 1").bind(now).run();
      await db.prepare("UPDATE students SET status = 'submitted', submitted_at = COALESCE(submitted_at, ?) WHERE status = 'active'").bind(now).run();
    } else if (action === "project-select") {
      const current = await readExamState();
      const projectId = String(body.projectId ?? "");
      if (projectId === current.projectId) return Response.json(await summary());
      if (current.status === "open") return jsonResponseError("진행 중인 시험은 다른 프로젝트로 전환할 수 없습니다.");
      const target = await db.prepare("SELECT * FROM exam_projects WHERE id = ?").bind(projectId).first<Record<string, unknown>>();
      if (!target) return jsonResponseError("선택한 시험 프로젝트를 찾을 수 없습니다.");
      const studentCount = await db.prepare("SELECT COUNT(*) AS count FROM students").first<{ count: number }>();
      const hasRecords = Number(studentCount?.count ?? 0) > 0;
      if (hasRecords && !(current.isTestMode && body.clearTestRecords)) {
        return jsonResponseError("현재 프로젝트에 응시 기록이 있습니다. PDF·JSON 백업 후 초기화하세요.");
      }
      const projectKind = String(target.kind) === "test" ? "test" : "exam";
      const statements = [];
      if (hasRecords) statements.push(db.prepare("DELETE FROM answers"), db.prepare("DELETE FROM events"), db.prepare("DELETE FROM students"));
      statements.push(db.prepare(`UPDATE exam_state SET active_project_id = ?, is_test_mode = ?, status = 'waiting',
        started_at = NULL, ended_at = NULL, exam_code = ?, duration_minutes = ?, cover_eyebrow = ?, cover_title = ?, cover_description = ? WHERE id = 1`)
        .bind(projectId, projectKind === "test" ? 1 : 0, String(target.exam_code), Number(target.duration_minutes), String(target.cover_eyebrow), String(target.cover_title), String(target.cover_description)));
      await db.batch(statements);
    } else if (action === "strict") {
      const current = await readExamState();
      if (current.status !== "waiting") return jsonResponseError("시험 대기 상태에서만 이탈 규칙을 변경할 수 있습니다.");
      await db.prepare("UPDATE exam_state SET strict_mode = ? WHERE id = 1").bind(body.strictMode ? 1 : 0).run();
    } else if (action === "settings") {
      const current = await readExamState();
      if (current.status !== "waiting") return jsonResponseError("시험 대기 상태에서만 표지와 시험 설정을 변경할 수 있습니다.");
      const code = String(body.examCode ?? current.examCode).trim().replace(/\s+/g, "").slice(0, 20);
      if (code.length < 4) return jsonResponseError("시험코드는 4자 이상이어야 합니다.");
      const durationMinutes = Number(body.durationMinutes ?? current.durationMinutes);
      if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 600) return jsonResponseError("시험시간은 5~600분 사이의 정수로 입력하세요.");
      const coverEyebrow = String(body.coverEyebrow ?? current.coverEyebrow).trim().slice(0, 100);
      const coverTitle = String(body.coverTitle ?? current.coverTitle).trim().slice(0, 160);
      const coverDescription = String(body.coverDescription ?? current.coverDescription).trim().slice(0, 500);
      if (!coverTitle) return jsonResponseError("표지 제목을 입력하세요.");
      await db.batch([
        db.prepare(`UPDATE exam_projects SET exam_code = ?, duration_minutes = ?, cover_eyebrow = ?, cover_title = ?,
          cover_description = ?, updated_at = ? WHERE id = ?`)
          .bind(code, durationMinutes, coverEyebrow, coverTitle, coverDescription, now, current.projectId),
        db.prepare("UPDATE exam_state SET exam_code = ?, duration_minutes = ?, cover_eyebrow = ?, cover_title = ?, cover_description = ? WHERE id = 1")
          .bind(code, durationMinutes, coverEyebrow, coverTitle, coverDescription),
      ]);
    } else if (action === "change-pin") {
      await changeAdminPin(String(body.newPin ?? ""));
    } else if (action === "reinstate") {
      const status = (await readExamState()).status === "open" ? "active" : "waiting";
      await db.prepare("UPDATE students SET status = ? WHERE student_id = ?").bind(status, String(body.studentId ?? "")).run();
    } else if (action === "reset-session") {
      await db.prepare("UPDATE students SET session_token = NULL WHERE student_id = ?").bind(String(body.studentId ?? "")).run();
      await db.prepare("DELETE FROM students WHERE student_id = ? AND completed_count = 0 AND status = 'waiting'").bind(String(body.studentId ?? "")).run();
    } else if (action === "reset-all") {
      const current = await readExamState();
      await db.batch([
        db.prepare("DELETE FROM answers"),
        db.prepare("DELETE FROM events"),
        db.prepare("DELETE FROM students"),
        db.prepare("UPDATE exam_state SET status = 'waiting', started_at = NULL, ended_at = NULL, is_test_mode = ? WHERE id = 1")
          .bind(current.isTestMode ? 1 : 0),
      ]);
    } else if (action === "questions-save") {
      await assertContentEditingAllowed();
      await replaceQuestions(normalizeQuestionBank(body.questions));
    } else if (action === "questions-reset") {
      await assertContentEditingAllowed();
      const state = await readExamState();
      await replaceQuestions(state.isTestMode ? testQuestions : defaultQuestions, state.projectId);
    } else if (action === "resources-save") {
      await assertContentEditingAllowed();
      await replaceExamResources(body.resources);
    } else if (action === "resources-reset") {
      await assertContentEditingAllowed();
      const state = await readExamState();
      await replaceExamResources(state.isTestMode ? testExamResources : defaultExamResources, state.projectId);
    } else if (action === "export") {
      const students = await db.prepare("SELECT * FROM students ORDER BY student_id").all<Record<string, unknown>>();
      const answers = await db.prepare("SELECT * FROM answers ORDER BY student_id, question_id").all<Record<string, unknown>>();
      const events = await db.prepare("SELECT * FROM events ORDER BY id").all<Record<string, unknown>>();
      const state = await readExamState();
      const resources = await readActiveExamResources(state);
      const activeQuestions = await readActiveQuestions(state);
      return Response.json({
        exportedAt: now,
        examInfo: {
          ...(state.isTestMode ? testExamInfo : examInfo),
          title: state.coverTitle.replace(/\s*\n\s*/g, " "),
          coverEyebrow: state.coverEyebrow,
          coverTitle: state.coverTitle,
          coverDescription: state.coverDescription,
          durationMinutes: state.durationMinutes,
        },
        pseudocodeGuide: resources.pseudocodeGuide,
        partBReference: resources.commonReference,
        resources,
        questions: activeQuestions,
        gradingSystemPrompt,
        examState: state,
        students: students.results,
        answers: answers.results.map((row: Record<string, unknown>) => ({ ...row, answer_json: JSON.parse(String(row.answer_json ?? "{}")) })),
        events: events.results,
      });
    } else if (action !== "summary") {
      return jsonResponseError("알 수 없는 관리자 작업입니다.");
    }

    return Response.json(await summary());
  } catch (error) {
    return jsonResponseError(error instanceof Error ? error.message : "관리자 요청 처리 중 오류가 발생했습니다.", 500);
  }
}
