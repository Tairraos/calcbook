import { emit, listen } from "@tauri-apps/api/event";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpen,
  Calculator as CalculatorIcon,
  Check,
  ChevronRight,
  CircleHelp,
  FileText,
  Menu,
  Moon,
  PanelLeftClose,
  Plus,
  Search,
  Settings,
  Sun,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { convertUnitQuantity, evaluateNotebook } from "./domain/calculation.ts";
import { parseNoteBody } from "./domain/format.ts";
import type { FormatSettings } from "./domain/formatting.ts";
import { formatNoteBody } from "./domain/formatting.ts";
import {
  createNote,
  MAX_NOTE_LENGTH,
  MAX_NOTES,
  MAX_TITLE_LENGTH,
  type Note,
} from "./domain/notebook.ts";
import {
  CALCULATOR_INSERT_EVENT,
  CALCULATOR_READY_EVENT,
  CALCULATOR_THEME_EVENT,
  CALCULATOR_VISIBILITY_EVENT,
  calculatorStatus,
  downloadText,
  enableTitleDragRegions,
  hasNativeTitlebar,
  importNoteFile,
  isDesktopApp,
  openProject,
  toggleCalculator,
} from "./platform/storage.ts";
import { Editor } from "./ui/Editor.tsx";
import { FormatDialog } from "./ui/FormatDialog.tsx";
import { HelpDialog } from "./ui/HelpDialog.tsx";
import { IconButton } from "./ui/IconButton.tsx";
import { SettingsDialog } from "./ui/SettingsDialog.tsx";
import { useWorkspace } from "./useWorkspace.ts";

const date = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(new Date(value));

