import type { AgentAdapter } from "./contract.js";
import { AntigravityAgentAdapter } from "./antigravity.js";
import type { JsonCliAdapterOptions } from "./cli.js";
import { CodexAgentAdapter } from "./codex.js";
import { OpenCodeAgentAdapter } from "./opencode.js";

export const HOST_CLI_PROVIDERS = ["codex", "antigravity", "opencode"] as const;
export type HostCliProvider = (typeof HOST_CLI_PROVIDERS)[number];

export type HostCliAdapterOptions = JsonCliAdapterOptions & {
  provider: HostCliProvider;
  model?: string;
};

/**
 * Keep provider-specific command construction behind one explicit registry.
 * The runner still supplies the process transport; this factory never spawns.
 */
export function createHostCliAdapter(options: HostCliAdapterOptions): AgentAdapter {
  switch (options.provider) {
    case "codex":
      return new CodexAgentAdapter(options);
    case "antigravity":
      return new AntigravityAgentAdapter(options);
    case "opencode":
      return new OpenCodeAgentAdapter(options);
    default:
      throw new Error(`Unsupported host CLI provider: ${String(options.provider)}`);
  }
}
