export type Locale = "en" | "zh";

export type TranslationDict = {
  [key: string]: string | TranslationDict;
};
