import { localeUrl, text } from "../core/i18n.js";
export const locale = document.documentElement.lang.startsWith("zh")
  ? "zh"
  : "en";
export const t = (value: string, vars: Record<string, string | number> = {}) =>
  text(value, locale, vars);
export const localUrl = (input: string) => localeUrl(input, locale);
export function switchLanguage() {
  const next = locale === "zh" ? "en" : "zh";
  const url = new URL(location.href);
  url.searchParams.set("lang", next);
  location.assign(url.href);
}
