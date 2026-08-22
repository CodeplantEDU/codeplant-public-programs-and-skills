"use client";

/* eslint-disable @next/next/no-img-element -- brand assets are local static files */

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultExamResources, examInfo, questions as defaultQuestions, type ExamQuestion, type ExamResources } from "../lib/exam";
import { CommonDataTable } from "./common-data-table";
import { RichText } from "./rich-text";

type Session = { studentId: string; name: string; token: string };
type ExamState = {
  status: string;
  durationMinutes: number;
  startedAt: string | null;
  endsAt: string | null;
  strictMode: boolean;
  isTestMode: boolean;
  coverEyebrow: string;
  coverTitle: string;
  coverDescription: string;
};
type StudentState = { status: string; violationCount: number; submittedAt?: string | null };
type Answers = Record<string, Record<string, string>>;
type PublicExamInfo = { durationMinutes: number; questionCount: number; totalPoints: number; partA: number; partB: number; partC: number; coverEyebrow: string; coverTitle: string; coverDescription: string; isTestMode?: boolean };

const SESSION_KEY = "selection-exam-session";
const DRAFT_KEY = "selection-exam-drafts";

function answerIsStarted(answer: Record<string, string> | undefined) {
  return answer && Object.values(answer).some((value) => value.trim().length > 0);
}

function formatTime(seconds: number) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  return `${String(minutes).padStart(2, "0")}:${String(safe % 60).padStart(2, "0")}`;
}

function eventLabel(status: string) {
  return ({ waiting: "입장 완료 · 대기", active: "응시 중", submitted: "제출 완료", disqualified: "시험 무효" } as Record<string, string>)[status] ?? status;
}

function summarizeQuestions(questions: ExamQuestion[], state: Pick<ExamState, "durationMinutes" | "coverEyebrow" | "coverTitle" | "coverDescription">): PublicExamInfo {
  return {
    durationMinutes: state.durationMinutes,
    questionCount: questions.length,
    totalPoints: questions.reduce((sum, question) => sum + question.points, 0),
    partA: questions.filter((question) => question.part === "A").reduce((sum, question) => sum + question.points, 0),
    partB: questions.filter((question) => question.part === "B").reduce((sum, question) => sum + question.points, 0),
    partC: questions.filter((question) => question.part === "C").reduce((sum, question) => sum + question.points, 0),
    coverEyebrow: state.coverEyebrow,
    coverTitle: state.coverTitle,
    coverDescription: state.coverDescription,
    isTestMode: "isTestMode" in state ? Boolean(state.isTestMode) : false,
  };
}

