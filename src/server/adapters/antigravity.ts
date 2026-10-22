import {
  eventText,
  findEventText,
  isRecord,
  JsonlCliAgentAdapter,
  type DecodedCliEvent,
  type JsonCliAdapterOptions,
} from "./cli.js";

export type AntigravityAdapterOptions = JsonCliAdapterOptions;

function decodeAntigravity(value: Record<string, unknown>): readonly DecodedCliEvent[] {
  const type = String(value.type);
  const lowerType = type.toLowerCase();
  const message =
    eventText(value.error) ?? eventText(value.message) ?? eventText(value.detail);
  if (lowerType.includes("error") || isRecord(value.error)) {
    return [
      {
        type: "error",
        data: {
          code: "ANTIGRAVITY_ERROR",
          message: message ?? "Antigravity reported an error",
          providerEvent: type,
        },
      },
    ];
  }

  const text = findEventText(value);
  const completed =
    type === "result" || /(?:completed|complete|finished|done|success)$/i.test(type);
  if (text) {
    return [
      {
        type: "output",
        data: { content: text },
        outputObserved: true,
        completed,
      },
    ];
  }
  return [
    {
      type: "tool_activity",
      data: { providerEvent: type, payload: value },
      completed,
    },
  ];
}

const descriptor = {
  provider: "antigravity",
  executionArgs: (instruction: string) => [
    "--output-format",
    "stream-json",
    "--sandbox",
    "--mode",
    "plan",
    `--print=${instruction}`,
  ],
  decode: decodeAntigravity,
};

export class AntigravityAgentAdapter extends JsonlCliAgentAdapter {
  constructor(options: AntigravityAdapterOptions) {
    super(descriptor, options);
  }
}
