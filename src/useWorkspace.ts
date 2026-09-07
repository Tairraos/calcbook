import { useCallback, useEffect, useRef, useState } from "react";
import { createWorkspace, type Workspace } from "./domain/notebook.ts";
import {
  chooseStorageDirectory,
  getStorageInfo,
  guardNativeClose,
  loadWorkspace,
  type StorageInfo,
  saveWorkspace,
} from "./platform/storage.ts";

export function useWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [status, setStatus] = useState<"loading" | "saving" | "saved" | "error">("loading");
  const [error, setError] = useState("");
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const current = useRef<Workspace | null>(null);
  const queue = useRef(Promise.resolve());
  const revision = useRef(0);
  const currentStatus = useRef(status);
  currentStatus.current = status;

  const persist = useCallback((next: Workspace) => {
    const version = ++revision.current;
    setStatus("saving");
    const pending = queue.current.catch(() => {}).then(() => saveWorkspace(next));
    queue.current = pending;
    pending.then(
      () => {
        if (version === revision.current) {
          setStatus("saved");
          setError("");
        }
      },
      (reason: unknown) => {
        if (version === revision.current) {
          setStatus("error");
          setError(`尚未保存：${reason instanceof Error ? reason.message : String(reason)}`);
        }
      },
    );
    return pending;
  }, []);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const [stored, location] = await Promise.all([loadWorkspace(), getStorageInfo()]);
      setStorage(location);
      const next = stored ?? createWorkspace(new Date().toISOString(), () => crypto.randomUUID());
      current.current = next;
      setWorkspace(next);
      if (stored) setStatus("saved");
      else await persist(next);
      setError("");
    } catch (reason) {
      setStatus("error");
      setError(
        `无法读取或初始化笔记：${reason instanceof Error ? reason.message : String(reason)}。原数据未被清空。`,
      );
    }
  }, [persist]);

  const update = useCallback(
    (change: (before: Workspace) => Workspace) => {
      if (!current.current) return;
      const next = change(current.current);
      current.current = next;
      setWorkspace(next);
      void persist(next).catch(() => {});
    },
    [persist],
  );

  const flush = useCallback(async () => {
    if (current.current) await persist(current.current);
  }, [persist]);

  const changeDirectory = useCallback(async () => {
    await flush();
    const location = await chooseStorageDirectory();
    if (location) setStorage(location);
    return location !== null;
  }, [flush]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void guardNativeClose(flush, setError)
      .then((cleanup) => {
        if (disposed) cleanup();
        else unlisten = cleanup;
      })
      .catch(() => setError("关闭前保存保护未启用，请等待已保存状态后再关闭。"));
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (currentStatus.current === "saving" || currentStatus.current === "error")
        event.preventDefault();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [flush]);

  return { workspace, update, status, error, load, flush, storage, changeDirectory };
}