export function StudentExamApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [examState, setExamState] = useState<ExamState | null>(null);
  const [studentState, setStudentState] = useState<StudentState | null>(null);
  const [questions, setQuestions] = useState<ExamQuestion[]>(defaultQuestions);
  const [resources, setResources] = useState<ExamResources>(defaultExamResources);
  const [publicInfo, setPublicInfo] = useState<PublicExamInfo>({ durationMinutes: examInfo.durationMinutes, questionCount: defaultQuestions.length, totalPoints: examInfo.totalPoints, partA: examInfo.partA, partB: examInfo.partB, partC: 0, coverEyebrow: examInfo.coverEyebrow, coverTitle: examInfo.coverTitle, coverDescription: examInfo.coverDescription });
  const [answers, setAnswers] = useState<Answers>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [remaining, setRemaining] = useState(examInfo.durationMinutes * 60);
  const [connected, setConnected] = useState(true);
  const [saveStatus, setSaveStatus] = useState("저장 대기");
  const [loginError, setLoginError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState("");
  const [showSubmit, setShowSubmit] = useState(false);
  const [focusWarning, setFocusWarning] = useState<number | null>(null);
  const saveTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const liveRef = useRef({ session, examState, studentState });
  const automaticSubmitStarted = useRef(false);

  useEffect(() => {
    liveRef.current = { session, examState, studentState };
  }, [session, examState, studentState]);

  const loadState = useCallback(async (activeSession: Session) => {
    const response = await fetch("/api/student/state", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(activeSession),
    });
    if (!response.ok) throw new Error("세션을 복구할 수 없습니다.");
    const data = await response.json();
    let localDrafts: Answers = {};
    try { localDrafts = JSON.parse(localStorage.getItem(`${DRAFT_KEY}-${activeSession.studentId}`) ?? "{}"); } catch { /* ignore */ }
    setAnswers({ ...data.answers, ...localDrafts });
    setQuestions(data.questions);
    if (data.resources) setResources(data.resources);
    setPublicInfo(summarizeQuestions(data.questions, data.examState));
    setExamState(data.examState);
    setStudentState(data.student);
    if (data.student.status === "active" && Number(data.student.violationCount) > 0) {
      setFocusWarning(Number(data.student.violationCount));
    }
    setConnected(true);
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      fetch("/api/exam-info").then((response) => response.ok ? response.json() : null).then((data) => { if (data) setPublicInfo(data); }).catch(() => undefined);
      const stored = localStorage.getItem(SESSION_KEY);
      if (!stored) {
        setLoading(false);
        return;
      }
      try {
        const parsed = JSON.parse(stored) as Session;
        loadState(parsed).then(() => setSession(parsed)).catch(() => {
          localStorage.removeItem(SESSION_KEY);
          setSession(null);
        }).finally(() => setLoading(false));
      } catch {
        localStorage.removeItem(SESSION_KEY);
        setLoading(false);
      }
    });
  }, [loadState]);

  const sendEvent = useCallback((eventType: string, details: Record<string, unknown> = {}, beacon = false) => {
    const live = liveRef.current;
    if (!live.session || live.studentState?.status !== "active" || live.examState?.status !== "open") return;
    const body = JSON.stringify({ ...live.session, eventType, details });
    if (beacon && navigator.sendBeacon) {
      navigator.sendBeacon("/api/student/event", new Blob([body], { type: "application/json" }));
      return;
    }
    fetch("/api/student/event", { method: "POST", headers: { "content-type": "application/json" }, body })
      .then((response) => response.json())
      .then((data) => {
        setStudentState((previous) => {
          if (!previous) return previous;
          const nextCount = Number.isFinite(Number(data.violationCount)) ? Number(data.violationCount) : previous.violationCount;
          if (data.status === "active" && nextCount > previous.violationCount) setFocusWarning(nextCount);
          return { ...previous, status: data.status ?? previous.status, violationCount: nextCount };
        });
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        sendEvent("visibility_hidden", { visibilityState: document.visibilityState }, true);
      } else {
        sendEvent("visibility_visible", { visibilityState: document.visibilityState });
      }
    };
    const onBlur = () => sendEvent("window_blur");
    const onFocus = () => sendEvent("window_focus");
    const onPageHide = () => sendEvent("pagehide", {}, true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, [sendEvent]);

  useEffect(() => {
    if (!session) return;
    const heartbeat = async () => {
      try {
        const response = await fetch("/api/student/heartbeat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(session),
        });
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (!connected) sendEvent("connection_restored");
        setConnected(true);
        setExamState(data.examState);
        setStudentState((previous) => {
          const previousCount = previous?.violationCount ?? 0;
          const nextCount = Number(data.violationCount ?? previousCount);
          if (data.status === "active" && nextCount > previousCount) setFocusWarning(nextCount);
          return previous
            ? { ...previous, status: data.status, violationCount: nextCount }
            : { status: data.status, violationCount: nextCount };
        });
      } catch {
        if (connected) sendEvent("connection_lost", {}, true);
        setConnected(false);
      }
    };
    heartbeat();
    const timer = setInterval(heartbeat, 5_000);
    return () => clearInterval(timer);
  }, [session, connected, sendEvent]);

  useEffect(() => {
    if (!examState?.endsAt) return;
    const tick = () => setRemaining(Math.max(0, Math.ceil((Date.parse(examState.endsAt as string) - Date.now()) / 1000)));
    tick();
    const timer = setInterval(tick, 1_000);
    return () => clearInterval(timer);
  }, [examState?.endsAt]);

  const saveQuestion = useCallback(async (questionId: string, value: Record<string, string>) => {
    const activeSession = liveRef.current.session;
    if (!activeSession || liveRef.current.studentState?.status !== "active") return;
    setSaveStatus("저장 중…");
    try {
      const response = await fetch("/api/student/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...activeSession, questionId, answer: value }),
      });
      if (!response.ok) throw new Error();
      setSaveStatus(`저장됨 ${new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`);
      setConnected(true);
    } catch {
      setSaveStatus("기기에 임시 저장됨");
      setConnected(false);
    }
  }, []);

  const updateAnswer = (questionId: string, field: string, value: string) => {
    setAnswers((previous) => {
      const next = { ...previous, [questionId]: { ...(previous[questionId] ?? {}), [field]: value } };
      if (session) localStorage.setItem(`${DRAFT_KEY}-${session.studentId}`, JSON.stringify(next));
      clearTimeout(saveTimers.current[questionId]);
      saveTimers.current[questionId] = setTimeout(() => saveQuestion(questionId, next[questionId]), 800);
      return next;
    });
  };

  const submitExam = useCallback(async (automatic = false) => {
    const activeSession = liveRef.current.session;
    if (!activeSession || submitting) return;
    setSubmitting(true);
    try {
      for (const question of questions) {
        clearTimeout(saveTimers.current[question.id]);
        if (answers[question.id]) await saveQuestion(question.id, answers[question.id]);
      }
      const response = await fetch("/api/student/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...activeSession, automatic }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "제출하지 못했습니다.");
      setReceipt(data.receipt);
      setStudentState((previous) => previous ? { ...previous, status: "submitted", submittedAt: data.submittedAt } : previous);
      localStorage.removeItem(`${DRAFT_KEY}-${activeSession.studentId}`);
      setShowSubmit(false);
    } catch (error) {
      alert(error instanceof Error ? error.message : "제출하지 못했습니다. 감독자에게 알려주세요.");
    } finally {
      setSubmitting(false);
    }
  }, [answers, questions, saveQuestion, submitting]);

  useEffect(() => {
    if (remaining === 0 && studentState?.status === "active" && !automaticSubmitStarted.current) {
      automaticSubmitStarted.current = true;
      submitExam(true);
    }
  }, [remaining, studentState?.status, submitExam]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/student/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ studentId: form.get("studentId"), name: form.get("name"), examCode: form.get("examCode") }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "입장하지 못했습니다.");
      const nextSession = { studentId: data.studentId, name: data.name, token: data.token };
      if (response.status === 201) localStorage.removeItem(`${DRAFT_KEY}-${data.studentId}`);
      localStorage.setItem(SESSION_KEY, JSON.stringify(nextSession));
      setSession(nextSession);
      setExamState(data.examState);
      setStudentState({ status: data.studentStatus, violationCount: 0 });
      setQuestions(data.questions);
      if (data.resources) setResources(data.resources);
      setPublicInfo(summarizeQuestions(data.questions, data.examState));
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "입장하지 못했습니다.");
    }
  }

  const completed = useMemo(() => questions.filter((question) => answerIsStarted(answers[question.id])).length, [answers, questions]);
  const current = questions[currentIndex];
  const currentGuides = resources.guides.filter((guide) => guide.part === current?.part);
  const commonReference = resources.commonReference;

  if (loading) return <main className="center-screen"><div className="loading-mark" /><p>시험 환경을 확인하고 있습니다.</p></main>;

  if (!session) {
    return (
      <main className="login-shell">
        <section className="login-intro">
          <div className="hero-brand"><img src="/codeplant/logo-mark-white.svg" alt="" /><strong>CODEPLANT</strong></div>
          {publicInfo.coverEyebrow && <div className="eyebrow">{publicInfo.coverEyebrow}</div>}
          <h1>{publicInfo.coverTitle}</h1>
          {publicInfo.coverDescription && <p>{publicInfo.coverDescription}</p>}
          <div className="score-strip"><span>{publicInfo.durationMinutes}분</span><span>총 {publicInfo.totalPoints}점</span><span>{publicInfo.questionCount}문항</span></div>
        </section>
        <section className="login-card">
          <img className="brand-logo" src="/codeplant/logo-full-light.png" alt="CODEPLANT" />
          <h2>시험 입장</h2>
          <p className="muted">감독자의 안내 후 정확한 정보를 입력하세요.</p>
          <form onSubmit={login}>
            <label>학생번호<input name="studentId" autoComplete="off" inputMode="numeric" required placeholder="예: 21017" /></label>
            <label>이름<input name="name" autoComplete="off" required placeholder="이름" /></label>
            <label>시험코드<input name="examCode" autoComplete="off" required placeholder="감독자가 안내한 코드" /></label>
            {loginError && <div className="form-error" role="alert">{loginError}</div>}
            <button className="primary-button" type="submit">입장하기</button>
          </form>
          <a className="admin-link" href="/admin">감독자 화면</a>
        </section>
      </main>
    );
  }

  if (studentState?.status === "waiting" || examState?.status === "waiting") {
    return (
      <main className="center-screen waiting-screen">
        <div className="waiting-orbit"><img className="brand-mark-large" src="/codeplant/logo-mark.svg" alt="CODEPLANT" /></div>
        <div className="eyebrow">{examState?.isTestMode ? "접속 테스트 입장 완료" : "입장 확인 완료"}</div>
        <h1>{session.name} 학생, 준비되었습니다.</h1>
        <p>감독자가 {examState?.isTestMode ? "접속 테스트" : "시험"}를 시작하면 화면이 자동으로 전환됩니다.<br />지금부터 다른 앱이나 화면으로 이동하지 마세요.</p>
        <div className="candidate-chip">{session.studentId} · {eventLabel(studentState?.status ?? "waiting")}</div>
      </main>
    );
  }

  if (studentState?.status === "submitted") {
    return (
      <main className="center-screen result-screen">
        <div className="result-icon">✓</div>
        <div className="eyebrow">{examState?.isTestMode ? "TEST COMPLETE" : "SUBMISSION COMPLETE"}</div>
        <h1>{examState?.isTestMode ? "접속 테스트가 완료되었습니다." : "답안이 안전하게 제출되었습니다."}</h1>
        <p>{session.name} 학생의 {examState?.isTestMode ? "테스트 답안" : "답안"}은 더 이상 수정할 수 없습니다.<br />감독자의 안내가 있을 때까지 이 화면을 유지하세요.</p>
        <div className="receipt">제출 확인번호 <strong>{receipt || `${examState?.isTestMode ? "TEST" : "EX"}-${session.studentId}`}</strong></div>
      </main>
    );
  }

  if (studentState?.status === "disqualified") {
    return (
      <main className="center-screen result-screen invalid-screen">
        <div className="result-icon invalid">!</div>
        <div className="eyebrow">ASSESSMENT INTERRUPTED</div>
        <h1>시험 화면 이탈이 감지되었습니다.</h1>
        <p>엄격 이탈 제한에 따라 답안 입력이 중지되었습니다.<br />기기를 조작하지 말고 즉시 감독자에게 알리세요.</p>
        <div className="receipt warning">학생번호 <strong>{session.studentId}</strong></div>
      </main>
    );
  }

  return (
    <main className="exam-shell">
      <header className="exam-header">
        <div className="exam-brand"><img className="brand-mark-small" src="/codeplant/logo-mark.svg" alt="CODEPLANT" /><div><strong>{examState?.isTestMode ? "접속 테스트" : examInfo.title}</strong><span>{session.studentId} · {session.name}</span></div></div>
        <div className="header-status">
          <span className={connected ? "online" : "offline"}>{connected ? "● 연결됨" : "● 연결 복구 중"}</span>
          <span>{saveStatus}</span>
          <div className={remaining < 600 ? "timer danger" : "timer"}><small>남은 시간</small><strong>{formatTime(remaining)}</strong></div>
        </div>
      </header>

      <div className="exam-layout">
        <aside className="question-sidebar">
          <div className="progress-copy"><strong>{completed}/{questions.length}</strong><span>작성 시작</span></div>
          <div className="progress-track"><div style={{ width: `${(completed / questions.length) * 100}%` }} /></div>
          {(["A", "B", "C"] as const).map((part) => questions.some((question) => question.part === part) && <div key={part}><div className="part-label">PART {part} · {publicInfo[`part${part}` as "partA" | "partB" | "partC"]}점</div>
          <nav aria-label={`PART ${part} 문항`}>{questions.filter((q) => q.part === part).map((q) => {
            const index = questions.findIndex((item) => item.id === q.id);
            return <button key={q.id} className={`${index === currentIndex ? "active" : ""} ${answerIsStarted(answers[q.id]) ? "started" : ""}`} onClick={() => setCurrentIndex(index)}><span>{q.number}</span><div>{q.title}<small>{q.points}점</small></div></button>;
          })}</nav></div>)}
          <button className="submit-side" onClick={() => setShowSubmit(true)}>최종 제출</button>
        </aside>

        <section className="question-workspace">
          <div className="question-kicker"><span>PART {current.part}</span><span>{current.points}점</span><span>권장 {current.estimatedMinutes}분</span></div>
          <h1><span>{current.number}.</span> <RichText text={current.title} /></h1>
          {currentGuides.map((guide, guideIndex) => (
            <details className="pseudocode-guide" key={guide.id} open={guideIndex === 0 && current.id === questions.find((question) => question.part === current.part)?.id}>
              <summary>{guide.title}</summary>
              <div className="pseudocode-guide-body">
                <ul>{guide.rules.map((rule, index) => <li key={`${index}-${rule}`}><RichText text={rule} /></li>)}</ul>
                <div className="pseudocode-examples">
                  <div className="pseudocode-example">
                    <div><strong><RichText text={guide.exampleProblem} /></strong><code>{guide.exampleData}</code></div>
                    <pre>{guide.exampleAnswer}</pre>
                  </div>
                  <div className="pseudocode-example">
                    <div><strong><RichText text={guide.elseIfExampleProblem} /></strong><code>{guide.elseIfExampleData}</code></div>
                    <pre>{guide.elseIfExampleAnswer}</pre>
                  </div>
                </div>
              </div>
            </details>
          ))}
          <div className="prompt-card">{current.prompt.map((paragraph, index) => <p key={index}><RichText text={paragraph} /></p>)}</div>
          {current.data && <pre className="data-card">{current.data}</pre>}

          {(current.showReference ?? current.part === "B") && (
            <details className="reference-panel" open={Boolean(current.showReference) && current.number === questions.find((question) => question.showReference)?.number}>
              <summary>{commonReference.title}</summary>
              <div className="reference-body">
                {commonReference.sections.map((section, sectionIndex) => <section className="reference-section" key={`${sectionIndex}-${section.heading}`}><h3><RichText text={section.heading} /></h3>{section.paragraphs.map((paragraph, paragraphIndex) => <p key={`${paragraphIndex}-${paragraph}`}><RichText text={paragraph} /></p>)}</section>)}
                {commonReference.definitions.length > 0 && <ul>{commonReference.definitions.map((definition, index) => <li key={`${index}-${definition}`}><RichText text={definition} /></li>)}</ul>}
                <CommonDataTable table={commonReference.table} />
              </div>
            </details>
          )}

          <div className="answer-section">
            <div className="answer-heading"><h2>답안 작성</h2><span>내용은 자동으로 저장됩니다.</span></div>
            {current.fields.map((field) => (
              <label className="answer-field" key={field.key}>
                <span>{field.label}</span>
                <textarea
                  className={field.kind === "code" ? "code-input" : ""}
                  rows={field.rows ?? 5}
                  value={answers[current.id]?.[field.key] ?? ""}
                  onChange={(event) => updateAnswer(current.id, field.key, event.target.value)}
                  placeholder={field.placeholder}
                  spellCheck={false}
                />
              </label>
            ))}
          </div>
          <div className="question-footer">
            <button disabled={currentIndex === 0} onClick={() => setCurrentIndex((value) => value - 1)}>← 이전 문항</button>
            <span>{currentIndex + 1} / {questions.length}</span>
            {currentIndex < questions.length - 1 ? <button onClick={() => setCurrentIndex((value) => value + 1)}>다음 문항 →</button> : <button className="primary-button compact" onClick={() => setShowSubmit(true)}>최종 제출</button>}
          </div>
        </section>
      </div>

      {showSubmit && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="submit-title"><div className="submit-modal"><div className="modal-symbol">✓</div><h2 id="submit-title">답안을 최종 제출할까요?</h2><p>작성 시작 문항은 <strong>{completed}/{questions.length}개</strong>입니다. 제출 후에는 답안을 수정할 수 없습니다.</p><div className="modal-actions"><button onClick={() => setShowSubmit(false)}>계속 작성</button><button className="primary-button compact" disabled={submitting} onClick={() => submitExam(false)}>{submitting ? "제출 중…" : "최종 제출"}</button></div></div></div>}
      {focusWarning !== null && studentState?.status === "active" && <div className="modal-backdrop" role="alertdialog" aria-modal="true" aria-labelledby="focus-warning-title"><div className="submit-modal focus-warning-modal"><div className="modal-symbol warning">!</div><h2 id="focus-warning-title">초점 이탈 경고 {focusWarning}회입니다.</h2><p>시험 화면을 벗어난 기록이 감독자에게 전송되었습니다.<br />{examState?.strictMode ? "다시 이탈하면 즉시 실격 처리됩니다." : "시험 화면을 유지해 주세요."}</p><div className="modal-actions single"><button className="primary-button compact" onClick={() => setFocusWarning(null)}>확인하고 계속 응시</button></div></div></div>}
    </main>
  );
}
