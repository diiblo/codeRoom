import { describe, expect, it } from "vitest";
import { AntigravityAgentAdapter } from "./antigravity.js";
import { CodexAgentAdapter } from "./codex.js";
import { OpenCodeAgentAdapter } from "./opencode.js";
import {
  createHostCliAdapter,
  HOST_CLI_PROVIDERS,
  type HostCliProvider,
} from "./registry.js";

describe("host CLI adapter registry", () => {
  it("expose les fournisseurs enregistrés sans lancer de processus", () => {
    expect(HOST_CLI_PROVIDERS).toEqual(["codex", "antigravity", "opencode"]);
    const spawn = () => {
      throw new Error("probe transport not used");
    };
    const adapters = HOST_CLI_PROVIDERS.map((provider) =>
      createHostCliAdapter({
        provider,
        executablePath: `${provider}.exe`,
        spawn,
      }),
    );

    expect(adapters).toHaveLength(3);
    expect(adapters[0]).toBeInstanceOf(CodexAgentAdapter);
    expect(adapters[1]).toBeInstanceOf(AntigravityAgentAdapter);
    expect(adapters[2]).toBeInstanceOf(OpenCodeAgentAdapter);
  });

  it("refuse un fournisseur qui n'est pas dans le catalogue TypeScript", () => {
    const provider = "claude" as HostCliProvider;
    expect(() =>
      createHostCliAdapter({
        provider,
        executablePath: "claude",
        spawn: () => {
          throw new Error("not used");
        },
      }),
    ).toThrow();
  });
});
