import { createRequire } from "node:module";
import type { DatabaseSync } from "node:sqlite";

const require = createRequire(import.meta.url);

export const SqliteDatabase = require("node:sqlite")
  .DatabaseSync as typeof DatabaseSync;
export type { DatabaseSync };
