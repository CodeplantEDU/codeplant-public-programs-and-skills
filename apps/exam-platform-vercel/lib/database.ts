import { defaultExamResources, examInfo, type ExamQuestion, type ExamResources, normalizeExamResources, questions as defaultQuestions, testExamInfo, testExamResources, testQuestions } from "./exam";
import { tursoDatabase } from "./turso-d1-adapter";

const DEFAULT_ADMIN_PIN = process.env.ADMIN_PIN?.trim() ?? "";
export const ACTUAL_EXAM_PROJECT_ID = "actual-exam";
export const CONNECTION_TEST_PROJECT_ID = "connection-test";

type ProjectRow = {
  id: string;
  name: string;
  kind: string;
  exam_code: string;
  duration_minutes: number;
  cover_eyebrow: string;
  cover_title: string;
  cover_description: string;
  questions_json: string;
  resources_json: string;
  questions_updated_at: string;
  resources_updated_at: string;
  sort_order: number;
  updated_at: string;
};

export type ExamProjectSummary = {
  id: string;
  name: string;
  kind: "exam" | "test";
  examCode: string;
  durationMinutes: number;
  coverTitle: string;
  questionCount: number;
  totalPoints: number;
  updatedAt: string;
};

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function database() {
  return tursoDatabase();
}

let databaseInitialization: Promise<void> | null = null;

