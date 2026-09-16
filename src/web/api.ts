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
  if (!r.ok)
    throw Object.assign(
      new Error(d.error || "The request could not be completed."),
      { status: r.status, ...d },
    );
  return d as T;
}
