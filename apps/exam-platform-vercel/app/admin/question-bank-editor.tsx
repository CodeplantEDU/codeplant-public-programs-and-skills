"use client";

import { useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { AnswerField, ExamQuestion, RubricElement } from "../../lib/exam";
import { RichText } from "../rich-text";

type Props = {
  questions: ExamQuestion[];
  savedAt: string | null;
  locked: boolean;
  busy: boolean;
  onSave: (questions: ExamQuestion[]) => Promise<boolean>;
  onReset: () => Promise<ExamQuestion[] | null>;
};

type BoldControl = HTMLInputElement | HTMLTextAreaElement;

function applyBold(control: BoldControl, commit: (value: string) => void) {
  const start = control.selectionStart ?? 0;
  const end = control.selectionEnd ?? start;
  const value = control.value;
  const selected = value.slice(start, end);
  const wrapped = start >= 2 && value.slice(start - 2, start) === "**" && value.slice(end, end + 2) === "**";
  const next = wrapped
    ? `${value.slice(0, start - 2)}${selected}${value.slice(end + 2)}`
    : `${value.slice(0, start)}**${selected}**${value.slice(end)}`;
  const nextStart = wrapped ? start - 2 : start + 2;
  const nextEnd = wrapped ? end - 2 : end + 2;
  commit(next);
  requestAnimationFrame(() => {
    control.focus();
    control.setSelectionRange(nextStart, selected ? nextEnd : nextStart);
  });
}

function isBoldShortcut(event: ReactKeyboardEvent<BoldControl>) {
  return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b";
}

function copyQuestions(questions: ExamQuestion[]) {
  return JSON.parse(JSON.stringify(questions)) as ExamQuestion[];
}

function newQuestion(existing: ExamQuestion[]): ExamQuestion {
  let suffix = existing.length + 1;
  let id = `q${suffix}`;
  while (existing.some((question) => question.id === id)) id = `q${++suffix}`;
  return {
    id,
    number: existing.length + 1,
    part: "A",
    title: "새 문항",
    points: 10,
    estimatedMinutes: 10,
    showReference: false,
    prompt: ["문제 내용을 입력하세요."],
    fields: [{ key: "answer", label: "답안", placeholder: "답안을 입력하세요.", rows: 6, kind: "text" }],
    rubric: [{ id: `${id}_r1`, points: 10, criterion: "채점 기준을 입력하세요." }],
  };
}

export function QuestionBankEditor({ questions, savedAt, locked, busy, onSave, onReset }: Props) {
  const [draft, setDraft] = useState(() => copyQuestions(questions));
  const [selectedId, setSelectedId] = useState(questions[0]?.id ?? "");
  const [dirty, setDirty] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  const selectedIndex = Math.max(0, draft.findIndex((question) => question.id === selectedId));
  const selected = draft[selectedIndex];
  const savedQuestion = questions.find((question) => question.id === selected?.id) ?? null;
  const totalPoints = useMemo(() => draft.reduce((sum, question) => sum + Number(question.points || 0), 0), [draft]);
  const totalMinutes = useMemo(() => draft.reduce((sum, question) => sum + Number(question.estimatedMinutes || 0), 0), [draft]);

  function changeQuestion(patch: Partial<ExamQuestion>) {
    setDraft((current) => current.map((question, index) => index === selectedIndex ? { ...question, ...patch } : question));
    setDirty(true);
  }

  function changeField(fieldIndex: number, patch: Partial<AnswerField>) {
    if (!selected) return;
    changeQuestion({ fields: selected.fields.map((field, index) => index === fieldIndex ? { ...field, ...patch } : field) });
  }

  function changeRubric(rubricIndex: number, patch: Partial<RubricElement>) {
    if (!selected) return;
    changeQuestion({ rubric: selected.rubric.map((item, index) => index === rubricIndex ? { ...item, ...patch } : item) });
  }

  function addQuestion() {
    const question = newQuestion(draft);
    setDraft((current) => [...current, question]);
    setSelectedId(question.id);
    setDirty(true);
  }

  function removeQuestion() {
    if (!selected || draft.length === 1 || !confirm(`${selected.number}번 문항을 삭제할까요?`)) return;
    const next = draft.filter((question) => question.id !== selected.id).map((question, index) => ({ ...question, number: index + 1 }));
    setDraft(next);
    setSelectedId(next[Math.min(selectedIndex, next.length - 1)].id);
    setDirty(true);
  }

  function moveQuestion(offset: number) {
    const target = selectedIndex + offset;
    if (target < 0 || target >= draft.length) return;
    const next = [...draft];
    [next[selectedIndex], next[target]] = [next[target], next[selectedIndex]];
    setDraft(next.map((question, index) => ({ ...question, number: index + 1 })));
    setDirty(true);
  }

  async function save() {
    const normalized = draft.map((question, index) => ({ ...question, number: index + 1 }));
    if (await onSave(normalized)) setDirty(false);
  }

  function changePrompt(value: string) {
    changeQuestion({ prompt: value.split("\n").filter((line) => line.trim()) });
  }

  function handlePromptShortcut(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
    if (!isBoldShortcut(event)) return;
    event.preventDefault();
    applyBold(event.currentTarget, changePrompt);
  }

  async function reset() {
    if (!confirm("현재 문항을 모두 지우고 이 프로젝트의 기본 문항으로 복원할까요?")) return;
    const restored = await onReset();
    if (restored) {
      setDraft(copyQuestions(restored));
      setSelectedId(restored[0]?.id ?? "");
      setDirty(false);
    }
  }

  return (
    <section className="question-manager admin-panel">
      <div className="question-manager-head">
        <div><div className="eyebrow">QUESTION BANK</div><h2>시험 문항 관리</h2><p>왼쪽에서 문항을 수정하고 프로젝트를 저장하면 오른쪽 최종본에 기록됩니다.</p></div>
        <div className="question-summary"><span><strong>{draft.length}</strong>문항</span><span><strong>{totalPoints}</strong>점</span><span><strong>{totalMinutes}</strong>분</span></div>
      </div>
      {locked && <div className="question-lock-notice">문항 편집이 잠겨 있습니다. 시험을 종료하고 답안을 백업한 뒤 ‘새 시험 초기화’를 실행하면 편집할 수 있습니다.</div>}
      <div className="question-manager-body">
        <aside className="question-bank-list">
          <div className="question-bank-actions"><button onClick={addQuestion} disabled={locked || busy}>새 문항</button><button onClick={reset} disabled={locked || busy}>기본 복원</button></div>
          <nav aria-label="시험 문항 목록">{draft.map((question) => <button key={question.id} className={question.id === selected?.id ? "active" : ""} onClick={() => setSelectedId(question.id)}><span>{question.number}</span><div><strong><RichText text={question.title} /></strong><small>PART {question.part} · {question.points}점</small></div></button>)}</nav>
        </aside>
        {selected && <div className="question-editor">
          <div className="question-editor-toolbar">
            <div><button onClick={() => moveQuestion(-1)} disabled={locked || busy || selectedIndex === 0}>위로</button><button onClick={() => moveQuestion(1)} disabled={locked || busy || selectedIndex === draft.length - 1}>아래로</button><button className="delete-question" onClick={removeQuestion} disabled={locked || busy || draft.length === 1}>문항 삭제</button></div>
            <button className="primary-button compact project-save-button" onClick={save} disabled={locked || busy || !dirty}>{busy ? "저장 중…" : dirty ? "프로젝트 저장" : "최종본 저장됨"}</button>
          </div>
          <div className="question-form-grid">
            <label>문항 ID<input value={selected.id} disabled={locked} onChange={(event) => { const id = event.target.value; changeQuestion({ id, rubric: selected.rubric.map((item, index) => ({ ...item, id: item.id || `${id}_r${index + 1}` })) }); setSelectedId(id); }} /></label>
            <label>PART<select value={selected.part} disabled={locked} onChange={(event) => changeQuestion({ part: event.target.value as "A" | "B" | "C" })}><option value="A">PART A</option><option value="B">PART B</option><option value="C">PART C</option></select></label>
            <label>배점<input type="number" min="1" max="1000" value={selected.points} disabled={locked} onChange={(event) => changeQuestion({ points: Number(event.target.value) })} /></label>
            <label>권장 시간(분)<input type="number" min="1" max="180" value={selected.estimatedMinutes} disabled={locked} onChange={(event) => changeQuestion({ estimatedMinutes: Number(event.target.value) })} /></label>
          </div>
          <label className="question-wide-field">문항 제목 <small>문항 제목은 학생 화면과 최종본에서 자동으로 굵게 표시됩니다.</small><input value={selected.title} disabled={locked} onChange={(event) => changeQuestion({ title: event.target.value })} /></label>
          <label className="question-wide-field">문제 내용 <small>문단마다 줄을 바꿔 입력하세요. 강조할 글자를 선택하고 Ctrl+B를 누르면 굵게 표시됩니다.</small><div className="rich-text-toolbar"><button type="button" onClick={() => promptRef.current && applyBold(promptRef.current, changePrompt)} disabled={locked || busy}><strong>B</strong> 굵게</button><span>선택 영역에 **굵게** 표시를 적용합니다.</span></div><textarea ref={promptRef} rows={10} value={selected.prompt.join("\n")} disabled={locked} onKeyDown={handlePromptShortcut} onChange={(event) => changePrompt(event.target.value)} /></label>
          <label className="question-wide-field">제시 데이터 <small>표·코드·숫자 자료가 없으면 비워두세요.</small><textarea className="code-editor" rows={6} value={selected.data ?? ""} disabled={locked} onChange={(event) => changeQuestion({ data: event.target.value })} /></label>
          <label className="reference-toggle"><input aria-label="공통자료 표시" type="checkbox" checked={Boolean(selected.showReference)} disabled={locked} onChange={(event) => changeQuestion({ showReference: event.target.checked })} /><span className="toggle-switch" aria-hidden="true"><span /></span><span className="toggle-copy"><strong>공통자료 표시</strong><small>이 문항을 풀 때 설정한 공통자료를 함께 보여줍니다.</small></span></label>

          <section className="editor-subsection">
            <div className="editor-subsection-head"><div><h3>답안 입력란</h3><p>학생에게 표시할 작성 칸을 구성합니다.</p></div><button onClick={() => changeQuestion({ fields: [...selected.fields, { key: `answer${selected.fields.length + 1}`, label: `답안 ${selected.fields.length + 1}`, placeholder: "답안을 입력하세요.", rows: 5, kind: "text" }] })} disabled={locked || busy || selected.fields.length >= 10}>입력란 추가</button></div>
            <div className="editor-item-list">{selected.fields.map((field, index) => <article key={`${field.key}-${index}`}>
              <div className="editor-item-index">{index + 1}</div>
              <label>답안 키<input value={field.key} disabled={locked} onChange={(event) => changeField(index, { key: event.target.value })} /></label>
              <label>제목<input value={field.label} disabled={locked} onChange={(event) => changeField(index, { label: event.target.value })} /></label>
              <label>형식<select value={field.kind ?? "text"} disabled={locked} onChange={(event) => changeField(index, { kind: event.target.value as "text" | "code" })}><option value="text">일반 글</option><option value="code">코드</option></select></label>
              <label>줄 수<input type="number" min="2" max="30" value={field.rows ?? 5} disabled={locked} onChange={(event) => changeField(index, { rows: Number(event.target.value) })} /></label>
              <label className="item-placeholder">안내 문구<input value={field.placeholder} disabled={locked} onChange={(event) => changeField(index, { placeholder: event.target.value })} /></label>
              <button className="remove-editor-item" onClick={() => changeQuestion({ fields: selected.fields.filter((_, itemIndex) => itemIndex !== index) })} disabled={locked || selected.fields.length === 1}>삭제</button>
            </article>)}</div>
          </section>

          <section className="editor-subsection">
            <div className="editor-subsection-head"><div><h3>채점 기준</h3><p>PDF·JSON 백업에 함께 저장되는 평가 기준입니다.</p></div><button onClick={() => changeQuestion({ rubric: [...selected.rubric, { id: `${selected.id}_r${selected.rubric.length + 1}`, points: 0, criterion: "" }] })} disabled={locked || busy || selected.rubric.length >= 30}>기준 추가</button></div>
            <div className="rubric-editor-list">{selected.rubric.map((item, index) => <article key={`${item.id}-${index}`}><span>{index + 1}</span><label>배점<input type="number" min="0" max="1000" value={item.points} disabled={locked} onChange={(event) => changeRubric(index, { points: Number(event.target.value) })} /></label><label>평가 기준<input value={item.criterion} disabled={locked} onChange={(event) => changeRubric(index, { criterion: event.target.value })} /></label><button onClick={() => changeQuestion({ rubric: selected.rubric.filter((_, itemIndex) => itemIndex !== index) })} disabled={locked}>삭제</button></article>)}</div>
          </section>
        </div>}
        <aside className="question-final-panel" aria-live="polite">
          <header><div><div className="eyebrow">FINAL VERSION</div><h3>최종본</h3></div><span className={dirty ? "draft-dirty" : "saved-current"}>{dirty ? "저장 전 변경 있음" : "저장된 상태"}</span></header>
          <p className="final-panel-help">‘프로젝트 저장’을 누른 시점의 학생용 문항입니다.</p>
          <div className="final-saved-time"><span>마지막 프로젝트 저장</span><strong>{savedAt ? new Date(savedAt).toLocaleString("ko-KR") : "기록 없음"}</strong></div>
          {savedQuestion ? <article className="final-question-preview">
            <div className="final-question-meta"><span>PART {savedQuestion.part}</span><span>{savedQuestion.points}점</span><span>권장 {savedQuestion.estimatedMinutes}분</span></div>
            <h4><span>{savedQuestion.number}.</span> <RichText text={savedQuestion.title} /></h4>
            <div className="final-prompt-preview">{savedQuestion.prompt.map((paragraph, index) => <p key={`${index}-${paragraph}`}><RichText text={paragraph} /></p>)}</div>
            {savedQuestion.data && <pre>{savedQuestion.data}</pre>}
            <div className="final-answer-preview"><strong>답안 작성 영역</strong>{savedQuestion.fields.map((field) => <div key={field.key}><span><RichText text={field.label} /></span><small>{field.rows ?? 5}줄 · {field.kind === "code" ? "코드" : "일반 글"}</small></div>)}</div>
          </article> : <div className="final-preview-empty">아직 저장되지 않은 새 문항입니다.<br />프로젝트를 저장하면 최종본에 표시됩니다.</div>}
        </aside>
      </div>
    </section>
  );
}

