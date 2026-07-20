export function inputToText(input) {
  switch (input?.type) {
    case "text":
      return input.text;
    case "skill":
      return `$${input.name}`;
    case "mention":
      return `@${input.name}`;
    case "localImage":
      return `[Local image: ${input.path}]`;
    case "image":
      return "[Image]";
    default:
      return `[${input?.type ?? "Unknown input"}]`;
  }
}

function excerpt(text, limit = 96) {
  const compact = text.replace(/\s+/g, " ").trim();
  return compact.length <= limit
    ? compact
    : `${compact.slice(0, limit - 1)}…`;
}

export function projectThread(thread) {
  const navigation = [];
  const turns = (thread.turns ?? [])
    .map((turn) => {
      const messages = [];

      for (const item of turn.items ?? []) {
        if (item.type === "userMessage") {
          const text = (item.content ?? [])
            .map(inputToText)
            .filter(Boolean)
            .join("\n");

          messages.push({ id: item.id, role: "user", text });
          navigation.push({
            id: `nav-${item.id}`,
            turnId: turn.id,
            messageId: item.id,
            text,
            label: excerpt(text) || "Untitled user message",
          });
        } else if (
          item.type === "agentMessage"
          && item.phase === "final_answer"
          && item.text
        ) {
          messages.push({ id: item.id, role: "assistant", text: item.text });
        }
      }

      return { id: turn.id, messages };
    })
    .filter((turn) => turn.messages.length > 0);

  return {
    id: thread.id,
    name: thread.name ?? null,
    preview: thread.preview ?? "",
    updatedAt: thread.updatedAt ?? null,
    turns,
    navigation,
  };
}
