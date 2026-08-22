"use client";

/* eslint-disable @next/next/no-img-element -- brand assets are local static files */

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { examInfo, type CommonReference, type ExamQuestion, type ExamResources, type PseudocodeGuide } from "../../lib/exam";
import { CommonDataTable } from "../common-data-table";
import { CommonResourceEditor } from "./common-resource-editor";
import { QuestionBankEditor } from "./question-bank-editor";
import { RichText } from "../rich-text";

type Summary = {
  examState: {
    status: string;
    durationMinutes: number;
    startedAt: string | null;
    endsAt: string | null;
    examCode: string;
    strictMode: boolean;
    isTestMode: boolean;
    projectId: string;
    projectName: string;
    projectKind: "exam" | "test";
    coverEyebrow: string;
    coverTitle: string;
    coverDescription: string;
  };
  projects: Array<{
    id: string;
    name: string;
    kind: "exam" | "test";
    examCode: string;
    durationMinutes: number;
    coverTitle: string;
    questionCount: number;
    totalPoints: number;
    updatedAt: string;
  }>;
  questions: ExamQuestion[];
  activeQuestionCount: number;
  activeTotalPoints: number;
  questionBankUpdatedAt: string | null;
  resources: ExamResources;
  resourcesUpdatedAt: string | null;
  students: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
  serverTime: string;
};

export type ExportData = {
  exportedAt: string;
  examInfo: typeof examInfo;
  examState: Summary["examState"];
  questions: ExamQuestion[];
  resources: ExamResources;
  students: Array<Record<string, unknown>>;
  answers: Array<Record<string, unknown>>;
  events: Array<Record<string, unknown>>;
};

const labels: Record<string, string> = { waiting: "대기", open: "진행 중", closed: "종료", active: "응시 중", submitted: "제출", disqualified: "실격" };
const eventLabels: Record<string, string> = { login: "입장", visibility_hidden: "화면 이탈", visibility_visible: "화면 복귀", window_blur: "초점 이탈", window_focus: "초점 복귀", pagehide: "페이지 종료", connection_lost: "연결 끊김", connection_restored: "연결 복구", submitted: "제출" };

function ago(value: unknown, now: string) {
  if (!value) return "—";
  const seconds = Math.max(0, Math.floor((Date.parse(now) - Date.parse(String(value))) / 1000));
  if (seconds < 10) return "방금 전";
  if (seconds < 60) return `${seconds}초 전`;
  return `${Math.floor(seconds / 60)}분 전`;
}

