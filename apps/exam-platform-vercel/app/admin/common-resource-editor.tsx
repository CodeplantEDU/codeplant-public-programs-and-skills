"use client";

import { useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { CommonReference, ExamResources, PseudocodeGuide } from "../../lib/exam";
import { CommonDataTable } from "../common-data-table";
import { RichText } from "../rich-text";

type Props = {
  resources: ExamResources;
  savedAt: string | null;
  locked: boolean;
  busy: boolean;
  onSave: (resources: ExamResources) => Promise<boolean>;
  onReset: () => Promise<ExamResources | null>;
};

type TextControl = HTMLInputElement | HTMLTextAreaElement;

function copyResources(resources: ExamResources) {
  return JSON.parse(JSON.stringify(resources)) as ExamResources;
}

function splitLines(value: string) {
  return value.split("\n");
}

function compactResources(resources: ExamResources) {
  const next = copyResources(resources);
  next.guides = next.guides.map((guide) => ({ ...guide, rules: guide.rules.map((line) => line.trim()).filter(Boolean) }));
  next.pseudocodeGuide = next.guides[0];
  next.commonReference.definitions = next.commonReference.definitions.map((line) => line.trim()).filter(Boolean);
  next.commonReference.sections = next.commonReference.sections.map((section) => ({
    ...section,
    paragraphs: section.paragraphs.map((line) => line.trim()).filter(Boolean),
  }));
  return next;
}

function applyBold(control: TextControl, commit: (value: string) => void) {
  const start = control.selectionStart ?? 0;
  const end = control.selectionEnd ?? start;
  const value = control.value;
  const selected = value.slice(start, end);
  const wrapped = start >= 2 && value.slice(start - 2, start) === "**" && value.slice(end, end + 2) === "**";
  const next = wrapped
    ? `${value.slice(0, start - 2)}${selected}${value.slice(end + 2)}`
    : `${value.slice(0, start)}**${selected}**${value.slice(end)}`;
  commit(next);
  requestAnimationFrame(() => {
    const nextStart = wrapped ? start - 2 : start + 2;
    const nextEnd = wrapped ? end - 2 : end + 2;
    control.focus();
    control.setSelectionRange(nextStart, selected ? nextEnd : nextStart);
  });
}

function boldShortcut(event: ReactKeyboardEvent<TextControl>, commit: (value: string) => void) {
  if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "b") return;
  event.preventDefault();
  applyBold(event.currentTarget, commit);
}

