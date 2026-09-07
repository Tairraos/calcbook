import { invoke, isTauri } from "@tauri-apps/api/core";
import { parseWorkspace, type Workspace } from "../domain/notebook.ts";

export const STORAGE_KEY = "calcbook.workspace.v1";
export type StorageInfo = { directory: string; defaultDirectory: string; canChoose: boolean };

export async function getStorageInfo(): Promise<StorageInfo> {
  return isTauri()
    ? invoke("storage_info")
    : { directory: "此浏览器的本地存储", defaultDirectory: "~/.calcbook", canChoose: false };
}

export async function chooseStorageDirectory(): Promise<StorageInfo | null> {
  if (!isTauri()) throw new Error("请在桌面应用中选择文件存储位置。");
  return invoke("choose_storage_directory");
}

export async function openProject(url: string): Promise<void> {
  if (isTauri()) await invoke("open_project");
  else window.open(url, "_blank", "noopener,noreferrer");
}

export async function loadWorkspace(): Promise<Workspace | null> {
  const data: unknown = isTauri()
    ? await invoke("load_workspace")
    : (() => {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw === null ? null : JSON.parse(raw);
      })();
  return data === null ? null : parseWorkspace(data);
}

export async function saveWorkspace(workspace: Workspace): Promise<void> {
  const validated = parseWorkspace(workspace);
  if (isTauri()) await invoke("save_workspace", { workspace: validated });
  else {
    const previous = localStorage.getItem(STORAGE_KEY);
    if (previous !== null) parseWorkspace(JSON.parse(previous));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(validated));
  }
}

export async function guardNativeClose(
  flush: () => Promise<void>,
  failed: (message: string) => void,
) {
  if (!isTauri()) return () => {};
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const window = getCurrentWindow();
  return window.onCloseRequested(async (event) => {
    event.preventDefault();
    try {
      await flush();
      await window.destroy();
    } catch {
      failed("保存失败，窗口已保留。请重试保存或导出笔记后再关闭。");
    }
  });
}

export async function downloadText(filename: string, content: string): Promise<boolean> {
  const safeName = filename.replace(/[\\/:*?"<>|]/g, "-");
  if (isTauri()) return invoke("export_note", { filename: safeName, content });
  const url = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = safeName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
