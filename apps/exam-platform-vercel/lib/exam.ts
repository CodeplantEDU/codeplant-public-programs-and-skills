export type AnswerField = {
  key: string;
  label: string;
  placeholder: string;
  rows?: number;
  kind?: "text" | "code";
};

export type RubricElement = { id: string; points: number; criterion: string };

export type ExamQuestion = {
  id: string;
  number: number;
  part: "A" | "B" | "C";
  title: string;
  points: number;
  estimatedMinutes: number;
  showReference?: boolean;
  prompt: string[];
  data?: string;
  fields: AnswerField[];
  rubric: RubricElement[];
};

export type PseudocodeGuide = {
  id: string;
  part: "A" | "B" | "C";
  name: string;
  adminLabel: string;
  adminTitle: string;
  adminDescription: string;
  previewLabel: string;
  title: string;
  rules: string[];
  exampleProblem: string;
  exampleData: string;
  exampleAnswer: string;
  elseIfExampleProblem: string;
  elseIfExampleData: string;
  elseIfExampleAnswer: string;
};

export type CommonReference = {
  title: string;
  sections: Array<{ heading: string; paragraphs: string[] }>;
  definitions: string[];
  table: { columns: string[]; rows: string[][] };
};

export type ExamResources = { guides: PseudocodeGuide[]; pseudocodeGuide: PseudocodeGuide; commonReference: CommonReference };

