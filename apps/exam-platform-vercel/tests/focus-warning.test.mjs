import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [eventRoute, heartbeatRoute, studentApp, adminApp] = await Promise.all([
  readFile(new URL("../app/api/student/event/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/api/student/heartbeat/route.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/student-exam-app.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/admin/admin-exam-app.tsx", import.meta.url), "utf8"),
]);

assert.match(eventRoute, /violationCount >= 2/);
assert.match(eventRoute, /duplicateViolation/);
assert.match(eventRoute, /violationCount/);
assert.match(heartbeatRoute, /violationCount/);
assert.match(studentApp, /초점 이탈 경고 \{focusWarning\}회입니다\./);
assert.match(studentApp, /확인하고 계속 응시/);
assert.match(adminApp, /이탈 1회 경고·2회 실격/);

console.log("focus warning tests passed");
