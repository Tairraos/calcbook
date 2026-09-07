import type { ButtonHTMLAttributes } from "react";

export function IconButton({
  title,
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { title: string }) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`}
      title={title}
      aria-label={title}
      {...props}
    >
      {children}
    </button>
  );
}
