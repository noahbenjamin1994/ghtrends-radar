import { useEffect, useRef } from "react";

/** Small reading aid: active chapter, keyboard links and no scroll-time React rendering. */
export function ReportReading({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = ref.current!;
    const links = [...nav.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')];
    const sections = links.map((link) =>
      document.getElementById(link.hash.slice(1)),
    );
    let frame = 0;
    const update = () => {
      frame = 0;
      let active = 0;
      sections.forEach((el, i) => {
        if (el && el.getBoundingClientRect().top <= 160) active = i;
      });
      links.forEach((link, i) => {
        if (i === active) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      });
    };
    const scroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", scroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", scroll);
      cancelAnimationFrame(frame);
    };
  }, [children]);
  return (
    <nav
      ref={ref}
      className="report-nav"
      aria-label={
        document.documentElement.lang.startsWith("zh")
          ? "报告章节"
          : "Report sections"
      }
    >
      {children}
    </nav>
  );
}