async function initializeDatabase() {
  if (!/^\d{4,12}$/.test(DEFAULT_ADMIN_PIN)) throw new Error("ADMIN_PIN 환경변수에 숫자 4~12자리를 설정하세요.");
  const db = database();
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS exam_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL DEFAULT 'waiting',
      duration_minutes INTEGER NOT NULL DEFAULT 80,
      started_at TEXT,
      ended_at TEXT,
      exam_code TEXT NOT NULL DEFAULT 'AI2026',
      strict_mode INTEGER NOT NULL DEFAULT 1,
      is_test_mode INTEGER NOT NULL DEFAULT 0,
      cover_eyebrow TEXT NOT NULL DEFAULT 'CODEPLANT EXAM PLATFORM · DEMO',
      cover_title TEXT NOT NULL DEFAULT '예시 시험
프로젝트',
      cover_description TEXT NOT NULL DEFAULT '실제 평가 문항이 아닌 기능 체험용 예시입니다.',
      admin_pin_hash TEXT NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS students (
      student_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      session_token TEXT,
      status TEXT NOT NULL DEFAULT 'waiting',
      started_at TEXT,
      last_seen_at TEXT,
      submitted_at TEXT,
      violation_count INTEGER NOT NULL DEFAULT 0,
      completed_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS answers (
      student_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      answer_json TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      version INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (student_id, question_id)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      student_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS exam_questions (
      id TEXT PRIMARY KEY,
      sort_order INTEGER NOT NULL,
      question_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS exam_resources (
      resource_key TEXT PRIMARY KEY,
      resource_json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS exam_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'exam',
      exam_code TEXT NOT NULL,
      duration_minutes INTEGER NOT NULL,
      cover_eyebrow TEXT NOT NULL DEFAULT '',
      cover_title TEXT NOT NULL,
      cover_description TEXT NOT NULL DEFAULT '',
      questions_json TEXT NOT NULL,
      resources_json TEXT NOT NULL,
      questions_updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resources_updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_students_status ON students(status)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_events_student_created ON events(student_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_exam_questions_sort_order ON exam_questions(sort_order)"),
    db.prepare("CREATE INDEX IF NOT EXISTS idx_exam_projects_sort_order ON exam_projects(sort_order)"),
  ]);

  const stateColumns = await db.prepare("PRAGMA table_info(exam_state)").all<{ name: string }>();
  const columnNames = new Set(stateColumns.results.map((column) => column.name));
  const stateMigrations = [];
  if (!columnNames.has("cover_eyebrow")) stateMigrations.push(db.prepare("ALTER TABLE exam_state ADD COLUMN cover_eyebrow TEXT NOT NULL DEFAULT 'CODEPLANT EXAM PLATFORM · DEMO'"));
  if (!columnNames.has("cover_title")) stateMigrations.push(db.prepare("ALTER TABLE exam_state ADD COLUMN cover_title TEXT NOT NULL DEFAULT '예시 시험\n프로젝트'"));
  if (!columnNames.has("cover_description")) stateMigrations.push(db.prepare("ALTER TABLE exam_state ADD COLUMN cover_description TEXT NOT NULL DEFAULT '실제 평가 문항이 아닌 기능 체험용 예시입니다.'"));
  if (!columnNames.has("is_test_mode")) stateMigrations.push(db.prepare("ALTER TABLE exam_state ADD COLUMN is_test_mode INTEGER NOT NULL DEFAULT 0"));
  const addedActiveProjectColumn = !columnNames.has("active_project_id");
  if (addedActiveProjectColumn) stateMigrations.push(db.prepare("ALTER TABLE exam_state ADD COLUMN active_project_id TEXT NOT NULL DEFAULT 'actual-exam'"));
  if (stateMigrations.length) await db.batch(stateMigrations);

  const pinHash = await sha256(DEFAULT_ADMIN_PIN);
  await db
    .prepare(`INSERT OR IGNORE INTO exam_state
      (id, status, duration_minutes, exam_code, strict_mode, admin_pin_hash)
      VALUES (1, 'waiting', ?, 'AI2026', 1, ?)`)
    .bind(examInfo.durationMinutes, pinHash)
    .run();
  const questionCount = await db.prepare("SELECT COUNT(*) AS count FROM exam_questions").first<{ count: number }>();
  if (!questionCount || Number(questionCount.count) === 0) {
    await db.batch(defaultQuestions.map((question, index) => db
      .prepare("INSERT INTO exam_questions (id, sort_order, question_json, updated_at) VALUES (?, ?, ?, ?)")
      .bind(question.id, index + 1, JSON.stringify({ ...question, number: index + 1 }), new Date().toISOString())));
  }
  const resourceSeedTime = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO exam_resources (resource_key, resource_json, updated_at) VALUES ('pseudocode_guide', ?, ?)")
      .bind(JSON.stringify(defaultExamResources.pseudocodeGuide), resourceSeedTime),
    db.prepare("INSERT OR IGNORE INTO exam_resources (resource_key, resource_json, updated_at) VALUES ('common_reference', ?, ?)")
      .bind(JSON.stringify(defaultExamResources.commonReference), resourceSeedTime),
  ]);

  const projectSeedTime = new Date().toISOString();
  const legacyState = await db.prepare("SELECT * FROM exam_state WHERE id = 1").first<Record<string, unknown>>();
  if (!legacyState) throw new Error("시험 상태를 초기화할 수 없습니다.");
  const legacyQuestionRows = await db.prepare("SELECT question_json FROM exam_questions ORDER BY sort_order, id").all<{ question_json: string }>();
  const legacyQuestions = legacyQuestionRows.results.map((row) => JSON.parse(row.question_json) as ExamQuestion);
  const legacyResourceRows = await db.prepare("SELECT resource_key, resource_json FROM exam_resources").all<{ resource_key: string; resource_json: string }>();
  const legacyResourceMap = new Map(legacyResourceRows.results.map((row) => [row.resource_key, row.resource_json]));
  const parseLegacyResource = <T>(key: string, fallback: T) => {
    try { return JSON.parse(legacyResourceMap.get(key) ?? "") as T; } catch { return fallback; }
  };
  const legacyResources = normalizeExamResources({
    pseudocodeGuide: parseLegacyResource("pseudocode_guide", defaultExamResources.pseudocodeGuide),
    commonReference: parseLegacyResource("common_reference", defaultExamResources.commonReference),
  });
  const existingProjectCount = await db.prepare("SELECT COUNT(*) AS count FROM exam_projects").first<{ count: number }>();
  const initializingProjectStore = Number(existingProjectCount?.count ?? 0) === 0;
  await db.batch([
    db.prepare(`INSERT OR IGNORE INTO exam_projects
      (id, name, kind, exam_code, duration_minutes, cover_eyebrow, cover_title, cover_description,
       questions_json, resources_json, questions_updated_at, resources_updated_at, sort_order, updated_at)
      VALUES (?, ?, 'exam', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`)
      .bind(
        ACTUAL_EXAM_PROJECT_ID,
        "실제 시험",
        String(legacyState.exam_code ?? "AI2026"),
        Number(legacyState.duration_minutes ?? examInfo.durationMinutes),
        String(legacyState.cover_eyebrow ?? examInfo.coverEyebrow),
        String(legacyState.cover_title ?? examInfo.coverTitle),
        String(legacyState.cover_description ?? examInfo.coverDescription),
        JSON.stringify(legacyQuestions.length ? legacyQuestions : defaultQuestions),
        JSON.stringify(legacyResources),
        projectSeedTime,
        projectSeedTime,
        projectSeedTime,
      ),
    db.prepare(`INSERT OR IGNORE INTO exam_projects
      (id, name, kind, exam_code, duration_minutes, cover_eyebrow, cover_title, cover_description,
       questions_json, resources_json, questions_updated_at, resources_updated_at, sort_order, updated_at)
      VALUES (?, ?, 'test', ?, ?, ?, ?, ?, ?, ?, ?, ?, 2, ?)`)
      .bind(
        CONNECTION_TEST_PROJECT_ID,
        "접속 테스트",
        String(legacyState.exam_code ?? "AI2026"),
        testExamInfo.durationMinutes,
        testExamInfo.coverEyebrow,
        testExamInfo.coverTitle,
        testExamInfo.coverDescription,
        JSON.stringify(testQuestions),
        JSON.stringify(testExamResources),
        projectSeedTime,
        projectSeedTime,
        projectSeedTime,
      ),
  ]);
  if ((addedActiveProjectColumn || initializingProjectStore) && Number(legacyState.is_test_mode) === 1) {
    await db.prepare("UPDATE exam_state SET active_project_id = ? WHERE id = 1").bind(CONNECTION_TEST_PROJECT_ID).run();
  }
  const activeProject = await db.prepare(`SELECT kind FROM exam_projects
    WHERE id = (SELECT active_project_id FROM exam_state WHERE id = 1)`).first<{ kind: string }>();
  if (!activeProject) {
    await db.prepare("UPDATE exam_state SET active_project_id = ?, is_test_mode = 0 WHERE id = 1").bind(ACTUAL_EXAM_PROJECT_ID).run();
  } else {
    await db.prepare("UPDATE exam_state SET is_test_mode = ? WHERE id = 1").bind(activeProject.kind === "test" ? 1 : 0).run();
  }
}

export function ensureDatabase() {
  if (!databaseInitialization) {
    databaseInitialization = initializeDatabase().catch((error) => {
      databaseInitialization = null;
      throw error;
    });
  }
  return databaseInitialization;
}

async function activeProjectId() {
  await ensureDatabase();
  const row = await database().prepare("SELECT active_project_id FROM exam_state WHERE id = 1").first<{ active_project_id: string }>();
  return row?.active_project_id || ACTUAL_EXAM_PROJECT_ID;
}

async function readProjectRow(projectId?: string) {
  await ensureDatabase();
  const id = projectId || await activeProjectId();
  const row = await database().prepare("SELECT * FROM exam_projects WHERE id = ?").bind(id).first<ProjectRow>();
  if (!row) throw new Error("선택한 시험 프로젝트를 찾을 수 없습니다.");
  return row;
}

function parseQuestions(value: string, fallback: ExamQuestion[]) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed as ExamQuestion[] : fallback;
  } catch { return fallback; }
}