export function CommonResourceEditor({ resources, savedAt, locked, busy, onSave, onReset }: Props) {
  const [draft, setDraft] = useState(() => copyResources(resources));
  const [dirty, setDirty] = useState(false);

  function changeGuide(index: number, patch: Partial<PseudocodeGuide>) {
    setDraft((current) => {
      const guides = current.guides.map((guide, guideIndex) => guideIndex === index ? { ...guide, ...patch } : guide);
      return { ...current, guides, pseudocodeGuide: guides[0] };
    });
    setDirty(true);
  }

  function addGuide(part: "A" | "B" | "C") {
    if (draft.guides.length >= 12) return;
    const partGuideNumber = draft.guides.filter((guide) => guide.part === part).length + 1;
    const nextGuide: PseudocodeGuide = {
      id: `guide-${Date.now()}`,
      part,
      name: `PART ${part} 가이드 ${partGuideNumber}`,
      adminLabel: `GUIDE ${part}`,
      adminTitle: `PART ${part} 가이드`,
      adminDescription: `학생 화면의 PART ${part} 문항에 표시됩니다.`,
      previewLabel: `PART ${part} 안내`,
      title: `PART ${part} 문제 풀이 안내`,
      rules: ["안내 내용을 입력하세요."],
      exampleProblem: "예시 문제를 입력하세요.",
      exampleData: "예시 데이터를 입력하세요.",
      exampleAnswer: "예시 답안을 입력하세요.",
      elseIfExampleProblem: "추가 예시 문제를 입력하세요.",
      elseIfExampleData: "추가 예시 데이터를 입력하세요.",
      elseIfExampleAnswer: "추가 예시 답안을 입력하세요.",
    };
    setDraft((current) => ({ ...current, guides: [...current.guides, nextGuide] }));
    setDirty(true);
  }

  function removeGuide(index: number) {
    if (draft.guides.length <= 1) return;
    setDraft((current) => {
      const guides = current.guides.filter((_, guideIndex) => guideIndex !== index);
      return { ...current, guides, pseudocodeGuide: guides[0] };
    });
    setDirty(true);
  }

  function changeReference(patch: Partial<CommonReference>) {
    setDraft((current) => ({ ...current, commonReference: { ...current.commonReference, ...patch } }));
    setDirty(true);
  }

  function changeSection(index: number, patch: Partial<CommonReference["sections"][number]>) {
    changeReference({ sections: draft.commonReference.sections.map((section, sectionIndex) => sectionIndex === index ? { ...section, ...patch } : section) });
  }

  function changeTable(table: CommonReference["table"]) {
    changeReference({ table });
  }

  function addColumn() {
    if (reference.table.columns.length >= 30) return;
    changeTable({
      columns: [...reference.table.columns, `새 열 ${reference.table.columns.length + 1}`],
      rows: reference.table.rows.map((row) => [...row, ""]),
    });
  }

  function removeColumn(index: number) {
    changeTable({
      columns: reference.table.columns.filter((_, columnIndex) => columnIndex !== index),
      rows: reference.table.rows.map((row) => row.filter((_, columnIndex) => columnIndex !== index)),
    });
  }

  function changeColumn(index: number, value: string) {
    changeTable({ ...reference.table, columns: reference.table.columns.map((column, columnIndex) => columnIndex === index ? value : column) });
  }

  function addRow() {
    const columns = reference.table.columns.length > 0 ? reference.table.columns : ["새 열 1"];
    changeTable({ columns, rows: [...reference.table.rows, columns.map(() => "")] });
  }

  function removeRow(index: number) {
    changeTable({ ...reference.table, rows: reference.table.rows.filter((_, rowIndex) => rowIndex !== index) });
  }

  function changeCell(rowIndex: number, columnIndex: number, value: string) {
    changeTable({
      ...reference.table,
      rows: reference.table.rows.map((row, currentRowIndex) => currentRowIndex === rowIndex
        ? reference.table.columns.map((_, currentColumnIndex) => currentColumnIndex === columnIndex ? value : row[currentColumnIndex] ?? "")
        : row),
    });
  }

  async function save() {
    const normalized = compactResources(draft);
    if (await onSave(normalized)) {
      setDraft(normalized);
      setDirty(false);
    }
  }

  async function reset() {
    if (!confirm("수도코드 안내와 공통자료를 이 프로젝트의 기본 내용으로 복원할까요?")) return;
    const restored = await onReset();
    if (!restored) return;
    setDraft(copyResources(restored));
    setDirty(false);
  }

  const reference = draft.commonReference;
  const savedGuides = resources.guides;
  const savedReference = resources.commonReference;

  return (
    <section className="resource-manager admin-panel">
      <div className="resource-manager-head">
        <div><div className="eyebrow">SHARED MATERIALS</div><h2>공통 학습자료 관리</h2><p>수도코드 기본 안내와 문항에서 열어 보는 공통자료를 수정합니다.</p></div>
        <div className="resource-manager-actions"><button onClick={reset} disabled={locked || busy}>기본 자료 복원</button><button className="primary-button compact" onClick={save} disabled={locked || busy || !dirty}>{busy ? "저장 중…" : dirty ? "공통자료 저장" : "최종본 저장됨"}</button></div>
      </div>
      {locked && <div className="question-lock-notice">공통자료 편집이 잠겨 있습니다. 시험을 종료하고 답안을 백업한 뒤 ‘새 시험 초기화’를 실행하면 편집할 수 있습니다.</div>}
      <div className="resource-manager-body">
        <div className="resource-editor-stack">
          <div className="resource-guide-toolbar"><div><strong>문항 가이드</strong><span>PART A·B·C를 나누어 관리하며, 각 PART에 필요한 가이드를 따로 추가할 수 있습니다.</span></div><span className="resource-guide-count">전체 {draft.guides.length}/12개</span></div>
          {(["A", "B", "C"] as const).map((part) => {
            const partGuides = draft.guides.map((guide, index) => ({ guide, index })).filter(({ guide }) => guide.part === part);
            return <section className="resource-part-guides" key={part}>
              <div className="resource-part-guides-head"><div><span>PART {part}</span><strong>PART {part} 가이드</strong><small>{partGuides.length}개 등록됨</small></div><button onClick={() => addGuide(part)} disabled={locked || busy || draft.guides.length >= 12}>PART {part} 가이드 추가</button></div>
              {partGuides.length === 0 && <div className="resource-guide-empty">PART {part}에 표시할 가이드가 없습니다. ‘PART {part} 가이드 추가’를 눌러 만드세요.</div>}
              {partGuides.map(({ guide, index: guideIndex }) => <article className="resource-edit-card" key={guide.id}>
            <header><div><span>{guide.adminLabel}</span><h3>{guide.name}</h3></div><p>{guide.adminDescription}</p></header>
            <div className="resource-example-grid">
              <label>표시할 PART<select value={guide.part} disabled={locked} onChange={(event) => changeGuide(guideIndex, { part: event.target.value as "A" | "B" | "C" })}><option value="A">PART A</option><option value="B">PART B</option><option value="C">PART C</option></select></label>
              <label>가이드 관리 이름<input value={guide.name} disabled={locked} onChange={(event) => changeGuide(guideIndex, { name: event.target.value })} /></label>
              <label>관리자 카드 라벨<input value={guide.adminLabel} disabled={locked} onChange={(event) => changeGuide(guideIndex, { adminLabel: event.target.value })} /></label>
              <label>관리자 카드 제목<input value={guide.adminTitle} disabled={locked} onChange={(event) => changeGuide(guideIndex, { adminTitle: event.target.value })} /></label>
              <label>오른쪽 최종본 구역 이름<input value={guide.previewLabel} disabled={locked} onChange={(event) => changeGuide(guideIndex, { previewLabel: event.target.value })} /></label>
              <label className="resource-span-all">관리자 카드 설명<input value={guide.adminDescription} disabled={locked} onChange={(event) => changeGuide(guideIndex, { adminDescription: event.target.value })} /></label>
            </div>
            <label>학생용 가이드 제목<input value={guide.title} disabled={locked} onChange={(event) => changeGuide(guideIndex, { title: event.target.value })} /></label>
            <label>기본 설명 <small>한 줄에 한 항목씩 입력합니다. Ctrl+B로 중요한 부분을 굵게 표시할 수 있습니다.</small><textarea rows={8} value={guide.rules.join("\n")} disabled={locked} onKeyDown={(event) => boldShortcut(event, (value) => changeGuide(guideIndex, { rules: splitLines(value) }))} onChange={(event) => changeGuide(guideIndex, { rules: splitLines(event.target.value) })} /></label>
            <div className="resource-example-grid">
              <label>연습 문제<input value={guide.exampleProblem} disabled={locked} onChange={(event) => changeGuide(guideIndex, { exampleProblem: event.target.value })} /></label>
              <label>연습 데이터<textarea rows={3} className="code-editor" value={guide.exampleData} disabled={locked} onChange={(event) => changeGuide(guideIndex, { exampleData: event.target.value })} /></label>
              <label className="resource-span-all">연습 답안<textarea rows={9} className="code-editor" value={guide.exampleAnswer} disabled={locked} onChange={(event) => changeGuide(guideIndex, { exampleAnswer: event.target.value })} /></label>
              <label>추가 설명·문제<input value={guide.elseIfExampleProblem} disabled={locked} onChange={(event) => changeGuide(guideIndex, { elseIfExampleProblem: event.target.value })} /></label>
              <label>추가 데이터<textarea rows={3} className="code-editor" value={guide.elseIfExampleData} disabled={locked} onChange={(event) => changeGuide(guideIndex, { elseIfExampleData: event.target.value })} /></label>
              <label className="resource-span-all">추가 예시 답안<textarea rows={9} className="code-editor" value={guide.elseIfExampleAnswer} disabled={locked} onChange={(event) => changeGuide(guideIndex, { elseIfExampleAnswer: event.target.value })} /></label>
            </div>
            <button className="resource-delete" onClick={() => removeGuide(guideIndex)} disabled={locked || draft.guides.length <= 1}>가이드 삭제</button>
              </article>)}
            </section>;
          })}

          <article className="resource-edit-card">
            <header><div><span>COMMON MATERIAL</span><h3>공통자료</h3></div><p>문항의 ‘공통자료 표시’ 토글을 켜면 학생에게 보입니다.</p></header>
            <label>공통자료 제목<input value={reference.title} disabled={locked} onChange={(event) => changeReference({ title: event.target.value })} /></label>
            <section className="resource-edit-group">
              <div className="resource-edit-group-head"><div><h4>본문 구역</h4><p>초록·연구 방법·결론처럼 필요한 구역을 자유롭게 구성합니다.</p></div><button onClick={() => changeReference({ sections: [...reference.sections, { heading: "새 구역", paragraphs: ["내용을 입력하세요."] }] })} disabled={locked || busy || reference.sections.length >= 20}>구역 추가</button></div>
              {reference.sections.map((section, index) => <article className="resource-section-editor" key={index}>
                <span>{index + 1}</span>
                <label>구역 제목<input value={section.heading} disabled={locked} onChange={(event) => changeSection(index, { heading: event.target.value })} /></label>
                <label>본문 <small>문단마다 줄을 바꿉니다.</small><textarea rows={6} value={section.paragraphs.join("\n")} disabled={locked} onKeyDown={(event) => boldShortcut(event, (value) => changeSection(index, { paragraphs: splitLines(value) }))} onChange={(event) => changeSection(index, { paragraphs: splitLines(event.target.value) })} /></label>
                <button className="resource-delete" onClick={() => changeReference({ sections: reference.sections.filter((_, sectionIndex) => sectionIndex !== index) })} disabled={locked}>구역 삭제</button>
              </article>)}
            </section>
            <label>용어 설명 <small>한 줄에 한 항목씩 입력하며, 필요 없으면 비워둘 수 있습니다.</small><textarea rows={6} value={reference.definitions.join("\n")} disabled={locked} onKeyDown={(event) => boldShortcut(event, (value) => changeReference({ definitions: splitLines(value) }))} onChange={(event) => changeReference({ definitions: splitLines(event.target.value) })} /></label>
            <section className="resource-edit-group">
              <div className="resource-edit-group-head"><div><h4>자유 형식 표</h4><p>열 제목과 모든 셀을 직접 수정하고, 행과 열을 각각 추가·삭제할 수 있습니다.</p></div><div className="resource-table-actions"><button onClick={addColumn} disabled={locked || busy || reference.table.columns.length >= 30}>열 추가</button><button onClick={addRow} disabled={locked || busy || reference.table.rows.length >= 100}>행 추가</button></div></div>
              {reference.table.columns.length === 0 ? <div className="resource-table-empty"><strong>표를 사용하지 않습니다.</strong><span>‘열 추가’ 또는 ‘행 추가’를 누르면 새 표가 만들어집니다.</span></div> : <div className="resource-table-editor">
                <table>
                  <thead><tr><th className="resource-row-number">행</th>{reference.table.columns.map((column, columnIndex) => <th key={columnIndex}><div className="resource-column-editor"><input aria-label={`${columnIndex + 1}열 제목`} value={column} disabled={locked} onKeyDown={(event) => boldShortcut(event, (value) => changeColumn(columnIndex, value))} onChange={(event) => changeColumn(columnIndex, event.target.value)} /><button aria-label={`${columnIndex + 1}열 삭제`} title={`${columnIndex + 1}열 삭제`} onClick={() => removeColumn(columnIndex)} disabled={locked}>열 삭제</button></div></th>)}<th className="resource-row-action">삭제</th></tr></thead>
                  <tbody>{reference.table.rows.map((row, rowIndex) => <tr key={rowIndex}><th scope="row" className="resource-row-number">{rowIndex + 1}</th>{reference.table.columns.map((_, columnIndex) => <td key={columnIndex}><textarea aria-label={`${rowIndex + 1}행 ${columnIndex + 1}열`} rows={2} value={row[columnIndex] ?? ""} disabled={locked} onKeyDown={(event) => boldShortcut(event, (value) => changeCell(rowIndex, columnIndex, value))} onChange={(event) => changeCell(rowIndex, columnIndex, event.target.value)} /></td>)}<td className="resource-row-action"><button aria-label={`${rowIndex + 1}행 삭제`} onClick={() => removeRow(rowIndex)} disabled={locked}>행 삭제</button></td></tr>)}</tbody>
                </table>
              </div>}
            </section>
          </article>
        </div>

        <aside className="resource-final-panel">
          <header><div><div className="eyebrow">SAVED VERSION</div><h3>저장된 최종본</h3></div><span className={dirty ? "draft-dirty" : "saved-current"}>{dirty ? "저장 전 변경 있음" : "저장된 상태"}</span></header>
          <div className="final-saved-time"><span>마지막 공통자료 저장</span><strong>{savedAt ? new Date(savedAt).toLocaleString("ko-KR") : "기록 없음"}</strong></div>
          {savedGuides.map((savedGuide) => <article className="resource-saved-preview" key={savedGuide.id}>
            <span>PART {savedGuide.part} · {savedGuide.name}</span><h4><RichText text={savedGuide.title} /></h4><small>{savedGuide.previewLabel}</small>
            <ul>{savedGuide.rules.map((rule, index) => <li key={`${index}-${rule}`}><RichText text={rule} /></li>)}</ul>
            <div className="saved-code-example"><strong><RichText text={savedGuide.exampleProblem} /></strong><code>{savedGuide.exampleData}</code><pre>{savedGuide.exampleAnswer}</pre></div>
            <div className="saved-code-example"><strong><RichText text={savedGuide.elseIfExampleProblem} /></strong><code>{savedGuide.elseIfExampleData}</code><pre>{savedGuide.elseIfExampleAnswer}</pre></div>
          </article>)}
          <article className="resource-saved-preview common-preview">
            <span>공통자료</span><h4><RichText text={savedReference.title} /></h4>
            {savedReference.sections.map((section, index) => <section key={`${index}-${section.heading}`}><h5><RichText text={section.heading} /></h5>{section.paragraphs.map((paragraph, paragraphIndex) => <p key={`${paragraphIndex}-${paragraph}`}><RichText text={paragraph} /></p>)}</section>)}
            {savedReference.definitions.length > 0 && <ul>{savedReference.definitions.map((definition, index) => <li key={`${index}-${definition}`}><RichText text={definition} /></li>)}</ul>}
            <CommonDataTable table={savedReference.table} />
          </article>
        </aside>
      </div>
    </section>
  );
}
