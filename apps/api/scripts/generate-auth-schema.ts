import { writeFile } from "node:fs/promises";
import { getMigrations } from "better-auth/db/migration";
import { authOptions } from "../src/auth/options";
import { testDatabase } from "../src/infrastructure/test-database";

const db = await testDatabase();
try {
  const plan = await getMigrations(
    authOptions(db.planner, {
      origin: "http://localhost:3000",
      secret: "synthetic-schema-generation-secret-000000000000",
    }),
  );
  if (plan.schemaProblems.length || plan.unsafeChanges.length)
    throw new Error("Unsafe generated schema.");
  await writeFile(
    new URL("../migrations/001-auth.sql", import.meta.url),
    `-- Generated from Better Auth 1.7.3 authOptions; review before applying.\n${await plan.compileMigrations()}\n`,
  );
} finally {
  await db.close();
}
