import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspace, MAX_NOTE_LENGTH, parseWorkspace } from "../src/domain/notebook.ts";

test("workspace round trip preserves notes, theme and trash", () => {
  const workspace = createWorkspace(new Date().toISOString(), () => crypto.randomUUID());
  workspace.theme = "midnight";
  workspace.notes[0].trashed = true;
  assert.deepEqual(parseWorkspace(JSON.parse(JSON.stringify(workspace))), workspace);
});
test("removed calculatorMode field is ignored on read", () => {
  const workspace = createWorkspace(new Date().toISOString(), () => crypto.randomUUID());
  const migrated = parseWorkspace({ ...workspace, calculatorMode: "dialog" });
  assert.equal(migrated.theme, workspace.theme);
  assert.deepEqual(migrated.notes, workspace.notes);
  assert.equal("calculatorMode" in migrated, false);
});
test("corrupt or unsupported workspaces are not accepted as empty", () => {
  const workspace = createWorkspace(new Date().toISOString(), () => crypto.randomUUID());
  for (const invalid of [
    null,
    {},
    { ...workspace, version: 2 },
    { ...workspace, theme: "unknown" },
    { ...workspace, activeId: "missing" },
    { ...workspace, notes: [workspace.notes[0], workspace.notes[0]] },
  ]) {
    assert.throws(() => parseWorkspace(invalid));
  }
  workspace.notes[0].body = "x".repeat(MAX_NOTE_LENGTH + 1);
  assert.throws(() => parseWorkspace(workspace));
});
test("legacy and removed themes migrate without changing notes", () => {
  const workspace = createWorkspace(new Date().toISOString(), () => crypto.randomUUID());
  for (const [legacy, current] of [
    ["light", "paper"],
    ["sand", "paper"],
    ["mist", "paper"],
    ["dark", "midnight"],
    ["forest", "midnight"],
    ["graphite", "midnight"],
  ]) {
    const migrated = parseWorkspace({ ...workspace, theme: legacy });
    assert.equal(migrated.theme, current);
    assert.deepEqual(migrated.notes, workspace.notes);
  }
});
test("note filenames stay inside the data directory", () => {
  const workspace = createWorkspace(new Date().toISOString(), () => crypto.randomUUID());
  // 旧数据没有 filename 字段：读取后为空，由存储层按标题推导。
  const without = parseWorkspace({
    ...workspace,
    notes: workspace.notes.map(({ filename: _filename, ...note }) => note),
  });
  assert.deepEqual(
    without.notes.map((note) => note.filename),
    workspace.notes.map(() => ""),
  );
  for (const filename of ["../escape.txt", "notes/预算.txt", "x".repeat(201)]) {
    assert.throws(() =>
      parseWorkspace({
        ...workspace,
        notes: [{ ...workspace.notes[0], filename }, ...workspace.notes.slice(1)],
      }),
    );
  }
});
test("unit mode persists and rejects unknown values", () => {
  const workspace = createWorkspace(new Date().toISOString(), () => crypto.randomUUID());
  workspace.unitMode = "chinese";
  assert.equal(parseWorkspace(JSON.parse(JSON.stringify(workspace))).unitMode, "chinese");
  // 旧数据没有 unitMode：默认自由单位。
  const legacy = JSON.parse(JSON.stringify(workspace));
  delete legacy.unitMode;
  assert.equal(parseWorkspace(legacy).unitMode, "free");
  assert.throws(() => parseWorkspace({ ...workspace, unitMode: "traditional" }));
});
