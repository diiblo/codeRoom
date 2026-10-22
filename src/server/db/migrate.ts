import { getStorageConfig } from "./config.js";
import { openDatabase } from "./database.js";

const { databasePath } = getStorageConfig();

try {
  const database = openDatabase(databasePath);
  database.close();
  console.log(`Migrations appliquées : ${databasePath}`);
} catch {
  console.error("Échec des migrations SQLite ; démarrage interrompu.");
  process.exitCode = 1;
}
