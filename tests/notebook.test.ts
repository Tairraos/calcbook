import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_FORMAT_SETTINGS } from "../src/domain/formatting.ts";
import {
  createWorkspace,
  DEFAULT_HISTORY_LIMIT_KB,
  MAX_NOTE_LENGTH,
  parseWorkspace,
} from "../src/domain/notebook.ts";

test("workspace round trip preserves notes, theme and trash", () => {
  const workspace = createWorkspace(new Date().toISOString(), () => crypto.randomUUID());
  workspace.theme = "dark";
  workspace.notes[0].trashed = true;
  assert.deepEqual(parseWorkspace(JSON.parse(JSON.stringify(workspace))), workspace);
});
test("history limit falls back to default when missing or out of range", () => {
  const workspace = createWorkspace(new Date().toISOString(), () => crypto.randomUUID());
  // 缺省回落默认
  const { historyLimitKB: _omitted, ...without } = workspace;
  assert.equal(parseWorkspace(without).historyLimitKB, DEFAULT_HISTORY_LIMIT_KB);
  // 正常往返
  workspace.historyLimitKB = 0;
  assert.equal(parseWorkspace({ ...workspace }).historyLimitKB, 0);
  workspace.historyLimitKB = 65536;
  assert.equal(parseWorkspace({ ...workspace }).historyLimitKB, 65536);
  // 非法值回落默认
  for (const invalid of [-1, 1.5, 65537, "128", null]) {
    assert.equal(
      parseWorkspace({ ...workspace, historyLimitKB: invalid }).historyLimitKB,
      DEFAULT_HISTORY_LIMIT_KB,
    );
  }
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
    ["paper", "light"],
    ["sand", "light"],
    ["mist", "light"],
    ["midnight", "dark"],
    ["forest", "dark"],
    ["graphite", "dark"],
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
test("format settings persist, migrate unitMode and reject unknown values", () => {
  const workspace = createWorkspace(new Date().toISOString(), () => crypto.randomUUID());
  workspace.format = { ...workspace.format, unitStyle: "chinese" };
  assert.equal(parseWorkspace(JSON.parse(JSON.stringify(workspace))).format.unitStyle, "chinese");
  // 旧数据没有 format：unitMode 迁移到单位风格，其余默认。
  const legacy = JSON.parse(JSON.stringify(workspace));
  delete legacy.format;
  legacy.unitMode = "english";
  assert.equal(parseWorkspace(legacy).format.unitStyle, "lower");
  delete legacy.unitMode;
  assert.deepEqual(parseWorkspace(legacy).format, DEFAULT_FORMAT_SETTINGS);
  // 非法单位风格在 TS 侧宽松回落默认，Rust 侧严格校验拒绝写入。
  assert.equal(
    parseWorkspace({ ...workspace, format: { ...workspace.format, unitStyle: "traditional" } })
      .format.unitStyle,
    "free",
  );
});