function requiredText(value: unknown, label: string, max: number) {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label}을(를) 입력하세요.`);
  return text.slice(0, max);
}

function boundedInteger(value: unknown, label: string, min: number, max: number) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`${label}은(는) ${min}~${max} 사이의 정수여야 합니다.`);
  return number;
}

function textList(value: unknown, label: string, maxItems: number, maxLength: number) {
  if (!Array.isArray(value) || value.length > maxItems) throw new Error(`${label}은(는) ${maxItems}개까지 저장할 수 있습니다.`);
  return value.map((item) => String(item ?? "").trim().slice(0, maxLength)).filter(Boolean);
}

export function normalizeQuestionBank(value: unknown): ExamQuestion[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) throw new Error("문항은 1~50개까지 저장할 수 있습니다.");
  const ids = new Set<string>();
  return value.map((raw, index) => {
    const source = (raw ?? {}) as Record<string, unknown>;
    const id = requiredText(source.id, `${index + 1}번 문항 ID`, 40).replace(/[^0-9A-Za-z_-]/g, "");
    if (!id || ids.has(id)) throw new Error(`${index + 1}번 문항 ID를 서로 다르게 입력하세요.`);
    ids.add(id);
    const part = source.part === "C" ? "C" : source.part === "B" ? "B" : source.part === "A" ? "A" : null;
    if (!part) throw new Error(`${index + 1}번 문항의 PART를 선택하세요.`);
    if (!Array.isArray(source.prompt) || source.prompt.length < 1 || source.prompt.length > 20) throw new Error(`${index + 1}번 문항의 문제 문장은 1~20개로 입력하세요.`);
    if (!Array.isArray(source.fields) || source.fields.length < 1 || source.fields.length > 10) throw new Error(`${index + 1}번 문항의 답안 입력란은 1~10개로 설정하세요.`);
    const fieldKeys = new Set<string>();
    const fields = source.fields.map((rawField, fieldIndex) => {
      const field = (rawField ?? {}) as Record<string, unknown>;
      const key = requiredText(field.key, `${index + 1}번 문항 답안 키`, 40).replace(/[^0-9A-Za-z_-]/g, "");
      if (!key || fieldKeys.has(key)) throw new Error(`${index + 1}번 문항의 답안 키를 서로 다르게 입력하세요.`);
      fieldKeys.add(key);
      return { key, label: requiredText(field.label, `${index + 1}번 문항 답안 제목`, 120), placeholder: String(field.placeholder ?? "").trim().slice(0, 500), rows: boundedInteger(field.rows ?? 5, `${fieldIndex + 1}번째 답안 줄 수`, 2, 30), kind: field.kind === "code" ? "code" as const : "text" as const };
    });
    const rubricSource = Array.isArray(source.rubric) ? source.rubric : [];
    if (rubricSource.length > 30) throw new Error("채점 기준은 문항당 30개까지 저장할 수 있습니다.");
    const rubric = rubricSource.map((rawRubric, rubricIndex) => {
      const item = (rawRubric ?? {}) as Record<string, unknown>;
      return { id: String(item.id ?? `${id}_r${rubricIndex + 1}`).replace(/[^0-9A-Za-z_-]/g, "").slice(0, 60), points: boundedInteger(item.points ?? 0, "채점 기준 배점", 0, 1000), criterion: requiredText(item.criterion, "채점 기준", 1000) };
    });
    return { id, number: index + 1, part, title: requiredText(source.title, `${index + 1}번 문항 제목`, 200), points: boundedInteger(source.points, `${index + 1}번 문항 배점`, 1, 1000), estimatedMinutes: boundedInteger(source.estimatedMinutes, `${index + 1}번 문항 권장 시간`, 1, 180), showReference: Boolean(source.showReference ?? part === "B"), prompt: source.prompt.map((line) => requiredText(line, "문제 문장", 3000)), data: String(source.data ?? "").trim().slice(0, 10_000) || undefined, fields, rubric };
  });
}

function normalizeTable(source: Record<string, unknown>) {
  const table = (source.table ?? {}) as Record<string, unknown>;
  const columns = textList(table.columns, "표 열", 30, 200);
  const rowsRaw = Array.isArray(table.rows) ? table.rows.slice(0, 100) : [];
  return { columns, rows: rowsRaw.map((row) => columns.map((_, index) => String((Array.isArray(row) ? row[index] : "") ?? "").slice(0, 2000))) };
}

export function normalizeExamResources(value: unknown): ExamResources {
  if (!value || typeof value !== "object") throw new Error("공통 학습자료 형식이 올바르지 않습니다.");
  const source = value as Record<string, unknown>;
  const legacyGuide = (source.pseudocodeGuide ?? {}) as Record<string, unknown>;
  const guideSources = Array.isArray(source.guides) && source.guides.length > 0 ? source.guides : [legacyGuide];
  if (guideSources.length > 12) throw new Error("가이드는 12개까지 저장할 수 있습니다.");
  const reference = (source.commonReference ?? {}) as Record<string, unknown>;
  const sections = reference.sections;
  if (!Array.isArray(sections) || sections.length > 20) throw new Error("공통자료 본문 구역은 20개까지 저장할 수 있습니다.");
  const guides = guideSources.map((raw, index) => {
    const guide = (raw ?? {}) as Record<string, unknown>;
    const part = guide.part === "C" ? "C" : guide.part === "B" ? "B" : "A";
    const fallbackId = `guide-${part.toLowerCase()}-${index + 1}`;
    return {
      id: String(guide.id ?? fallbackId).trim().replace(/[^0-9A-Za-z_-]/g, "").slice(0, 60) || fallbackId,
      part,
      name: String(guide.name ?? guide.adminTitle ?? `PART ${part} 가이드`).trim().slice(0, 200) || `PART ${part} 가이드`,
      adminLabel: String(guide.adminLabel ?? "GUIDE").trim().slice(0, 80) || "GUIDE",
      adminTitle: String(guide.adminTitle ?? "수도코드 기본 안내").trim().slice(0, 200) || "수도코드 기본 안내",
      adminDescription: String(guide.adminDescription ?? "학생 화면의 PART A 상단에 표시됩니다.").trim().slice(0, 500),
      previewLabel: String(guide.previewLabel ?? "수도코드 안내").trim().slice(0, 120) || "수도코드 안내",
      title: requiredText(guide.title, "수도코드 안내 제목", 200),
      rules: textList(guide.rules, "수도코드 기본 설명", 30, 1000),
      exampleProblem: requiredText(guide.exampleProblem, "수도코드 연습 문제", 500),
      exampleData: String(guide.exampleData ?? "").trim().slice(0, 3000),
      exampleAnswer: requiredText(guide.exampleAnswer, "수도코드 연습 답안", 10_000),
      elseIfExampleProblem: requiredText(guide.elseIfExampleProblem, "ELSE IF 예시 문제", 500),
      elseIfExampleData: String(guide.elseIfExampleData ?? "").trim().slice(0, 3000),
      elseIfExampleAnswer: requiredText(guide.elseIfExampleAnswer, "ELSE IF 예시 답안", 10_000),
    } satisfies PseudocodeGuide;
  });
  return {
    guides,
    pseudocodeGuide: guides[0],
    commonReference: {
      title: requiredText(reference.title, "공통자료 제목", 300),
      sections: sections.map((raw, index) => { const section = (raw ?? {}) as Record<string, unknown>; return { heading: requiredText(section.heading, `${index + 1}번째 구역 제목`, 200), paragraphs: textList(section.paragraphs, `${index + 1}번째 본문`, 20, 5000) }; }),
      definitions: textList(reference.definitions, "용어 설명", 30, 2000),
      table: normalizeTable(reference),
    },
  };
}

export const examInfo = {
  title: "CODEPLANT 예시 시험", subtitle: "직접 수정하여 사용하는 공개용 예시 프로젝트", coverEyebrow: "CODEPLANT EXAM PLATFORM · DEMO", coverTitle: "예시 시험\n프로젝트", coverDescription: "실제 평가 문항이 아닌 기능 체험용 예시입니다.", durationMinutes: 30, totalPoints: 30, partA: 20, partB: 10,
  notice: ["이 프로젝트의 문항과 자료는 공개 배포를 위한 예시입니다.", "실제 운영 전 접속 테스트를 진행하세요."],
};

export const pseudocodeGuide: PseudocodeGuide = {
  id: "guide-a-1", part: "A",
  name: "PART A 수도코드 안내",
  adminLabel: "GUIDE", adminTitle: "수도코드 기본 안내", adminDescription: "학생 화면의 PART A 상단에 표시됩니다.", previewLabel: "수도코드 안내", title: "수도코드 작성 안내 · 연습 예시",
  rules: ["←는 오른쪽 값을 왼쪽 변수에 저장한다는 뜻입니다.", "IF / ELSE / END IF는 조건을, FOR EACH / END FOR는 반복을 나타냅니다.", "ELSE IF는 앞 조건이 거짓일 때 다음 조건을 검사합니다."],
  exampleProblem: "연습: DATA에서 3 이상인 값의 개수를 구하시오.", exampleData: "DATA = [1, 4, 2, 5]", exampleAnswer: "COUNT ← 0\nFOR EACH VALUE IN DATA\n    IF VALUE ≥ 3\n        COUNT ← COUNT + 1\n    END IF\nEND FOR\nOUTPUT COUNT",
  elseIfExampleProblem: "ELSE IF 연습: 값이 짝수인지, 아니면 5보다 큰지 확인하시오.", elseIfExampleData: "VALUE = 7", elseIfExampleAnswer: "IF VALUE를 2로 나눈 나머지가 0\n    OUTPUT \"짝수\"\nELSE IF VALUE > 5\n    OUTPUT \"5보다 큰 홀수\"\nELSE\n    OUTPUT \"그 밖의 값\"\nEND IF",
};

export const partBReference: CommonReference = {
  title: "예시 연구자료: 종이비행기 날개 길이와 비행 거리",
  sections: [{ heading: "연구 목적", paragraphs: ["같은 종이와 접기 방법을 사용했을 때 날개 길이가 비행 거리에 영향을 주는지 알아본다."] }, { heading: "실험 방법", paragraphs: ["날개 길이가 다른 비행기 세 종류를 만들고 같은 학생이 실내에서 각각 3회씩 던졌다."] }, { heading: "연구자의 결론", paragraphs: ["이번 실험에서는 날개 길이 10cm인 비행기의 평균 비행 거리가 가장 길었다."] }],
  definitions: ["평균 비행 거리: 여러 번 던진 거리의 합을 횟수로 나눈 값", "반복 실험: 같은 조건의 실험을 여러 번 수행하는 것"],
  table: { columns: ["비행기", "날개 길이(cm)", "실험 횟수", "평균 비행 거리(m)"], rows: [["A", "8", "3", "4.2"], ["B", "10", "3", "5.1"], ["C", "12", "3", "4.6"]] },
};

export const defaultExamResources: ExamResources = { guides: [pseudocodeGuide], pseudocodeGuide, commonReference: partBReference };

export const testExamInfo = { title: "접속 테스트", subtitle: "입력·저장·이동·제출 확인", coverEyebrow: "DEVICE CONNECTION TEST", coverTitle: "시험 전\n접속 테스트", coverDescription: "기기 작동 확인용 테스트입니다.", durationMinutes: 5, totalPoints: 3, partA: 3, partB: 0 };

export const testExamResources: ExamResources = {
  guides: [{ id: "test-guide-a-1", part: "A", name: "PART A 접속 테스트 안내", adminLabel: "GUIDE", adminTitle: "접속 테스트 안내", adminDescription: "학생 화면의 테스트 문항 상단에 표시됩니다.", previewLabel: "테스트 안내", title: "접속 테스트 안내", rules: ["문항 이동, 답안 저장, 제출 버튼을 확인합니다.", "실제 시험 점수에는 영향을 주지 않습니다."], exampleProblem: "입력 예시", exampleData: "화면의 안내를 따라 입력하세요.", exampleAnswer: "입력 후 다음 문항으로 이동합니다.", elseIfExampleProblem: "제출 예시", elseIfExampleData: "마지막 문항까지 확인합니다.", elseIfExampleAnswer: "최종 제출 버튼을 누릅니다." }],
  pseudocodeGuide: { id: "test-guide-a-1", part: "A", name: "PART A 접속 테스트 안내", adminLabel: "GUIDE", adminTitle: "접속 테스트 안내", adminDescription: "학생 화면의 테스트 문항 상단에 표시됩니다.", previewLabel: "테스트 안내", title: "접속 테스트 안내", rules: ["문항 이동, 답안 저장, 제출 버튼을 확인합니다.", "실제 시험 점수에는 영향을 주지 않습니다."], exampleProblem: "입력 예시", exampleData: "화면의 안내를 따라 입력하세요.", exampleAnswer: "입력 후 다음 문항으로 이동합니다.", elseIfExampleProblem: "제출 예시", elseIfExampleData: "마지막 문항까지 확인합니다.", elseIfExampleAnswer: "최종 제출 버튼을 누릅니다." },
  commonReference: { title: "접속 테스트 공통 안내", sections: [], definitions: [], table: { columns: [], rows: [] } },
};

export const questions: ExamQuestion[] = [
  { id: "sample-q1", number: 1, part: "A", title: "짝수의 개수 세기", points: 10, estimatedMinutes: 7, prompt: ["아래 DATA에서 짝수의 개수를 세는 수도코드를 작성하시오."], data: "DATA = [3, 8, 4, 7, 10]", fields: [{ key: "code", label: "수도코드", placeholder: "COUNT ← 0부터 시작하세요.", rows: 8, kind: "code" }], rubric: [{ id: "sample-q1-r1", points: 4, criterion: "COUNT를 0으로 초기화한다." }, { id: "sample-q1-r2", points: 4, criterion: "각 값을 반복하며 짝수 조건을 검사한다." }, { id: "sample-q1-r3", points: 2, criterion: "최종 COUNT를 출력한다." }] },
  { id: "sample-q2", number: 2, part: "A", title: "조건문 결과 설명", points: 10, estimatedMinutes: 7, prompt: ["아래 수도코드를 실행했을 때 출력되는 문장을 쓰고, 해당 분기가 선택되는 이유를 설명하시오."], data: "SCORE = 75\nIF SCORE ≥ 90\n    OUTPUT \"A\"\nELSE IF SCORE ≥ 70\n    OUTPUT \"B\"\nELSE\n    OUTPUT \"C\"\nEND IF", fields: [{ key: "result", label: "출력과 설명", placeholder: "출력: …\n이유: …", rows: 5 }], rubric: [{ id: "sample-q2-r1", points: 4, criterion: "출력 B를 제시한다." }, { id: "sample-q2-r2", points: 6, criterion: "90 이상 조건은 거짓이고 70 이상 조건은 참이라고 설명한다." }] },
  { id: "sample-q3", number: 3, part: "B", title: "연구자료 해석과 개선", points: 10, estimatedMinutes: 8, showReference: true, prompt: ["공통자료의 표를 보고 평균 비행 거리가 가장 긴 비행기를 쓰시오.", "실험 결과를 더 믿을 수 있게 만들기 위한 개선 방법 하나를 설명하시오."], fields: [{ key: "interpretation", label: "표 해석", placeholder: "가장 긴 비행기: …", rows: 3 }, { key: "improvement", label: "실험 개선", placeholder: "개선 방법과 이유를 작성하세요.", rows: 5 }], rubric: [{ id: "sample-q3-r1", points: 4, criterion: "비행기 B를 선택한다." }, { id: "sample-q3-r2", points: 6, criterion: "실험 횟수나 실험자 수를 늘리는 등 재현 가능한 개선을 제안하고 이유를 설명한다." }] },
];

export const testQuestions: ExamQuestion[] = [
  { id: "test-q1", number: 1, part: "A", title: "이름 입력 확인", points: 1, estimatedMinutes: 1, prompt: ["자신의 이름을 한 번 입력하시오."], fields: [{ key: "name", label: "이름", placeholder: "이름", rows: 2 }], rubric: [{ id: "test-q1-r1", points: 1, criterion: "텍스트를 입력했다." }] },
  { id: "test-q2", number: 2, part: "A", title: "문항 이동 확인", points: 1, estimatedMinutes: 1, prompt: ["다음 문항과 이전 문항 버튼을 각각 한 번 눌러 보시오."], fields: [{ key: "done", label: "확인 내용", placeholder: "확인 완료", rows: 2 }], rubric: [{ id: "test-q2-r1", points: 1, criterion: "확인 내용을 입력했다." }] },
  { id: "test-q3", number: 3, part: "A", title: "제출 확인", points: 1, estimatedMinutes: 1, prompt: ["이 칸에 제출이라고 입력한 뒤 최종 제출 버튼을 누르시오."], fields: [{ key: "submit", label: "제출 확인", placeholder: "제출", rows: 2 }], rubric: [{ id: "test-q3-r1", points: 1, criterion: "제출 절차를 완료했다." }] },
];

export const gradingSystemPrompt = `당신은 예시 시험의 일관된 채점자다.
제공된 문항별 채점 기준만 사용하고, 각 기준의 부분점수와 근거를 한국어로 설명한다.
학생 답안에 없는 내용을 추측하지 말고 총점이 문항 배점을 넘지 않게 한다.`;
