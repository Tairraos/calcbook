import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspace, MAX_NOTE_LENGTH, parseWorkspace } from "../src/domain/notebook.ts";

test("workspace round trip preserves notes, theme and trash", () => {
  const workspace = createWorkspace(new Date().toISOString(), () => crypto.randomUUID());
  workspace.theme = "midnight";
  workspace.calculatorMode = "dialog";
  workspace.notes[0].trashed = true;
  assert.deepEqual(parseWorkspace(JSON.parse(JSON.stringify(workspace))), workspace);
});
test("corrupt or unsupported workspaces are not accepted as empty", () => {
  const workspace = createWorkspace(new Date().toISOString(), () => crypto.randomUUID());
  for (const invalid of [
    null,
    {},
    { ...workspace, version: 2 },
    { ...workspace, theme: "unknown" },
    { ...workspace, calculatorMode: "unknown" },
    { ...workspace, activeId: "missing" },
    { ...workspace, notes: [workspace.notes[0], workspace.notes[0]] },
  ]) {
    assert.throws(() => parseWorkspace(invalid));
  }
  workspace.notes[0].body = "x".repeat(MAX_NOTE_LENGTH + 1);
  assert.throws(() => parseWorkspace(workspace));
});
test("legacy themes and missing calculator preference migrate without changing notes", () => {
  const workspace = createWorkspace(new Date().toISOString(), () => crypto.randomUUID());
  for (const [legacy, current] of [
    ["light", "paper"],
    ["dark", "forest"],
  ]) {
    const migrated = parseWorkspace({ ...workspace, theme: legacy, calculatorMode: undefined });
    assert.equal(migrated.theme, current);
    assert.equal(migrated.calculatorMode, "sidebar");
    assert.deepEqual(migrated.notes, workspace.notes);
  }
});
