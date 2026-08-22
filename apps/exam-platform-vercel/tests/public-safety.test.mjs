import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [exam, database, adapter, layout, page, adminPage] = await Promise.all([
  readFile(new URL("../lib/exam.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/database.ts", import.meta.url), "utf8"),
  readFile(new URL("../lib/turso-d1-adapter.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/page.tsx", import.meta.url), "utf8"),
]);

assert.match(exam, /CODEPLANT 예시 시험/);
assert.match(exam, /짝수의 개수 세기/);
assert.match(exam, /종이비행기 날개 길이/);
assert.equal([...exam.matchAll(/id: "sample-q\d"/g)].length, 3);
assert.doesNotMatch(database, /cloudflare:workers|const DEFAULT_ADMIN_PIN = "\d+"/);
assert.match(database, /process\.env\.ADMIN_PIN/);
assert.doesNotMatch(database, /PRAGMA optimize/);
assert.match(database, /CODEPLANT EXAM PLATFORM · DEMO/);
assert.match(database, /예시 시험/);
assert.match(adapter, /TURSO_DATABASE_URL/);
assert.match(adapter, /TURSO_AUTH_TOKEN/);
assert.match(layout, /CODEPLANT 예시 시험/);
assert.match(layout, /공개 예시 시험 플랫폼/);
assert.match(page, /CODEPLANT 예시 시험/);
assert.match(adminPage, /CODEPLANT 예시 시험/);

console.log("public safety tests passed");
