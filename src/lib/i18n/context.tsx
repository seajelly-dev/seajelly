"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { Locale } from "./types";
import en, { type TranslationKeys } from "./en";
import zh from "./zh";

const dictionaries: Record<Locale, TranslationKeys> = { en, zh };

const STORAGE_KEY = "opencrab-locale";

function detectLocale(): Locale {
  if (typeof window === "undefined") return "en";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "en" || stored === "zh") return stored;
  const nav = navigator.language || "";
  if (nav.startsWith("zh")) return "zh";
  return "en";
}

type NestedKeyOf<T> = T extends string
  ? ""
  : {
      [K in keyof T & string]: T[K] extends string
        ? K
        : `${K}.${NestedKeyOf<T[K]>}`;
    }[keyof T & string];

type TranslationPath = NestedKeyOf<TranslationKeys>;

function getNestedValue(obj: unknown, path: string): string {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current == null || typeof current !== "object") return path;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current : path;
}

function interpolate(
  template: string,
  params?: Record<string, string | number>
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    params[key] !== undefined ? String(params[key]) : `{${key}}`
  );
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: TranslationPath, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>("en");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setLocaleState(detectLocale());
    setMounted(true);
  }, []);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    localStorage.setItem(STORAGE_KEY, l);
    document.documentElement.lang = l === "zh" ? "zh-CN" : "en";
  }, []);

  const t = useCallback(
    (key: TranslationPath, params?: Record<string, string | number>) => {
      const raw = getNestedValue(dictionaries[locale], key);
      return interpolate(raw, params);
    },
    [locale]
  );

  useEffect(() => {
    if (mounted) {
      document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
    }
  }, [locale, mounted]);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}

export function useT() {
  return useI18n().t;
}
