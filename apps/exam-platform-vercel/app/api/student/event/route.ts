import { authenticateStudent, database, jsonResponseError, readExamState } from "../../../../lib/database";

const allowedEvents = new Set([
  "visibility_hidden", "visibility_visible", "window_blur", "window_focus",
  "pagehide", "fullscreen_exit", "connection_lost", "connection_restored",
]);

export async function POST(request: Request) {
  try {
    const raw = await request.text();
    const body = JSON.parse(raw) as { studentId?: string; token?: string; eventType?: string; details?: unknown };
    const studentId = String(body.studentId ?? "");
    const token = String(body.token ?? "");
    const eventType = String(body.eventType ?? "");
    if (!allowedEvents.has(eventType)) return jsonResponseError("허용되지 않은 이벤트입니다.");
    const student = await authenticateStudent(studentId, token);
    if (!student) return jsonResponseError("인증되지 않은 세션입니다.", 401);
    const details = JSON.stringify(body.details ?? {}).slice(0, 2_000);
    const now = new Date().toISOString();
    const db = database();
    const disqualifying = eventType === "visibility_hidden" || eventType === "window_blur" || eventType === "pagehide" || eventType === "fullscreen_exit";
    const recentViolation = disqualifying
      ? await db.prepare(`SELECT created_at FROM events
          WHERE student_id = ? AND event_type IN ('visibility_hidden', 'window_blur', 'pagehide', 'fullscreen_exit')
          ORDER BY id DESC LIMIT 1`).bind(studentId).first<{ created_at: string }>()
      : null;
    await db.prepare("INSERT INTO events (student_id, event_type, details, created_at) VALUES (?, ?, ?, ?)")
      .bind(studentId, eventType, details, now)
      .run();

    const state = await readExamState();
    let status = String(student.status);
    let violationCount = Number(student.violation_count ?? 0);
    const previousViolationAt = recentViolation?.created_at ? Date.parse(recentViolation.created_at) : 0;
    const duplicateViolation = previousViolationAt > 0 && Date.now() - previousViolationAt < 3_000;
    if (state.status === "open" && status === "active" && disqualifying && !duplicateViolation) {
      violationCount += 1;
      if (state.strictMode && violationCount >= 2) status = "disqualified";
      await db.prepare("UPDATE students SET status = ?, violation_count = ?, last_seen_at = ? WHERE student_id = ?")
        .bind(status, violationCount, now, studentId)
        .run();
    }
    return Response.json({ recordedAt: now, status, violationCount, strictMode: state.strictMode });
  } catch (error) {
    return jsonResponseError(error instanceof Error ? error.message : "이탈 기록 중 오류가 발생했습니다.", 500);
  }
}
