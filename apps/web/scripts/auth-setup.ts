import { closeAuth, initializeAuth } from "../src/lib/auth/server";

try {
  await initializeAuth();
  console.log("Better Auth migrations are up to date.");
} finally {
  await closeAuth();
}
