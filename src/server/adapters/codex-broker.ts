import { createBrokerCliSpawn, type BrokerCliSpawnOptions } from "./cli-broker.js";
import type { CodexSpawn } from "./codex.js";

export type BrokerCodexSpawnOptions = Omit<BrokerCliSpawnOptions, "toolId">;

export function createBrokerCodexSpawn(options: BrokerCodexSpawnOptions): CodexSpawn {
  return createBrokerCliSpawn({ ...options, toolId: "codex" });
}
