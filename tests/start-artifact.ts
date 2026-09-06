import { artifactRuntime } from "./artifact-runtime";
const stopped = new Promise<void>((resolve) => {
  process.once("SIGTERM", resolve);
  process.once("SIGINT", resolve);
});
let runtime: Awaited<ReturnType<typeof artifactRuntime>> | undefined;
try {
  runtime = await artifactRuntime(4173);
  console.log("Owned web/API artifacts ready for browser tests.");
  await stopped;
} catch {
  console.error(
    "Owned artifact startup failed; no development database was used.",
  );
  process.exitCode = 1;
} finally {
  await runtime?.close();
}