export default function App() {
  const { workspace, update, status, error, load, flush, storage, changeDirectory } =
    useWorkspace();
  const [query, setQuery] = useState("");
  const [trashView, setTrashView] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => window.innerWidth > 760);
  // 计算器是独立子窗口：visible 由 Rust 事件推送，浏览器预览恒为关。
  const [calculatorVisible, setCalculatorVisible] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeLine, setActiveLine] = useState(0);
  const [notice, setNotice] = useState("");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const activeLineRef = useRef(0);

  const notes = workspace?.notes ?? [];
  const visibleNotes = notes.filter(
    (note) =>
      note.trashed === trashView &&
      `${note.title}\n${note.body}`.toLowerCase().includes(query.toLowerCase()),
  );
  const selected =
    notes.find((note) => note.id === workspace?.activeId && note.trashed === trashView) ??
    notes.find((note) => note.trashed === trashView);
  const results = useMemo(() => evaluateNotebook(selected?.body ?? ""), [selected?.body]);
  const resultCount = results.filter((line) => line.kind === "result").length;
  const errorCount = results.filter((line) => line.kind === "error").length;

  useEffect(() => {
    document.documentElement.dataset.theme = workspace?.theme ?? "paper";
    document.documentElement.classList.toggle("native-titlebar", hasNativeTitlebar);
    document.title = `${selected?.title || "calcbook"} · calcbook`;
  }, [workspace?.theme, selected?.title]);

  // 活动行回到第一行：换笔记时重置 ref，避免失焦改写拿旧行号碰新笔记。
  const resetActiveLine = useCallback(() => {
    activeLineRef.current = 0;
    setActiveLine(0);
    formatUndoRef.current = null;
  }, []);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | undefined;
    void enableTitleDragRegions().then((dispose) => {
      if (disposed) dispose();
      else cleanup = dispose;
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  const newNote = useCallback(
    (title = "未命名笔记", body = "") => {
      if ((workspace?.notes.length ?? 0) >= MAX_NOTES) {
        setNotice("目前最多保留 100 篇笔记（含废纸篓）。");
        return false;
      }
      const note = createNote(crypto.randomUUID(), new Date().toISOString(), title, body);
      update((before) => ({ ...before, notes: [note, ...before.notes], activeId: note.id }));
      setTrashView(false);
      setQuery("");
      resetActiveLine();
      if (window.innerWidth <= 760) setSidebarOpen(false);
      requestAnimationFrame(() => editorRef.current?.focus());
      return true;
    },
    [workspace?.notes.length, resetActiveLine, update],
  );

  function patchNote(patch: Partial<Pick<Note, "body" | "title" | "trashed">>) {
    if (!selected) return;
    // 用户手动编辑后，格式化的应用内撤销作废
    if (patch.body !== undefined && patch.body !== formatUndoRef.current?.formatted)
      formatUndoRef.current = null;
    update((before) => ({
      ...before,
      notes: before.notes.map((note) =>
        note.id === selected.id ? { ...note, ...patch, updatedAt: new Date().toISOString() } : note,
      ),
    }));
  }

  function restoreNote() {
    if (!selected) return;
    update((before) => ({
      ...before,
      activeId: selected.id,
      notes: before.notes.map((note) =>
        note.id === selected.id ? { ...note, trashed: false } : note,
      ),
    }));
    setTrashView(false);
    resetActiveLine();
    setNotice("笔记已恢复");
  }

  const copy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("结果已复制");
    } catch {
      setNotice("复制失败，请选中结果后手动复制。");
    }
  }, []);

  function insertExpression(expression: string) {
    if (!selected || selected.trashed) {
      newNote("随手计算", expression.trim());
      return;
    }
    const textarea = editorRef.current;
    const position = textarea?.selectionEnd ?? selected.body.length;
    const nextNewline = selected.body.indexOf("\n", position);
    const insertionPoint = nextNewline === -1 ? selected.body.length : nextNewline;
    const before = selected.body.slice(0, insertionPoint);
    const insertion = `${before && !before.endsWith("\n") ? "\n" : ""}${expression.trim()}\n`;
    const body = before + insertion + selected.body.slice(insertionPoint).replace(/^\n/, "");
    if (body.length > MAX_NOTE_LENGTH) {
      setNotice("这篇笔记已达到长度上限，请新建一篇。");
      return;
    }
    patchNote({ body });
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(
        insertionPoint + insertion.length,
        insertionPoint + insertion.length,
      );
    });
    setNotice("算式已写入笔记");
  }

  async function exportNote() {
    if (!selected) return;
    try {
      if (await downloadText(`${selected.title || "未命名笔记"}.txt`, selected.body))
        setNotice("已导出纯文本笔记");
    } catch {
      setNotice("导出失败，请重试。");
    }
  }

  // 桌面版走原生对话框导入 Numi 的 .txt；浏览器预览退回隐藏的 file input。
  async function importNote() {
    if (!isDesktopApp) {
      fileRef.current?.click();
      return;
    }
    try {
      const imported = await importNoteFile();
      if (!imported) return;
      if (newNote(imported.title.slice(0, MAX_TITLE_LENGTH), imported.body))
        setNotice("笔记已导入");
    } catch {
      setNotice("导入失败，请重试。");
    }
  }

  const handleActiveLine = useCallback((line: number) => {
    activeLineRef.current = line;
    setActiveLine(line);
  }, []);

  const [formatOpen, setFormatOpen] = useState(false);
  const formatUndoRef = useRef<{ noteId: string; previous: string; formatted: string } | null>(
    null,
  );
  const changeFormat = useCallback(
    (format: FormatSettings) => update((before) => ({ ...before, format })),
    [update],
  );
  // 格式化整篇：按当前格式设置重排所有行（含注释与空格规范）。
  // 编辑器可编辑时用 execCommand 整篇替换，保留原生撤销栈（一次 Cmd+Z 即可还原）。
  const applyFormatting = useCallback(() => {
    if (!selected || !workspace) return;
    const formatted = formatNoteBody(selected.body, workspace.format, convertUnitQuantity);
    if (formatted === selected.body) {
      setNotice("格式已是最新的。");
      return;
    }
    // 应用内撤销：格式化走 React 状态替换，原生撤销栈不可靠，
    // 记住格式化前的正文，Cmd+Z 在无后续编辑时直接恢复。
    formatUndoRef.current = { noteId: selected.id, previous: selected.body, formatted };
    const textarea = editorRef.current;
    if (textarea && formatted.length <= MAX_NOTE_LENGTH) {
      textarea.focus();
      textarea.setSelectionRange(0, textarea.value.length);
      try {
        if (document.execCommand("insertText", false, formatted)) {
          setNotice("已按格式设置整理本页算式");
          return;
        }
      } catch {
        // execCommand 不可用时走状态替换
      }
    }
    update((before) => ({
      ...before,
      notes: before.notes.map((note) =>
        note.id === selected.id
          ? { ...note, body: formatted, updatedAt: new Date().toISOString() }
          : note,
      ),
    }));
    setNotice("已按格式设置整理本页算式");
  }, [selected, workspace, update]);

  // 计算器子窗口状态：初始查询一次，之后由 Rust 在显示/隐藏时推送。
  // 桌面版主题存在文件系统而非 localStorage，子窗打开时需立即同步当前配色。
  const themeRef = useRef(workspace?.theme ?? "paper");
  themeRef.current = workspace?.theme ?? "paper";
  useEffect(() => {
    if (!isDesktopApp) return;
    void calculatorStatus()
      .then((status) => setCalculatorVisible(status.visible))
      .catch(() => {});
    const pushTheme = () => {
      void emit(CALCULATOR_THEME_EVENT, themeRef.current).catch(() => {});
    };
    const unlisten = listen<boolean>(CALCULATOR_VISIBILITY_EVENT, (event) => {
      setCalculatorVisible(event.payload === true);
      if (event.payload === true) pushTheme();
    });
    // 子窗挂载完成时立即补一次主题，避免创建早期的推送丢失（竞态）。
    const unlistenReady = listen(CALCULATOR_READY_EVENT, pushTheme);
    return () => {
      void unlisten.then((dispose) => dispose());
      void unlistenReady.then((dispose) => dispose());
    };
  }, []);

  // 切换主题时同步给计算器子窗口。
  useEffect(() => {
    if (!isDesktopApp) return;
    void emit(CALCULATOR_THEME_EVENT, workspace?.theme ?? "paper").catch(() => {});
  }, [workspace?.theme]);

  // 计算器「写入当前笔记」：经事件送达主窗，插入当前行之后。
  const insertRef = useRef(insertExpression);
  insertRef.current = insertExpression;
  useEffect(() => {
    if (!isDesktopApp) return;
    const unlisten = listen<string>(CALCULATOR_INSERT_EVENT, (event) => {
      insertRef.current(event.payload);
    });
    return () => {
      void unlisten.then((dispose) => dispose());
    };
  }, []);

  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (event.isComposing || !(event.metaKey || event.ctrlKey)) return;
      // 格式化的应用内撤销：仅当笔记仍是格式化后的内容（用户未再编辑）
      const formatUndo = formatUndoRef.current;
      if (
        !event.shiftKey &&
        event.key.toLowerCase() === "z" &&
        formatUndo &&
        formatUndo.noteId === selected?.id &&
        selected.body === formatUndo.formatted
      ) {
        event.preventDefault();
        formatUndoRef.current = null;
        update((before) => ({
          ...before,
          notes: before.notes.map((note) =>
            note.id === formatUndo.noteId
              ? { ...note, body: formatUndo.previous, updatedAt: new Date().toISOString() }
              : note,
          ),
        }));
        setNotice("已撤销格式化");
        return;
      }
      if (event.key === ",") {
        event.preventDefault();
        setHelpOpen(false);
        setSettingsOpen(true);
        return;
      }
      if (helpOpen || settingsOpen) return;
      if (event.key.toLowerCase() === "n") {
        event.preventDefault();
        newNote();
      }
      if (event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSidebarOpen(true);
        requestAnimationFrame(() => searchRef.current?.focus());
      }
      if (event.key.toLowerCase() === "s") {
        event.preventDefault();
        void flush().catch(() => {});
      }
      if (event.shiftKey && event.key.toLowerCase() === "c" && results[activeLine]?.raw) {
        event.preventDefault();
        void copy(results[activeLine].raw ?? "");
      }
    };
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [newNote, flush, results, activeLine, copy, helpOpen, settingsOpen]);

  if (!workspace)
    return (
      <main className="startup-screen">
        <img src="/favicon.svg" alt="" width="48" height="48" />
        <h1>calcbook</h1>
        <p role="status">{error || "正在打开你的笔记…"}</p>
        {error && (
          <button className="primary-button" type="button" onClick={() => void load()}>
            重试读取
          </button>
        )}
      </main>
    );

  return (
    <div className={`app-shell ${sidebarOpen ? "has-sidebar" : ""}`}>
      <aside className="sidebar" aria-label="笔记导航">
        <div className="sidebar-inner">
          <div className="brand" data-tauri-drag-region>
            <span>calcbook</span>
          </div>
          <div className="search-field">
            <Search size={15} />
            <input
              ref={searchRef}
              aria-label="搜索笔记"
              placeholder="搜索笔记…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <kbd>⌘ K</kbd>
          </div>
          <div className="notebook-list-heading">
            <span>{trashView ? "废纸篓" : "我的笔记"}</span>
            <IconButton title="新建笔记" onClick={() => newNote()}>
              <Plus size={17} />
            </IconButton>
          </div>
          <div className="note-list">
            {visibleNotes.map((note) => (
              <button
                type="button"
                key={note.id}
                className={`note-card ${selected?.id === note.id ? "is-selected" : ""}`}
                aria-current={selected?.id === note.id ? "page" : undefined}
                onClick={() => {
                  update((before) => ({ ...before, activeId: note.id }));
                  resetActiveLine();
                  if (window.innerWidth <= 760) setSidebarOpen(false);
                }}
              >
                <span className="note-card-top">
                  <FileText size={15} />
                  <strong>{note.title || "未命名笔记"}</strong>
                </span>
                <span className="note-preview">
                  {note.body
                    .split("\n")
                    .find((line) => line.trim())
                    ?.replace(/^#+\s*/, "") || "一张白纸，等一个想法"}
                </span>
                <span className="note-date">
                  {date(note.updatedAt)}
                  <span>本地笔记</span>
                </span>
              </button>
            ))}
            {visibleNotes.length === 0 && (
              <p className="no-notes">
                {query ? "没有找到这篇笔记" : trashView ? "废纸篓是空的" : "从一张白纸开始吧"}
              </p>
            )}
          </div>
          <button type="button" className="new-note-button" onClick={() => newNote()}>
            <Plus size={16} />
            新建笔记<span>⌘ N</span>
          </button>
          <div className="sidebar-bottom">
            <button
              type="button"
              className={trashView ? "is-active" : ""}
              onClick={() => {
                setTrashView(!trashView);
                setQuery("");
                resetActiveLine();
              }}
            >
              <Trash2 size={15} />
              废纸篓
              {notes.some((note) => note.trashed) && (
                <span>{notes.filter((note) => note.trashed).length}</span>
              )}
            </button>
            <button type="button" onClick={() => setHelpOpen(true)}>
              <CircleHelp size={15} />
              语法速查
              <ChevronRight size={13} />
            </button>
            <div className="settings-entry">
              <button
                type="button"
                title="设置（⌘ / Ctrl ,）"
                onClick={() => setSettingsOpen(true)}
              >
                <Settings size={16} />
                <span>设置</span>
              </button>
              <IconButton
                className="theme-toggle"
                title={workspace.theme === "midnight" ? "切换到浅色模式" : "切换到深色模式"}
                onClick={() =>
                  update((before) => ({
                    ...before,
                    theme: before.theme === "midnight" ? "paper" : "midnight",
                  }))
                }
              >
                {workspace.theme === "midnight" ? <Sun size={16} /> : <Moon size={16} />}
              </IconButton>
            </div>
          </div>
        </div>
      </aside>
      {sidebarOpen && (
        <button
          type="button"
          className="sidebar-scrim"
          aria-label="关闭笔记导航"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <main className="notebook-main">
        <header className="topbar" data-tauri-drag-region>
          <div className="breadcrumb">
            <IconButton
              title={sidebarOpen ? "收起笔记列表" : "展开笔记列表"}
              aria-expanded={sidebarOpen}
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? <PanelLeftClose size={17} /> : <Menu size={18} />}
            </IconButton>
            <BookOpen size={15} />
            <span>{trashView ? "废纸篓" : "我的笔记"}</span>
            <ChevronRight size={13} />
            <strong>{selected?.title || "新的一页"}</strong>
          </div>
          <div className="topbar-actions">
            {status === "error" ? (
              <span className="save-status save-error" role="alert">
                尚未保存
              </span>
            ) : (
              <>
                <button
                  type="button"
                  className="topbar-tool"
                  aria-haspopup="dialog"
                  title="算式书写格式设置"
                  onClick={() => setFormatOpen(true)}
                >
                  格式
                </button>
                <button
                  type="button"
                  className="topbar-tool"
                  title="按格式设置整理当前笔记的全部算式"
                  onClick={applyFormatting}
                >
                  格式化
                </button>
              </>
            )}
            <button
              type="button"
              className={`calculator-toggle ${calculatorVisible ? "is-open" : ""}`}
              aria-pressed={calculatorVisible}
              title={calculatorVisible ? "计算器窗口已打开" : "打开计算器窗口"}
              onClick={() => {
                if (!isDesktopApp) {
                  setNotice("计算器窗口仅在桌面版可用。");
                  return;
                }
                void toggleCalculator()
                  .then((status) => setCalculatorVisible(status.visible))
                  .catch(() => setNotice("无法打开计算器窗口，请重试。"));
              }}
            >
              <CalculatorIcon size={16} />
              <span>计算器</span>
            </button>
          </div>
        </header>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => void flush().catch(() => {})}>
              重试保存
            </button>
          </div>
        )}
        {selected ? (
          <>
            <div className="note-heading">
              <div className="note-kicker">
                <span className="eyebrow">
                  <span className="tiny-rule" />
                  THINK IT. NOTE IT. SOLVE IT.
                </span>
                <div className="note-tools">
                  <IconButton title="导入文本笔记" onClick={() => void importNote()}>
                    <ArrowUpFromLine size={16} />
                  </IconButton>
                  <IconButton title="导出当前笔记" onClick={() => void exportNote()}>
                    <ArrowDownToLine size={16} />
                  </IconButton>
                  {selected.trashed ? (
                    <IconButton title="恢复笔记" onClick={restoreNote}>
                      <Undo2 size={16} />
                    </IconButton>
                  ) : (
                    <IconButton
                      title="移到废纸篓"
                      onClick={() => {
                        const id = selected.id;
                        update((before) => ({
                          ...before,
                          notes: before.notes.map((note) =>
                            note.id === id ? { ...note, trashed: true } : note,
                          ),
                          activeId:
                            before.notes.find((note) => !note.trashed && note.id !== id)?.id ??
                            null,
                        }));
                        setNotice("已移到废纸篓，可随时恢复");
                      }}
                    >
                      <Trash2 size={16} />
                    </IconButton>
                  )}
                </div>
              </div>
              <input
                className="note-title"
                aria-label="笔记标题"
                value={selected.title}
                placeholder="未命名笔记"
                maxLength={MAX_TITLE_LENGTH}
                readOnly={selected.trashed}
                onChange={(event) => patchNote({ title: event.target.value })}
              />
              <div className="note-meta">
                <span className="note-type">
                  <FileText size={12} />
                  计算笔记
                </span>
                <span className="meta-divider">·</span>
                <span>{date(selected.updatedAt)}更新</span>
                <span className="note-saved-dot" />
                <span>边想，边记，边算。</span>
              </div>
            </div>
            {selected.trashed && (
              <div className="trash-banner">
                <span>这篇笔记在废纸篓中，内容已保留。</span>
                <button type="button" onClick={restoreNote}>
                  恢复笔记
                </button>
              </div>
            )}
            <Editor
              key={selected.id}
              body={selected.body}
              results={results}
              onChange={(body) => patchNote({ body })}
              onCopy={(text) => void copy(text)}
              activeLine={activeLine}
              onActiveLine={handleActiveLine}
              editorRef={editorRef}
              readOnly={selected.trashed}
            />
            <footer className="statusbar">
              <span>
                <span className="status-dot" />
                {resultCount} 条计算
                {errorCount > 0 && <span className="error-count"> · {errorCount} 处待检查</span>}
              </span>
              <span>
                第 {Math.min(activeLine + 1, results.length)} 行
                <span className="statusbar-divider" />
                点击右侧结果即可复制
              </span>
            </footer>
          </>
        ) : (
          <div className="empty-page">
            <BookOpen size={38} strokeWidth={1.2} />
            <h1>{trashView ? "没有被丢下的想法" : "给思路一张白纸。"}</h1>
            <p>{trashView ? "移入废纸篓的笔记会保留在这里。" : "从一个数字，或一个想法开始。"}</p>
            <button type="button" className="primary-button" onClick={() => newNote()}>
              <Plus size={16} />
              新建笔记
            </button>
          </div>
        )}
      </main>
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} onInsert={insertExpression} />}
      {formatOpen && workspace && (
        <FormatDialog
          settings={workspace.format}
          onChange={changeFormat}
          onApply={() => {
            applyFormatting();
            setFormatOpen(false);
          }}
          onClose={() => setFormatOpen(false)}
        />
      )}
      {settingsOpen && storage && (
        <SettingsDialog
          directory={storage.directory}
          defaultDirectory={storage.defaultDirectory}
          canChooseDirectory={storage.canChoose}
          version={__APP_VERSION__}
          buildTime={__BUILD_TIME__}
          githubUrl={__GITHUB_URL__}
          saveStatus={status}
          saveError={error}
          onChangeDirectory={changeDirectory}
          onOpenProject={() => openProject(__GITHUB_URL__)}
          onClose={() => setSettingsOpen(false)}
        />
      )}
      <input
        type="file"
        className="visually-hidden"
        ref={fileRef}
        accept=".txt,.md,.numi,text/plain,text/markdown"
        aria-label="选择要导入的文本笔记"
        tabIndex={-1}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          if (file.size > MAX_NOTE_LENGTH * 4) {
            setNotice("文件过大，单篇笔记最多 10 万字符。");
            return;
          }
          try {
            const body = await file.text();
            if (body.length > MAX_NOTE_LENGTH || body.includes("\0")) throw new Error("invalid");
            const imported = newNote(
              file.name.replace(/\.[^.]+$/, "").slice(0, MAX_TITLE_LENGTH),
              parseNoteBody(body),
            );
            if (imported) setNotice("笔记已导入");
          } catch {
            setNotice("无法读取文件，请选择 UTF-8 纯文本笔记。");
          }
        }}
      />
      {notice && (
        <div className="toast" role="status">
          <Check size={15} />
          <span>{notice}</span>
          <IconButton title="关闭提示" onClick={() => setNotice("")}>
            <X size={14} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
