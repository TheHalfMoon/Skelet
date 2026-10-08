import { openDatabase } from "../src/db.ts";
import { migrateUp } from "../src/migrate.ts";

const connectionString = process.env.SKELET_TEST_DATABASE_URL;
if (!connectionString) throw new Error("Test database URL is required");
const db = await openDatabase({ connectionString });
try {
  process.stdout.write(JSON.stringify(await migrateUp(db)));
} finally {
  await db.close();
}
