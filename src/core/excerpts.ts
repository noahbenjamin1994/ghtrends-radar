/** Select unchanged passages, not a summary. Gaps are explicit and source order
 * is retained so quotations and their nearby limitations stay auditable. */
export function evidenceExcerpt(text: string, limit: number, focus = "") {
  if (text.length <= limit || !focus.trim()) return text.slice(0, limit);
  const terms = [
    ...new Set(
      [
        ...new Intl.Segmenter(undefined, { granularity: "word" }).segment(
          focus.toLowerCase(),
        ),
      ]
        .filter(
          (part) =>
            part.isWordLike &&
            part.segment.length >=
              (/\p{Script=Han}/u.test(part.segment) ? 2 : 3),
        )
        .map((part) => part.segment)
        .filter(
          (term) =>
            !/^(?:the|and|for|with|from|this|that|source|search|excerpt|query|market|language|placement|organic|title|snippet|https|com|www)$/.test(
              term,
            ),
        ),
    ),
  ].slice(0, 32);
  if (!terms.length) return text.slice(0, limit);
  // Windows retain context on either side, including price conditions/negation.
  // A long single paragraph is still searchable; line boundaries are optional.
  const windows = Array.from(
    { length: Math.ceil(text.length / 700) },
    (_, i) => {
      const start = Math.max(0, i * 700 - 160);
      const end = Math.min(text.length, (i + 1) * 700 + 240);
      const value = text.slice(start, end).toLowerCase();
      return { start, end, value };
    },
  );
  const weights = terms.map((term) =>
    Math.log1p(
      windows.length /
        Math.max(1, windows.filter((w) => w.value.includes(term)).length),
    ),
  );
  const ranked = windows
    .map((w) => ({
      ...w,
      score: terms.reduce(
        (score, term, i) => score + (w.value.includes(term) ? weights[i]! : 0),
        0,
      ),
    }))
    .filter((w) => w.score > 0)
    .sort((a, b) => b.score - a.score || a.start - b.start);
  if (!ranked.length) return text.slice(0, limit);
  const spans = [{ start: 0, end: Math.min(650, limit) }];
  const merge = (values: typeof spans) =>
    values
      .sort((a, b) => a.start - b.start)
      .reduce<typeof spans>((all, span) => {
        const previous = all.at(-1);
        if (previous && span.start <= previous.end)
          previous.end = Math.max(previous.end, span.end);
        else all.push({ ...span });
        return all;
      }, []);
  const separator = "\n\n[…]\n\n";
  for (const span of ranked) {
    const next = merge([...spans.map((s) => ({ ...s })), span]);
    const size =
      next.reduce((n, s) => n + s.end - s.start, 0) +
      (next.length - 1) * separator.length;
    if (size <= limit) spans.splice(0, spans.length, ...next);
  }
  return spans.map((s) => text.slice(s.start, s.end)).join(separator);
}
