import { getStorageConfig } from "./db/config.js";
import { openDatabase } from "./db/database.js";
import { buildApp } from "./app.js";

const { databasePath } = getStorageConfig();
let database: ReturnType<typeof openDatabase>;

try {
  database = openDatabase(databasePath);
} catch {
  console.error("Échec de l'initialisation SQLite ; démarrage interrompu.");
  process.exit(1);
}

const app = buildApp(database);
app.addHook("onClose", (_instance, done) => {
  database.close();
  done();
});
const port = Number.parseInt(process.env.CODE_ROOM_PORT ?? "3000", 10);
const host = process.env.CODE_ROOM_HOST ?? "127.0.0.1";

try {
  await app.listen({ port, host });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
