export const MAX_NOTES = 100;
export const MAX_NOTE_LENGTH = 100_000;
export const MAX_TITLE_LENGTH = 120;
export const THEME_IDS = ["paper", "midnight"] as const;
export type Theme = (typeof THEME_IDS)[number];
const LEGACY_THEMES: Record<string, Theme> = {
  light: "paper",
  sand: "paper",
  mist: "paper",
  dark: "midnight",
  forest: "midnight",
  graphite: "midnight",
};
export type CalculatorMode = "sidebar" | "dialog";

export type Note = {
  id: string;
  title: string;
  body: string;
  createdAt: string;
  updatedAt: string;
  trashed: boolean;
};
export type Workspace = {
  version: 1;
  notes: Note[];
  activeId: string | null;
  theme: Theme;
  calculatorMode: CalculatorMode;
};

export function createNote(id: string, now: string, title = "未命名笔记", body = ""): Note {
  return { id, title, body, createdAt: now, updatedAt: now, trashed: false };
}

const examples = [
  {
    title: "周末出行计划",
    body: "# 去山野，过个慢周末\n// 两个人的短途旅行，把预算也一起记下来。\n\n交通 = 186 × 2\n住宿 = 420 × 2\n餐饮 = 240\n预算 = 交通 + 住宿 + 餐饮\n\n# 给快乐留一点余地\n每人 = 预算 / 2\n备用金：每人 × 10%\n人均预算：每人 + 10%\n\n// 数字变了，答案也会跟着变。",
  },
  {
    title: "工作室小预算",
    body: "# 一张桌子，一个新开始\n桌子：1299 CNY\n椅子：899 CNY\n台灯：249 CNY\n合计\n\n# 量一量，刚刚好\n桌面宽度：1.4 m to cm\n线材长度：2 m + 50 cm\n专注时间：90 min to hour",
  },
  {
    title: "从这里开始",
    body: "# 你好，Calcbook\n像写笔记一样计算，答案会出现在右边。\n\n# 基础算式\n(18 + 24) × 3\n0.1 + 0.2\nsqrt(144)\n\n# 变量与百分比\n单价 = 128\n数量 = 3\n单价 × 数量 - 15%\n20% of 150\n\n# 单位换算\n5 km to m\n90 min to hour\n\n# 分段汇总\n24\n36\nsum\navg\n\n// 空行会开始新的汇总段落。\n// 标签后加冒号；# 写标题；// 写注释。",
  },
];

export function createWorkspace(now: string, makeId: () => string): Workspace {
  const notes = examples.map((example) => createNote(makeId(), now, example.title, example.body));
  return { version: 1, notes, activeId: notes[0].id, theme: "paper", calculatorMode: "sidebar" };
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseWorkspace(input: unknown): Workspace {
  if (!record(input) || input.version !== 1)
    throw new Error("笔记格式或版本不受支持，原数据已保留。");
  if (!Array.isArray(input.notes) || input.notes.length > MAX_NOTES)
    throw new Error("笔记列表无效或超过 100 篇。");
  const theme = LEGACY_THEMES[input.theme as string] ?? input.theme;
  if (!THEME_IDS.includes(theme as Theme)) throw new Error("笔记主题配置无效。");
  const calculatorMode = input.calculatorMode ?? "sidebar";
  if (calculatorMode !== "sidebar" && calculatorMode !== "dialog")
    throw new Error("计算器显示配置无效。");
  const ids = new Set<string>();
  const notes = input.notes.map((note): Note => {
    if (
      !record(note) ||
      typeof note.id !== "string" ||
      !note.id ||
      note.id.length > 100 ||
      ids.has(note.id) ||
      typeof note.title !== "string" ||
      note.title.length > MAX_TITLE_LENGTH ||
      typeof note.body !== "string" ||
      note.body.length > MAX_NOTE_LENGTH ||
      typeof note.createdAt !== "string" ||
      !Number.isFinite(Date.parse(note.createdAt)) ||
      typeof note.updatedAt !== "string" ||
      !Number.isFinite(Date.parse(note.updatedAt)) ||
      typeof note.trashed !== "boolean"
    ) {
      throw new Error("笔记内容损坏或超出长度限制，原数据已保留。");
    }
    ids.add(note.id);
    return {
      id: note.id,
      title: note.title,
      body: note.body,
      createdAt: note.createdAt,
      updatedAt: note.updatedAt,
      trashed: note.trashed,
    };
  });
  if (input.activeId !== null && (typeof input.activeId !== "string" || !ids.has(input.activeId))) {
    throw new Error("当前笔记引用无效，原数据已保留。");
  }
  return { version: 1, notes, activeId: input.activeId, theme: theme as Theme, calculatorMode };
}
