import type { Response } from "express";

// Each connection starts with the full current snapshot, so reconnects need no
// replay buffer. Intermediaries may fall back to the existing JSON endpoint.
export function streamSnapshot<T>(
  res: Response,
  read: () => T | undefined,
  terminal: (value: T) => boolean,
) {
  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  let previous = "",
    ticks = 0;
  let timer: ReturnType<typeof setInterval> | undefined;
  const close = () => {
    clearInterval(timer);
    res.end();
  };
  const send = () => {
    try {
      const value = read();
      if (!value) return close();
      const data = JSON.stringify(value);
      if (data !== previous) {
        // A slow reader reconnects to a fresh snapshot, instead of accumulating
        // a potentially large report in this process's outbound buffer.
        if (res.writableLength > 512 * 1024) return close();
        res.write(`data: ${data}\n\n`);
        previous = data;
      } else if (++ticks % 15 === 0) res.write(": keepalive\n\n");
      if (terminal(value)) close();
    } catch {
      close();
    }
  };
  timer = setInterval(send, 1000).unref();
  const limit = setTimeout(close, 5 * 60_000).unref();
  res.on("close", () => {
    clearInterval(timer);
    clearTimeout(limit);
  });
  send();
}
