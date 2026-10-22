import {
  eventText,
  findEventText,
  isRecord,
  JsonlCliAgentAdapter,
  type DecodedCliEvent,
  type JsonCliAdapterOptions,
} from "./cli.js";

export type OpenCodeAdapterOptions = JsonCliAdapterOptions & {
  /** Optional provider/model selector, for example `openai/gpt-5.6-luna`. */
  model?: string;
};

function decodeOpenCode(value: Record<string, unknown>): readonly DecodedCliEvent[] {
  const type = String(value.type);
  const lowerType = type.toLowerCase();
  const message =
    eventText(value.error) ?? eventText(value.message) ?? eventText(value.detail);
  if (lowerType.includes("error") || isRecord(value.error)) {
    return [
      {
        type: "error",
        data: {
          code: "OPENCODE_ERROR",
          message: message ?? "OpenCode reported an error",
          providerEvent: type,
        },
      },
    ];
  }

  const text = findEventText(value);
  const completed =
    type === "result" ||
    /(?:completed|complete|finished|done|success)$/i.test(type) ||
    (type === "step_finish" && value.reason === "stop");
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

function createDescriptor(model: string | undefined) {
  return {
    provider: "opencode",
    authArgs: ["auth", "list", "--format", "json"],
    executionArgs: (instruction: string) => [
      "run",
      "--format",
      "json",
      "--pure",
      ...(model ? ["--model", model] : []),
      instruction,
    ],
    decode: decodeOpenCode,
  };
}

export class OpenCodeAgentAdapter extends JsonlCliAgentAdapter {
  constructor(options: OpenCodeAdapterOptions) {
    super(createDescriptor(options.model), options);
  }
}
