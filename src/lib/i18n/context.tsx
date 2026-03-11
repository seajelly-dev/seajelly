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

const STORAGE_KEY = "seajelly-locale";

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

export function I18nProvider({
  children,
  initialLocale = "en",
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  // 使用服务端传入的 initialLocale 作为初始值，避免 Hydration Mismatch
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    // 同时写入 localStorage（客户端备用）和 Cookie（供 SSR 读取）
    localStorage.setItem(STORAGE_KEY, l);
    document.cookie = `${STORAGE_KEY}=${l}; path=/; max-age=31536000; SameSite=Lax`;
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
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

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
