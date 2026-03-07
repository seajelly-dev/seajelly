"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { usePathname } from "next/navigation";

export function RouteProgress() {
  const pathname = usePathname();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const prevPath = useRef(pathname);
  const timerRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const start = useCallback(() => {
    setProgress(0);
    setVisible(true);
    let p = 0;
    timerRef.current = setInterval(() => {
      p += (90 - p) * 0.08;
      setProgress(p);
    }, 50);
  }, []);

  const done = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setProgress(100);
    setTimeout(() => {
      setVisible(false);
      setProgress(0);
    }, 300);
  }, []);

  useEffect(() => {
    if (pathname !== prevPath.current) {
      start();
      const t = setTimeout(done, 150);
      prevPath.current = pathname;
      return () => clearTimeout(t);
    }
  }, [pathname, start, done]);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (href && href.startsWith("/") && href !== pathname) {
        start();
      }
    };
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [pathname, start]);

  if (!visible) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-9999 h-0.5">
      <div
        className="h-full bg-primary transition-[width] duration-150 ease-out"
        style={{ width: `${progress}%` }}
      />
    </div>
  );
}
