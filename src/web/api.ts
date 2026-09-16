import { t } from "./i18n.js";
import { appUrl } from "./paths.js";
let csrf = "";
export function setCsrf(value: string) {
  csrf = value;
}
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const headers = new Headers(options?.headers);
  if (options?.method && !["GET", "HEAD"].includes(options.method))
    headers.set("X-CSRF-Token", csrf);
  const r = await fetch(appUrl(url), {
    ...options,
    headers,
    credentials: "same-origin",
  });
  const d = await r.json();
  if (options?.method && !["GET", "HEAD"].includes(options.method))
    window.dispatchEvent(new Event("ghtrends:usage"));
  if (r.headers.get("X-Research-Credit") === "returned")
    window.dispatchEvent(new Event("ghtrends:credit-returned"));
  if (d.retryAt)
    d.error =
      t(d.error) +
      " " +
      t("Resume at {time}", { time: new Date(d.retryAt).toLocaleString() });
  if (!r.ok)
    throw Object.assign(
      new Error(d.error || "The request could not be completed."),
      { status: r.status, ...d },
    );
  return d as T;
}