export async function readExamProjects(): Promise<ExamProjectSummary[]> {
  await ensureDatabase();
  const rows = await database().prepare("SELECT * FROM exam_projects ORDER BY sort_order, name").all<ProjectRow>();
  return rows.results.map((row) => {
    const questions = parseQuestions(row.questions_json, row.kind === "test" ? testQuestions : defaultQuestions);
    return {
      id: row.id,
      name: row.name,
      kind: row.kind === "test" ? "test" : "exam",
      examCode: row.exam_code,
      durationMinutes: Number(row.duration_minutes),
      coverTitle: row.cover_title,
      questionCount: questions.length,
      totalPoints: questions.reduce((sum, question) => sum + Number(question.points || 0), 0),
      updatedAt: row.updated_at,
    };
  });
}

export async function readQuestions(projectId?: string): Promise<ExamQuestion[]> {
  await ensureDatabase();
  const project = await readProjectRow(projectId);
  return parseQuestions(project.questions_json, project.kind === "test" ? testQuestions : defaultQuestions);
}

export async function readQuestionBankUpdatedAt(projectId?: string) {
  return (await readProjectRow(projectId)).questions_updated_at ?? null;
}

export async function replaceQuestions(nextQuestions: ExamQuestion[], projectId?: string) {
  await ensureDatabase();
  const id = projectId || await activeProjectId();
  const now = new Date().toISOString();
  const normalized = nextQuestions.map((question, index) => ({ ...question, number: index + 1 }));
  await database().prepare("UPDATE exam_projects SET questions_json = ?, questions_updated_at = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(normalized), now, now, id).run();
}

export async function readExamResources(projectId?: string): Promise<ExamResources> {
  const project = await readProjectRow(projectId);
  try { return normalizeExamResources(JSON.parse(project.resources_json)); }
  catch { return project.kind === "test" ? testExamResources : defaultExamResources; }
}

export async function readExamResourcesUpdatedAt(projectId?: string) {
  return (await readProjectRow(projectId)).resources_updated_at ?? null;
}

export async function replaceExamResources(value: unknown, projectId?: string) {
  await ensureDatabase();
  const id = projectId || await activeProjectId();
  const resources = normalizeExamResources(value);
  const now = new Date().toISOString();
  await database().prepare("UPDATE exam_projects SET resources_json = ?, resources_updated_at = ?, updated_at = ? WHERE id = ?")
    .bind(JSON.stringify(resources), now, now, id).run();
  return resources;
}

export async function verifyAdminPin(pin: string) {
  await ensureDatabase();
  const row = await database().prepare("SELECT admin_pin_hash FROM exam_state WHERE id = 1").first<{ admin_pin_hash: string }>();
  return Boolean(row && row.admin_pin_hash === (await sha256(pin)));
}

export async function changeAdminPin(newPin: string) {
  if (!/^\d{4,12}$/.test(newPin)) {
    throw new Error("새 관리자 암호는 숫자 4~12자리로 입력하세요.");
  }
  await ensureDatabase();
  await database().prepare("UPDATE exam_state SET admin_pin_hash = ? WHERE id = 1").bind(await sha256(newPin)).run();
}

export async function readExamState() {
  await ensureDatabase();
  const row = await database().prepare("SELECT * FROM exam_state WHERE id = 1").first<Record<string, unknown>>();
  if (!row) throw new Error("시험 상태를 읽을 수 없습니다.");
  const project = await readProjectRow(String(row.active_project_id ?? ACTUAL_EXAM_PROJECT_ID));
  const startedAt = typeof row.started_at === "string" ? row.started_at : null;
  const isTestMode = project.kind === "test";
  const durationMinutes = Number(project.duration_minutes);
  const endsAt = startedAt ? new Date(new Date(startedAt).getTime() + durationMinutes * 60_000).toISOString() : null;
  return {
    status: String(row.status),
    durationMinutes,
    startedAt,
    endsAt,
    endedAt: typeof row.ended_at === "string" ? row.ended_at : null,
    examCode: project.exam_code,
    strictMode: Number(row.strict_mode) === 1,
    isTestMode,
    projectId: project.id,
    projectName: project.name,
    projectKind: isTestMode ? "test" as const : "exam" as const,
    coverEyebrow: project.cover_eyebrow,
    coverTitle: project.cover_title,
    coverDescription: project.cover_description,
  };
}

export async function readActiveQuestions(state?: Awaited<ReturnType<typeof readExamState>>) {
  const activeState = state ?? await readExamState();
  return readQuestions(activeState.projectId);
}

export async function readActiveExamResources(state?: Awaited<ReturnType<typeof readExamState>>) {
  const activeState = state ?? await readExamState();
  return readExamResources(activeState.projectId);
}

export async function authenticateStudent(studentId: string, token: string) {
  await ensureDatabase();
  const row = await database()
    .prepare("SELECT * FROM students WHERE student_id = ? AND session_token = ?")
    .bind(studentId, token)
    .first<Record<string, unknown>>();
  return row;
}

export function cleanIdentifier(value: unknown, max = 30) {
  return String(value ?? "").trim().replace(/[^0-9A-Za-z가-힣_-]/g, "").slice(0, max);
}

export function jsonResponseError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}
