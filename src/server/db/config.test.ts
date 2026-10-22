import { describe, expect, it } from "vitest";
import { getStorageConfig } from "./config.js";

describe("storage configuration", () => {
  it("resolves explicit Docker paths without relying on the process cwd", () => {
    expect(
      getStorageConfig(
        {
          CODE_ROOM_DATA_DIR: "/var/lib/coderoom",
          CODE_ROOM_WORKSPACES_DIR: "/workspaces",
        },
        "/workspace",
      ),
    ).toEqual({
      dataDirectory: "/var/lib/coderoom",
      databasePath: "/var/lib/coderoom/coderoom.sqlite",
      workspacesDirectory: "/workspaces",
    });
  });

  it("uses documented local defaults", () => {
    expect(getStorageConfig({}, "/workspace")).toEqual({
      dataDirectory: "/workspace/.data",
      databasePath: "/workspace/.data/coderoom.sqlite",
      workspacesDirectory: "/workspace/.runtime/workspaces",
    });
  });
});
