"use client";

import { useI18n } from "@/lib/i18n/context";
import type { Locale } from "@/lib/i18n/types";
import { Languages, Check } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";

const LOCALES: { value: Locale; label: string }[] = [
  { value: "en", label: "English" },
  { value: "zh", label: "简体中文" },
];

export function LanguageSwitcher({
  variant = "ghost",
  size = "icon",
}: {
  variant?: "ghost" | "outline" | "default";
  size?: "icon" | "sm" | "default" | "icon-sm";
}) {
  const { locale, setLocale } = useI18n();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        id="language-switcher-trigger"
        render={<Button variant={variant} size={size} className="group" />}
      >
        <Languages className="size-4 transition-transform duration-300 group-hover:scale-110" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {LOCALES.map((l) => (
          <DropdownMenuItem
            key={l.value}
            onClick={() => setLocale(l.value)}
            className={`flex items-center justify-between ${locale === l.value ? "bg-accent font-medium" : ""}`}
          >
            {l.label}
            {locale === l.value && <Check className="ml-2 size-4" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
