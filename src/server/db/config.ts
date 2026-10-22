import { join, resolve } from "node:path";

export type StorageConfig = {
  dataDirectory: string;
  databasePath: string;
  workspacesDirectory: string;
};

function readValue(environment: NodeJS.ProcessEnv, name: string) {
  const value = environment[name]?.trim();
  return value || undefined;
}

export function getStorageConfig(
  environment: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): StorageConfig {
  const dataDirectory = resolve(
    cwd,
    readValue(environment, "CODE_ROOM_DATA_DIR") ?? ".data",
  );
  const configuredDatabasePath = readValue(environment, "CODE_ROOM_DATABASE_PATH");
  const databasePath =
    configuredDatabasePath === ":memory:"
      ? ":memory:"
      : resolve(cwd, configuredDatabasePath ?? join(dataDirectory, "coderoom.sqlite"));
  const workspacesDirectory = resolve(
    cwd,
    readValue(environment, "CODE_ROOM_WORKSPACES_DIR") ?? ".runtime/workspaces",
  );

  return { dataDirectory, databasePath, workspacesDirectory };
}
