// Consume DeepSeek/OpenAI SSE without retaining reasoning_content. Usage comes
// from the final chunk, including when the completion hits its output limit.
export async function readCompletion(
  response: Response,
  onDelta: (phase: "thinking" | "writing") => void,
) {
  if (!response.headers.get("content-type")?.includes("text/event-stream"))
    return response.json();
  if (!response.body) throw new Error("empty_model_stream");
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let buffer = "",
    content = "",
    model: string | undefined,
    usage: any;
  let finish: string | null = null,
    done = false;
  let bytes = 0;
  const frame = (event: string) => {
    const data = event
      .split("\n")
      .filter((s) => s.startsWith("data:"))
      .map((s) => s.slice(5).trimStart())
      .join("\n")
      .trim();
    if (!data) return;
    if (data === "[DONE]") {
      done = true;
      return;
    }
    const chunk = JSON.parse(data);
    if (chunk.error) throw new Error("model_stream_error");
    if (typeof chunk.model === "string") model = chunk.model;
    if (chunk.usage) usage = chunk.usage;
    const choice =
      chunk.choices?.find((c: any) => c.index === 0) ?? chunk.choices?.[0];
    if (choice?.finish_reason) finish = choice.finish_reason;
    if (
      typeof choice?.delta?.reasoning_content === "string" &&
      choice.delta.reasoning_content
    )
      onDelta("thinking");
    if (typeof choice?.delta?.content === "string" && choice.delta.content) {
      content += choice.delta.content;
      onDelta("writing");
    }
  };
  try {
    while (!done) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 16 * 1024 * 1024) throw new Error("model_stream_size");
      buffer += decoder.decode(chunk.value, { stream: true });
      // Normalize only complete lines: CR and LF can arrive in separate chunks.
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        frame(buffer.slice(0, boundary.index).replace(/\r\n/g, "\n"));
        buffer = buffer.slice(boundary.index + boundary[0].length);
        if (done) break;
      }
      if (buffer.length > 1024 * 1024)
        throw new Error("model_stream_frame_size");
    }
    if (!done || !finish) throw new Error("incomplete_model_stream");
    return {
      model,
      usage,
      choices: [{ finish_reason: finish, message: { content } }],
    };
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
