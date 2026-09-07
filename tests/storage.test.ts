import assert from "node:assert/strict";
import test from "node:test";
import { createWorkspace } from "../src/domain/notebook.ts";
import { loadWorkspace, STORAGE_KEY, saveWorkspace } from "../src/platform/storage.ts";

test("browser storage preserves bad data and propagates failed writes", async () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const values = new Map<string, string>();
  let refuseWrites = false;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (refuseWrites) throw new Error("quota exceeded");
        values.set(key, value);
      },
    },
  });
  try {
    const workspace = createWorkspace(new Date().toISOString(), () => crypto.randomUUID());
    assert.equal(await loadWorkspace(), null);
    await saveWorkspace(workspace);
    assert.deepEqual(await loadWorkspace(), workspace);
    const original = values.get(STORAGE_KEY);
    refuseWrites = true;
    await assert.rejects(saveWorkspace(workspace), /quota/);
    assert.equal(values.get(STORAGE_KEY), original);
    refuseWrites = false;
    values.set(STORAGE_KEY, "broken-json");
    await assert.rejects(loadWorkspace());
    await assert.rejects(saveWorkspace(workspace));
    assert.equal(values.get(STORAGE_KEY), "broken-json");
  } finally {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
});
