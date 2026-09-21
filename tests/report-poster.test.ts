import test from "node:test";
import assert from "node:assert/strict";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { wrapPosterText } from "../src/web/report-poster.js";

test("poster line wrapping preserves Chinese, Latin words and long tokens without overflow", () => {
  const measure = (s: string) =>
    [...s].reduce((n, c) => n + (/[^\x00-\xff]/.test(c) ? 2 : 1), 0);
  for (const input of [
    "开心锤锤：验证线下活动需求，再决定投入",
    "An opportunity for independent developers",
    "https://example.com/" + "a".repeat(100),
    "A first paragraph\n第二段：保留原文",
  ]) {
    const lines = wrapPosterText(input, 24, measure);
    assert.ok(lines.every((line) => measure(line) <= 24));
    assert.equal(lines.join("").replace(/\s/g, ""), input.replace(/\s/g, ""));
  }
});

test("share QR survives rasterization at the exported size and preserves report and language", () => {
  for (const url of [
    "https://ghtrends.dev/radar/report/9362d37fab178ee1?lang=zh",
    "https://ghtrends.dev/radar/report/43dede23c5a35035?lang=en",
  ]) {
    const qr = QRCode.create(url, { errorCorrectionLevel: "M" });
    const size = 196,
      matrix = qr.modules,
      padded = matrix.size + 8;
    const rgba = new Uint8ClampedArray(size * size * 4);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const row = Math.floor((y * padded) / size) - 4,
          col = Math.floor((x * padded) / size) - 4;
        const dark =
          row >= 0 &&
          col >= 0 &&
          row < matrix.size &&
          col < matrix.size &&
          matrix.get(row, col);
        const i = (y * size + x) * 4;
        rgba[i] = dark ? 24 : 255;
        rgba[i + 1] = dark ? 61 : 255;
        rgba[i + 2] = dark ? 52 : 255;
        rgba[i + 3] = 255;
      }
    assert.equal(jsQR(rgba, size, size)?.data, url);
  }
});