export function AdminExamApp() {
  const [pin, setPin] = useState(() => typeof window === "undefined" ? "" : (sessionStorage.getItem("exam-admin-pin") ?? ""));
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  const [newPinInput, setNewPinInput] = useState("");
  const [durationInput, setDurationInput] = useState("80");
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [coverEyebrowInput, setCoverEyebrowInput] = useState("");
  const [coverTitleInput, setCoverTitleInput] = useState("");
  const [coverDescriptionInput, setCoverDescriptionInput] = useState("");
  const [coverDirty, setCoverDirty] = useState(false);
  const [printData, setPrintData] = useState<{ data: ExportData; studentId?: string } | null>(null);

  const loadCoverInputs = useCallback((data: Summary) => {
    setCoverEyebrowInput(data.examState.coverEyebrow);
    setCoverTitleInput(data.examState.coverTitle);
    setCoverDescriptionInput(data.examState.coverDescription);
  }, []);

  const loadSettingsInputs = useCallback((data: Summary) => {
    setCodeInput(data.examState.examCode);
    setDurationInput(String(data.examState.durationMinutes));
  }, []);

  const request = useCallback(async (action = "summary", extra: Record<string, unknown> = {}) => {
    const activePin = pin || sessionStorage.getItem("exam-admin-pin") || "";
    const response = await fetch("/api/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, pin: activePin, ...extra }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error ?? "요청을 처리하지 못했습니다.");
    return data;
  }, [pin]);

  const refresh = useCallback(async () => {
    try {
      const data = await request("summary");
      setSummary(data);
      if (!settingsDirty) loadSettingsInputs(data);
      if (!coverDirty) loadCoverInputs(data);
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "연결 오류");
      if (!pin) setSummary(null);
    }
  }, [request, pin, settingsDirty, coverDirty, loadSettingsInputs, loadCoverInputs]);

  useEffect(() => {
    if (!pin) return;
    const initial = setTimeout(refresh, 0);
    const timer = setInterval(refresh, 3_000);
    return () => { clearTimeout(initial); clearInterval(timer); };
  }, [pin, refresh]);

  useEffect(() => {
    const clearPrintData = () => setPrintData(null);
    window.addEventListener("afterprint", clearPrintData);
    return () => window.removeEventListener("afterprint", clearPrintData);
  }, []);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const data = await request("summary");
      sessionStorage.setItem("exam-admin-pin", pin);
      setSummary(data);
      loadSettingsInputs(data);
      loadCoverInputs(data);
      setSettingsDirty(false);
      setCoverDirty(false);
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "인증 오류");
    } finally { setBusy(false); }
  }

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      const data = await request(action, extra);
      setSummary(data);
      if (!settingsDirty) loadSettingsInputs(data);
      if (!coverDirty) loadCoverInputs(data);
      if (action === "change-pin" && newPinInput) {
        sessionStorage.setItem("exam-admin-pin", newPinInput);
        setPin(newPinInput);
        setNewPinInput("");
      }
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "처리 오류");
    } finally { setBusy(false); }
  }

  async function exportData() {
    setBusy(true);
    try {
      const data = await request("export");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `selection_exam_${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "내보내기 오류");
    } finally { setBusy(false); }
  }

  async function printAnswers(studentId?: string) {
    setBusy(true);
    try {
      const data = await request("export") as ExportData;
      if (!data.students.length) throw new Error("출력할 응시자가 없습니다.");
      setPrintData({ data, studentId });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "PDF 출력 준비 오류");
    } finally { setBusy(false); }
  }

  async function saveQuestionBank(nextQuestions: ExamQuestion[]) {
    setBusy(true);
    try {
      const data = await request("questions-save", { questions: nextQuestions });
      setSummary(data);
      setError("");
      return true;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "문항 저장 오류");
      return false;
    } finally { setBusy(false); }
  }

  async function resetQuestionBank() {
    setBusy(true);
    try {
      const data = await request("questions-reset");
      setSummary(data);
      setError("");
      return data.questions as ExamQuestion[];
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "기본 문항 복원 오류");
      return null;
    } finally { setBusy(false); }
  }

  async function selectProject(projectId: string) {
    if (!summary || projectId === summary.examState.projectId) return;
    const current = summary.examState;
    if (current.status === "open") {
      setError("진행 중인 시험을 종료한 뒤 프로젝트를 변경하세요.");
      return;
    }
    const switchMessage = settingsDirty || coverDirty
      ? "저장하지 않은 표지·운영 설정이 있습니다. 변경 내용을 버리고 다른 프로젝트를 열까요?"
      : "프로젝트를 전환하면 저장하지 않은 문항·공통자료 변경은 사라집니다. 저장을 마쳤다면 계속할까요?";
    if (!confirm(switchMessage)) return;
    let clearTestRecords = false;
    if (summary.students.length > 0) {
      if (!current.isTestMode) {
        setError("실제 시험 응시 기록이 있습니다. PDF·JSON 백업과 새 시험 초기화 후 프로젝트를 변경하세요.");
        return;
      }
      if (!confirm("접속 테스트 응시자·답안·로그를 지우고 다른 시험 프로젝트로 전환할까요?")) return;
      clearTestRecords = true;
    }
    setBusy(true);
    try {
      const data = await request("project-select", { projectId, clearTestRecords });
      setSummary(data);
      loadSettingsInputs(data);
      loadCoverInputs(data);
      setSettingsDirty(false);
      setCoverDirty(false);
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "시험 프로젝트 전환 오류");
    } finally { setBusy(false); }
  }

  async function saveResources(nextResources: ExamResources) {
    setBusy(true);
    try {
      const data = await request("resources-save", { resources: nextResources });
      setSummary(data);
      setError("");
      return true;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "공통자료 저장 오류");
      return false;
    } finally { setBusy(false); }
  }

  async function resetResources() {
    setBusy(true);
    try {
      const data = await request("resources-reset");
      setSummary(data);
      setError("");
      return data.resources as ExamResources;
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "기본 공통자료 복원 오류");
      return null;
    } finally { setBusy(false); }
  }

  async function saveCoverSettings() {
    setBusy(true);
    try {
      const data = await request("settings", {
        coverEyebrow: coverEyebrowInput,
        coverTitle: coverTitleInput,
        coverDescription: coverDescriptionInput,
      });
      setSummary(data);
      loadCoverInputs(data);
      setCoverDirty(false);
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "표지 저장 오류");
    } finally { setBusy(false); }
  }

  async function saveOperatingSettings() {
    setBusy(true);
    try {
      const data = await request("settings", {
        examCode: codeInput,
        durationMinutes: Number(durationInput),
      });
      setSummary(data);
      loadSettingsInputs(data);
      setSettingsDirty(false);
      setError("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "운영 설정 저장 오류");
    } finally { setBusy(false); }
  }

  const counts = useMemo(() => ({
    total: summary?.students.length ?? 0,
    active: summary?.students.filter((student) => student.status === "active").length ?? 0,
    submitted: summary?.students.filter((student) => student.status === "submitted").length ?? 0,
    disqualified: summary?.students.filter((student) => student.status === "disqualified").length ?? 0,
  }), [summary]);

  const totalPoints = useMemo(
    () => summary?.questions.reduce((sum, question) => sum + question.points, 0) ?? 0,
    [summary],
  );

  if (!summary) {
    return <main className="admin-login"><section className="login-card admin-card"><img className="brand-logo" src="/codeplant/logo-full-light.png" alt="CODEPLANT" /><h1>감독자 인증</h1><p className="muted">시험 시작과 답안 상태를 관리합니다.</p><form onSubmit={login}><label htmlFor="admin-pin">관리자 암호</label><input id="admin-pin" type="password" autoComplete="current-password" value={pin} onChange={(event) => setPin(event.target.value)} required />{error && <div className="form-error">{error}</div>}<button className="primary-button" disabled={busy}>{busy ? "확인 중…" : "감독 화면 열기"}</button></form><Link className="admin-link" href="/" prefetch={false}>학생 시험 화면</Link></section></main>;
  }

  const state = summary.examState;
  return (
    <main className="admin-shell">
      <header className="admin-header"><div className="exam-brand"><img className="brand-mark-small" src="/codeplant/logo-mark.svg" alt="CODEPLANT" /><div><strong>{state.coverTitle.replace(/\s*\n\s*/g, " ")} · 감독자</strong><span>실시간 시험 운영 화면</span></div></div><div className="admin-header-actions"><Link href="/" target="_blank" prefetch={false}>학생 화면 열기</Link><button className="pdf-button" onClick={() => printAnswers()} disabled={busy || counts.total === 0}>전체 답안 PDF</button><button onClick={exportData} disabled={busy}>JSON 백업</button></div></header>

      <section className="admin-topline">
        <div><div className="eyebrow">{state.isTestMode ? "DEVICE TEST CONTROL" : "EXAM CONTROL"}</div><h1>{state.isTestMode ? "접속 테스트 운영" : "시험 운영 현황"}</h1><p>서버 시각 {new Date(summary.serverTime).toLocaleString("ko-KR")}</p></div>
        <div className="control-panel">
          <div className={`state-badge ${state.status} ${state.isTestMode ? "test" : ""}`}>{state.isTestMode ? "테스트 · " : ""}{labels[state.status] ?? state.status}</div>
          {state.status === "waiting" && <button className="primary-button compact" disabled={busy} onClick={() => { const message = state.isTestMode ? `대기자를 모두 확인했습니다. ${state.durationMinutes}분 접속 테스트를 지금 시작할까요?` : `대기자를 모두 확인했습니다. ${state.durationMinutes}분 실제 시험을 지금 시작할까요?`; if (confirm(message)) act("start"); }}>{state.isTestMode ? "테스트 시작" : "실제 시험 시작"}</button>}
          {state.status === "open" && <button className="danger-button" disabled={busy} onClick={() => { const message = state.isTestMode ? "접속 테스트를 종료하고 응시 중 답안을 제출 처리할까요?" : "시험을 종료하고 응시 중 답안을 제출 처리할까요?"; if (confirm(message)) act("close"); }}>{state.isTestMode ? "테스트 종료" : "시험 종료"}</button>}
          {state.status === "closed" && <button className="outline-button" disabled={busy} onClick={() => { const message = state.isTestMode ? "테스트 응시자·답안·로그만 삭제하고 실제 시험 대기 화면으로 돌아갈까요?" : "모든 응시자·답안·로그를 삭제하고 새 시험으로 초기화할까요? 내보내기를 먼저 권장합니다."; if (confirm(message)) act("reset-all"); }}>{state.isTestMode ? "테스트 기록 초기화" : "새 시험 초기화"}</button>}
        </div>
      </section>

      {error && <div className="admin-error">{error}</div>}
      {state.isTestMode && <section className="test-mode-notice"><strong>접속 테스트 프로젝트</strong><span>실제 시험과 분리된 3문항 프로젝트입니다. 실제 문항을 수정해도 이 테스트 문항은 바뀌지 않습니다.</span></section>}

      <section className="metric-grid">
        <article><span>입장 인원</span><strong>{counts.total}</strong><small>명</small></article>
        <article><span>응시 중</span><strong>{counts.active}</strong><small>명</small></article>
        <article><span>제출 완료</span><strong>{counts.submitted}</strong><small>명</small></article>
        <article className={counts.disqualified ? "alert" : ""}><span>실격/중단</span><strong>{counts.disqualified}</strong><small>명</small></article>
      </section>

      <section className="admin-grid">
        <article className="admin-panel roster-panel">
          <div className="panel-heading"><div><h2>응시자 현황</h2><p>3초마다 자동 갱신됩니다.</p></div><span>{counts.total}명</span></div>
          <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>학생</th><th>상태</th><th>작성</th><th>마지막 연결</th><th>이탈</th><th>조치</th></tr></thead><tbody>{summary.students.length === 0 ? <tr><td colSpan={6} className="empty-cell">아직 입장한 학생이 없습니다.</td></tr> : summary.students.map((student) => <tr key={String(student.student_id)}><td><strong>{String(student.name)}</strong><small>{String(student.student_id)}</small></td><td><span className={`student-status ${String(student.status)}`}>{labels[String(student.status)] ?? String(student.status)}</span></td><td><strong>{Number(student.completed_count)}/{summary.activeQuestionCount}</strong></td><td>{ago(student.last_seen_at, summary.serverTime)}</td><td className={Number(student.violation_count) ? "violation" : ""}>{String(student.violation_count)}</td><td><div className="row-actions"><button className="table-button pdf-row-button" onClick={() => printAnswers(String(student.student_id))}>개별 PDF</button>{student.status === "disqualified" ? <button className="table-button" onClick={() => act("reinstate", { studentId: student.student_id })}>실격 취소</button> : <button className="table-button" onClick={() => { if (confirm(`${student.name} 학생의 기기 연결을 초기화할까요?`)) act("reset-session", { studentId: student.student_id }); }}>기기 초기화</button>}</div></td></tr>)}</tbody></table></div>
        </article>

        <aside className="admin-side">
          <article className="admin-panel project-panel">
            <div className="panel-heading"><div><h2>시험 프로젝트</h2><p>학생에게 열어 줄 시험을 선택합니다.</p></div></div>
            <div className="project-list">
              {summary.projects.map((project) => {
                const selected = project.id === state.projectId;
                const locked = busy || state.status === "open" || (counts.total > 0 && !state.isTestMode);
                return <button key={project.id} type="button" className={`project-card ${selected ? "selected" : ""}`} disabled={selected || locked} onClick={() => selectProject(project.id)}>
                  <span className="project-card-kicker">{project.kind === "test" ? "CONNECTION TEST" : "EXAM PROJECT"}</span>
                  <strong>{project.name}</strong>
                  <small>{project.durationMinutes}분 · {project.questionCount}문항 · {project.totalPoints}점</small>
                  <span className="project-card-state">{selected ? "현재 선택됨" : "이 프로젝트 열기"}</span>
                </button>;
              })}
            </div>
            <p className="project-panel-note">프로젝트별 표지·시간·문항·공통자료가 따로 저장됩니다.</p>
          </article>
          <article className="admin-panel settings-panel">
            <div className="panel-heading"><div><h2>시험 운영 설정</h2><p>시험코드·시간·이탈 규칙을 설정합니다.</p></div></div>
            <div className="settings-form">
              <label htmlFor="exam-code">시험코드<input id="exam-code" value={codeInput} onChange={(event) => { setCodeInput(event.target.value); setSettingsDirty(true); }} disabled={state.status !== "waiting"} /></label>
              <label htmlFor="exam-duration">시험시간(분)<input id="exam-duration" type="number" min={5} max={600} value={durationInput} onChange={(event) => { setDurationInput(event.target.value); setSettingsDirty(true); }} disabled={state.status !== "waiting"} /></label>
              <button className="primary-button compact settings-save" onClick={saveOperatingSettings} disabled={state.status !== "waiting" || busy || !settingsDirty}>{settingsDirty ? "운영 설정 저장" : "저장된 설정"}</button>
            </div>
            <div className="toggle-row"><div><strong>이탈 1회 경고·2회 실격</strong><span>첫 이탈은 경고하고, 다시 이탈하면 실격</span></div><input id="strict-mode" aria-label="이탈 1회 경고 및 2회 실격 사용" type="checkbox" checked={state.strictMode} disabled={state.status !== "waiting" || busy} onChange={(event) => act("strict", { strictMode: event.target.checked })} /></div>
            <div className="time-info"><span>{state.isTestMode ? "테스트 시간" : "저장된 시험시간"}</span><strong>{state.durationMinutes}분</strong></div>
            <div className="time-info"><span>종료 예정</span><strong>{state.endsAt ? new Date(state.endsAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "시험 시작 시 계산"}</strong></div>
            <div className="admin-pin-settings"><label htmlFor="new-admin-pin">새 관리자 암호</label><div className="inline-input"><input id="new-admin-pin" type="password" inputMode="numeric" value={newPinInput} placeholder="숫자 4~12자리" onChange={(event) => setNewPinInput(event.target.value)} /><button onClick={() => act("change-pin", { newPin: newPinInput })} disabled={busy || newPinInput.length < 4}>변경</button></div></div>
          </article>
          <article className="admin-panel event-panel"><div className="panel-heading"><div><h2>최근 활동</h2><p>이탈·접속·제출 로그</p></div></div><div className="event-list">{summary.events.length === 0 ? <p className="empty-cell">기록이 없습니다.</p> : summary.events.slice(0, 12).map((event) => <div key={String(event.id)} className={String(event.event_type).includes("hidden") || event.event_type === "pagehide" ? "critical-event" : ""}><span className="event-dot" /><p><strong>{String(event.student_id)}</strong> · {eventLabels[String(event.event_type)] ?? String(event.event_type)}<small>{new Date(String(event.created_at)).toLocaleTimeString("ko-KR")}</small></p></div>)}</div></article>
        </aside>
      </section>

      <section className="cover-manager admin-panel">
        <div className="cover-manager-head">
          <div><div className="eyebrow">COVER SETTINGS</div><h2>학생 표지 설정</h2><p>학생이 시험에 입장하기 전 보는 첫 화면입니다. 오른쪽에서 최종 모습을 확인할 수 있습니다.</p></div>
            <button className="primary-button compact" onClick={saveCoverSettings} disabled={state.status !== "waiting" || busy || !coverDirty}>표지 저장</button>
        </div>
        <div className="cover-manager-body">
          <div className="cover-settings-form">
            <label htmlFor="cover-eyebrow">상단 영문 문구</label>
            <input id="cover-eyebrow" value={coverEyebrowInput} maxLength={100} onChange={(event) => { setCoverEyebrowInput(event.target.value); setCoverDirty(true); }} disabled={state.status !== "waiting"} />
            <label htmlFor="cover-title">표지 제목</label>
            <textarea id="cover-title" rows={3} value={coverTitleInput} maxLength={160} onChange={(event) => { setCoverTitleInput(event.target.value); setCoverDirty(true); }} disabled={state.status !== "waiting"} />
            <small>줄을 바꾸면 학생 화면에도 그대로 적용됩니다.</small>
            <label htmlFor="cover-description">설명 문구</label>
            <textarea id="cover-description" rows={4} value={coverDescriptionInput} maxLength={500} placeholder="비워 두면 설명 문구를 표시하지 않습니다." onChange={(event) => { setCoverDescriptionInput(event.target.value); setCoverDirty(true); }} disabled={state.status !== "waiting"} />
            <div className="cover-derived-stats"><div><span>총점</span><strong>{state.isTestMode ? summary.activeTotalPoints : totalPoints}점</strong></div><div><span>문항 수</span><strong>{summary.activeQuestionCount}문항</strong></div></div>
            <p className="cover-setting-note">시험시간은 ‘시험 운영 설정’에서 변경하며, 총점과 문항 수는 저장된 문제를 기준으로 자동 계산됩니다.</p>
          </div>
          <div className="cover-preview-shell">
            <span>학생 화면 미리보기</span>
            <div className="cover-preview-card">
              <img src="/codeplant/logo-mark-white.svg" alt="CODEPLANT" />
              {coverEyebrowInput.trim() && <p className="cover-preview-eyebrow">{coverEyebrowInput}</p>}
              <h3>{coverTitleInput || "표지 제목"}</h3>
              {coverDescriptionInput.trim() && <p className="cover-preview-description">{coverDescriptionInput}</p>}
              <div className="cover-preview-stats"><strong>{state.durationMinutes}분</strong><strong>총 {state.isTestMode ? summary.activeTotalPoints : totalPoints}점</strong><strong>{summary.activeQuestionCount}문항</strong></div>
            </div>
          </div>
        </div>
      </section>
      <CommonResourceEditor
        key={`resources-${state.projectId}`}
        resources={summary.resources}
        savedAt={summary.resourcesUpdatedAt}
        locked={state.status !== "waiting" || counts.total > 0}
        busy={busy}
        onSave={saveResources}
        onReset={resetResources}
      />
      <QuestionBankEditor
        key={`questions-${state.projectId}`}
        questions={summary.questions}
        savedAt={summary.questionBankUpdatedAt}
        locked={state.status !== "waiting" || counts.total > 0}
        busy={busy}
        onSave={saveQuestionBank}
        onReset={resetQuestionBank}
      />
      {printData && <div className="print-preview-backdrop"><div className="print-preview-toolbar"><div><strong>{printData.studentId ? "학생 개별 답안 PDF" : "전체 학생 답안 PDF"}</strong><span>내용을 확인한 뒤 PDF로 저장하세요.</span></div><div><button onClick={() => setPrintData(null)}>닫기</button><button className="primary-button compact" onClick={() => window.print()}>인쇄 · PDF로 저장</button></div></div><div className="print-preview-scroll"><PrintAnswerReport data={printData.data} studentId={printData.studentId} /></div></div>}
    </main>
  );
}

export function PrintAnswerReport({ data, studentId }: { data: ExportData; studentId?: string }) {
  const targetStudents = studentId
    ? data.students.filter((student) => String(student.student_id) === studentId)
    : data.students;
  const answerMap = new Map<string, Record<string, string>>();
  for (const answer of data.answers) {
    const key = `${String(answer.student_id)}:${String(answer.question_id)}`;
    const value = answer.answer_json;
    answerMap.set(key, value && typeof value === "object" ? value as Record<string, string> : {});
  }
  const referenceQuestionId = data.questions.find((question) => question.showReference ?? question.part === "B")?.id;
  const firstQuestionByPart = new Map<"A" | "B" | "C", string>();
  for (const question of data.questions) if (!firstQuestionByPart.has(question.part)) firstQuestionByPart.set(question.part, question.id);

  return (
    <section className="print-report" aria-hidden="true">
      {targetStudents.map((student, studentIndex) => {
        const id = String(student.student_id);
        const studentEvents = data.events.filter((event) => String(event.student_id) === id);
        const violationEvents = studentEvents.filter((event) => ["visibility_hidden", "pagehide", "fullscreen_exit"].includes(String(event.event_type)));
        return (
          <article className="print-student" key={id}>
            <header className="print-cover-header">
              <div className="print-mark"><img src="/codeplant/logo-mark.svg" alt="CODEPLANT" /></div>
              <div><p>{data.examState.isTestMode ? "DEVICE CONNECTION TEST" : "CODEPLANT EXAM PLATFORM · DEMO"}</p><h1>{data.examInfo.title} 답안지</h1><span>{data.examInfo.subtitle}</span></div>
            </header>
            <section className="print-student-meta">
              <div><span>학생번호</span><strong>{id}</strong></div>
              <div><span>성명</span><strong>{String(student.name)}</strong></div>
              <div><span>제출 상태</span><strong>{labels[String(student.status)] ?? String(student.status)}</strong></div>
              <div><span>제출 시각</span><strong>{student.submitted_at ? new Date(String(student.submitted_at)).toLocaleString("ko-KR") : "미제출"}</strong></div>
              <div><span>작성 문항</span><strong>{String(student.completed_count ?? 0)} / {data.questions.length}</strong></div>
              <div><span>화면 이탈 기록</span><strong>{violationEvents.length}회</strong></div>
            </section>

            {data.questions.map((question) => {
              const studentAnswer = answerMap.get(`${id}:${question.id}`) ?? {};
              return (
                <section className="print-question" key={question.id}>
                  {question.id === firstQuestionByPart.get(question.part) && data.resources.guides.filter((guide) => guide.part === question.part).map((guide) => <PrintPseudocodeGuide key={guide.id} guide={guide} />)}
                  {question.id === referenceQuestionId && <PrintResearchReference reference={data.resources.commonReference} />}
                  <div className="print-question-title"><span>PART {question.part}</span><h2>{question.number}. <RichText text={question.title} /></h2><strong>{question.points}점</strong></div>
                  <div className="print-prompt">{question.prompt.map((paragraph) => <p key={paragraph}><RichText text={paragraph} /></p>)}{question.data && <pre>{question.data}</pre>}</div>
                  <div className="print-answer-fields">
                    {question.fields.map((field) => <div key={field.key}><h3>{field.label}</h3><p className={studentAnswer[field.key]?.trim() ? "" : "blank-answer"}>{studentAnswer[field.key]?.trim() || "미작성"}</p></div>)}
                  </div>
                </section>
              );
            })}
            <footer className="print-student-footer"><span>{id} · {String(student.name)}</span><span>{studentIndex + 1} / {targetStudents.length}명</span><span>출력 {new Date(data.exportedAt).toLocaleString("ko-KR")}</span></footer>
          </article>
        );
      })}
    </section>
  );
}

function PrintPseudocodeGuide({ guide }: { guide: PseudocodeGuide }) {
  return (
    <section className="print-reference print-guide">
      <h2>{guide.title}</h2>
      <ul>{guide.rules.map((rule, index) => <li key={`${index}-${rule}`}><RichText text={rule} /></li>)}</ul>
      <section><h3><RichText text={guide.exampleProblem} /></h3><pre>{guide.exampleData}{guide.exampleData ? "\n\n" : ""}{guide.exampleAnswer}</pre></section>
      <section><h3><RichText text={guide.elseIfExampleProblem} /></h3><pre>{guide.elseIfExampleData}{guide.elseIfExampleData ? "\n\n" : ""}{guide.elseIfExampleAnswer}</pre></section>
    </section>
  );
}

function PrintResearchReference({ reference }: { reference: CommonReference }) {
  return (
    <section className="print-reference">
      <h2>{reference.title}</h2>
      {reference.sections.map((section, index) => <section key={`${index}-${section.heading}`}><h3><RichText text={section.heading} /></h3>{section.paragraphs.map((paragraph, paragraphIndex) => <p key={`${paragraphIndex}-${paragraph}`}><RichText text={paragraph} /></p>)}</section>)}
      {reference.definitions.length > 0 && <ul>{reference.definitions.map((definition, index) => <li key={`${index}-${definition}`}><RichText text={definition} /></li>)}</ul>}
      <CommonDataTable table={reference.table} />
    </section>
  );
}

