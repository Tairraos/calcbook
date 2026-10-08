// 侧栏设置行的语言按钮：字形显示「点击后切换到」的语言——英文界面显示「中」，
// 中文界面显示「En」。自绘 SVG（圆角方框 + 文字），currentColor 随主题变色。
import type { Lang } from "../domain/messages.ts";

export function LanguageGlyph({ lang }: { lang: Lang }) {
  return (
    <svg width="17" height="17" viewBox="0 0 17 17" aria-hidden="true" focusable="false">
      <rect
        x="1"
        y="1"
        width="15"
        height="15"
        rx="4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      {lang === "zh" ? (
        <text
          x="8.5"
          y="12.4"
          textAnchor="middle"
          fontSize="10"
          fontWeight="600"
          fill="currentColor"
        >
          中
        </text>
      ) : (
        <text
          x="8.5"
          y="11.9"
          textAnchor="middle"
          fontSize="8"
          fontWeight="700"
          letterSpacing="-0.3"
          fill="currentColor"
        >
          En
        </text>
      )}
    </svg>
  );
}
