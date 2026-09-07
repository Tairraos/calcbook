import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowUpFromLine,
  BookOpen,
  Calculator as CalculatorIcon,
  Check,
  ChevronRight,
  CircleHelp,
  FileText,
  Leaf,
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
import { evaluateNotebook } from "./domain/calculation.ts";
import { initialKeypad } from "./domain/keypad.ts";
import {
  createNote,
  MAX_NOTE_LENGTH,
  MAX_NOTES,
  MAX_TITLE_LENGTH,
  type Note,
} from "./domain/notebook.ts";
import {
  downloadText,
  enableTitleDragRegions,
  hasNativeTitlebar,
  openProject,
} from "./platform/storage.ts";
import { Calculator } from "./ui/Calculator.tsx";
import { Dialog } from "./ui/Dialog.tsx";
import { Editor } from "./ui/Editor.tsx";
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
  const [calculatorVisible, setCalculatorOpen] = useState<boolean | null>(null);
  const [calculatorState, setCalculatorState] = useState(initialKeypad);
  const calculatorOpen =
    calculatorVisible ?? (workspace?.calculatorMode === "sidebar" && window.innerWidth > 1150);
  const [helpOpen, setHelpOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [activeLine, setActiveLine] = useState(0);
  const [notice, setNotice] = useState("");
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

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
    document.title = `${selected?.title || "Calcbook"} · Calcbook`;
  }, [workspace?.theme, selected?.title]);

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
      setActiveLine(0);
      if (window.innerWidth <= 760) setSidebarOpen(false);
      requestAnimationFrame(() => editorRef.current?.focus());
      return true;
    },
    [workspace?.notes.length, update],
  );

  function patchNote(patch: Partial<Pick<Note, "body" | "title" | "trashed">>) {
    if (!selected) return;
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

  useEffect(() => {
    const shortcuts = (event: KeyboardEvent) => {
      if (event.isComposing || !(event.metaKey || event.ctrlKey)) return;
      if (event.key === ",") {
        event.preventDefault();
        if (workspace?.calculatorMode === "dialog") setCalculatorOpen(false);
        setHelpOpen(false);
        setSettingsOpen(true);
        return;
      }
      if (helpOpen || settingsOpen || (workspace?.calculatorMode === "dialog" && calculatorOpen))
        return;
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
  }, [
    newNote,
    flush,
    results,
    activeLine,
    copy,
    helpOpen,
    settingsOpen,
    workspace?.calculatorMode,
    calculatorOpen,
  ]);

  if (!workspace)
    return (
      <main className="startup-screen">
        <img src="/favicon.svg" alt="" width="48" height="48" />
        <h1>Calcbook</h1>
        <p role="status">{error || "正在打开你的笔记…"}</p>
        {error && (
          <button className="primary-button" type="button" onClick={() => void load()}>
            重试读取
          </button>
        )}
      </main>
    );

  const calculator = (
    <Calculator
      onClose={() => setCalculatorOpen(false)}
      onInsert={(expression) => {
        if (workspace.calculatorMode === "dialog") setCalculatorOpen(false);
        insertExpression(expression);
      }}
      canInsert={!selected?.trashed}
      state={calculatorState}
      setState={setCalculatorState}
      mode={workspace.calculatorMode}
    />
  );

  return (
    <div
      className={`app-shell ${sidebarOpen ? "has-sidebar" : ""} ${calculatorOpen && workspace.calculatorMode === "sidebar" ? "has-calculator" : ""}`}
    >
      {sidebarOpen && (
        <aside className="sidebar" aria-label="笔记导航">
          <div className="brand" data-tauri-drag-region>
            <img src="/favicon.svg" alt="" width="31" height="31" />
            <span>
              calcbook<span className="brand-period">.</span>
            </span>
            <IconButton
              title="收起笔记列表"
              className="sidebar-collapse"
              onClick={() => setSidebarOpen(false)}
            >
              <PanelLeftClose size={16} />
            </IconButton>
          </div>
          <div className="workspace-name">
            <span className="workspace-avatar">小</span>
            <div>
              <strong>我的笔记空间</strong>
              <span>给思路一点空间</span>
            </div>
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
          <button
            type="button"
            className={`all-notes ${!trashView ? "is-selected" : ""}`}
            onClick={() => {
              setTrashView(false);
              setQuery("");
            }}
          >
            <BookOpen size={16} />
            <span>全部笔记</span>
            <span className="count-badge">{notes.filter((note) => !note.trashed).length}</span>
          </button>
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
                  setActiveLine(0);
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
        </aside>
      )}
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
            {!sidebarOpen && (
              <IconButton title="展开笔记列表" onClick={() => setSidebarOpen(true)}>
                <Menu size={18} />
              </IconButton>
            )}
            <BookOpen size={15} />
            <span>{trashView ? "废纸篓" : "我的笔记"}</span>
            <ChevronRight size={13} />
            <strong>{selected?.title || "新的一页"}</strong>
          </div>
          <div className="topbar-actions">
            <span className={`save-status ${status === "error" ? "save-error" : ""}`} role="status">
              {status === "saved" && <Check size={13} />}
              {status === "saved"
                ? "已保存"
                : status === "saving"
                  ? "保存中…"
                  : status === "error"
                    ? "尚未保存"
                    : "读取中…"}
            </span>
            <button
              type="button"
              className={`calculator-toggle ${calculatorOpen ? "is-active" : ""}`}
              aria-pressed={calculatorOpen}
              onClick={() => setCalculatorOpen(!calculatorOpen)}
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
                  <IconButton title="导入文本笔记" onClick={() => fileRef.current?.click()}>
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
              onActiveLine={setActiveLine}
              editorRef={editorRef}
              readOnly={selected.trashed}
            />
            <div className="editor-bottom">
              <button type="button" className="syntax-hint" onClick={() => setHelpOpen(true)}>
                <span className="hint-icon">?</span>数字、文字，都可以写在这里
                <span className="hint-link">
                  语法速查
                  <ArrowLeft size={12} />
                </span>
              </button>
              <div className="page-stamp">
                <Leaf size={17} strokeWidth={1.4} />
                <span>A little space for a clearer mind.</span>
              </div>
            </div>
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
      {calculatorOpen &&
        (workspace.calculatorMode === "dialog" ? (
          <Dialog
            className="calculator-dialog"
            label="简易计算器"
            onClose={() => setCalculatorOpen(false)}
          >
            {calculator}
          </Dialog>
        ) : (
          calculator
        ))}
      {helpOpen && <HelpDialog onClose={() => setHelpOpen(false)} onInsert={insertExpression} />}
      {settingsOpen && storage && (
        <SettingsDialog
          calculatorMode={workspace.calculatorMode}
          directory={storage.directory}
          defaultDirectory={storage.defaultDirectory}
          canChooseDirectory={storage.canChoose}
          version={__APP_VERSION__}
          buildTime={__BUILD_TIME__}
          githubUrl={__GITHUB_URL__}
          saveStatus={status}
          saveError={error}
          onCalculatorModeChange={(calculatorMode) => {
            setCalculatorOpen(false);
            update((before) => ({ ...before, calculatorMode }));
          }}
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
              body.replace(/\r\n?/g, "\n"),
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
