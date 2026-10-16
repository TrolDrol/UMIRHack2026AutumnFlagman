import { useEffect, useState, type ReactNode } from "react";
import s from "./ui.module.css";

export function AnimatedCollapse({ children }: { children: ReactNode }) {
  const [content, setContent] = useState(children);
  const [open, setOpen] = useState(!!children);
  useEffect(() => {
    if (children) {
      setContent(children);
      setOpen(true);
      return;
    }
    setOpen(false);
    const timer = window.setTimeout(() => setContent(null), 300);
    return () => window.clearTimeout(timer);
  }, [children]);
  return (
    <div
      className={s.collapse}
      data-open={open}
      aria-hidden={!open}
      inert={!open}
    >
      <div className={s.collapseInner}>{content}</div>
    </div>
  );
}
