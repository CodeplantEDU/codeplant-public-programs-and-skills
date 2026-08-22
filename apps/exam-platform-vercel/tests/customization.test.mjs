import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [exam, resourceEditor, questionEditor, studentApp, adminApp, adminApi] = await Promise.all([
  readFile(new URL("../lib/exam.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/common-resource-editor.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/question-bank-editor.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/student-exam-app.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/admin-exam-app.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/api/admin/route.ts", import.meta.url), "utf8"),
]);

assert.match(exam, /guides: PseudocodeGuide\[\]/);
assert.match(exam, /part: "A" \| "B" \| "C"/);
assert.match(resourceEditor, /가이드 추가/);
assert.match(resourceEditor, /가이드 삭제/);
assert.match(resourceEditor, /학생용 가이드 제목/);
assert.match(resourceEditor, /PART C/);
assert.match(questionEditor, /<option value="C">PART C<\/option>/);
assert.match(studentApp, /resources\.guides/);
assert.match(studentApp, /currentGuides\.map/);
assert.match(adminApp, /전체 답안 PDF/);
assert.match(adminApp, /JSON 백업/);
assert.match(adminApi, /questions-save/);
assert.match(adminApi, /resources-save/);

console.log("customization tests passed");
