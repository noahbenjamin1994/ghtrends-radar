import { t } from "./i18n.js";
import { appUrl } from "./paths.js";
let csrf = "";
export function setCsrf(value: string) {
  csrf = value;
}
/** Stream snapshots while supported; reconnect with polling on network/proxy errors. */
export function watchResearch<T>(
  url: string,
  receive: (value: T) => boolean,
  failed: (error: any) => void,
) {
  let stopped = false,
    stream: EventSource | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const controller = new AbortController();
  const stop = () => {
    stopped = true;
    stream?.close();
    clearTimeout(timer);
    controller.abort();
  };
  const accept = (value: T) => {
    if (!stopped && receive(value)) stop();
  };
  const poll = async () => {
    try {
      accept(await api<T>(url, { signal: controller.signal }));
    } catch (error) {
      if (stopped) return;
      failed(error);
      if ([401, 403, 404].includes((error as any).status)) return stop();
    }
    if (!stopped) timer = setTimeout(poll, 3000);
  };
  const fallback = () => {
    stream?.close();
    clearTimeout(timer);
    void poll();
  };
  if (typeof EventSource === "undefined") void poll();
  else {
    stream = new EventSource(
      appUrl(url + (url.includes("?") ? "&" : "?") + "stream=1"),
    );
    // Also cover intermediaries that hold response headers indefinitely.
    timer = setTimeout(fallback, 10000);
    stream.onmessage = (event) => {
      clearTimeout(timer);
      try {
        accept(JSON.parse(event.data));
      } catch {
        fallback();
      }
    };
    stream.onerror = () => {
      if (!stopped) fallback();
    };
  }
  return stop;
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
  if (d?.retryAt)
    d.error =
      t(d.error) +
      " " +
      t("Resume at {time}", { time: new Date(d.retryAt).toLocaleString() });
  if (!r.ok)
    throw Object.assign(
      new Error(d?.error || "The request could not be completed."),
      { status: r.status, ...d },
    );
  return d as T;
}
