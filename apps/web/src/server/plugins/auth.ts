import { definePlugin } from "nitro";
import { closeAuth, initializeAuth } from "@/lib/auth/server";
import { createStartupGate } from "../startup-gate";
import { privateResponse } from "../response-policy";

export default definePlugin((nitroApp) => {
  // Installed synchronously before Nitro's Node preset captures fetch.
  const downstream = nitroApp.fetch;
  const gate = createStartupGate(
    async (request: Request) =>
      privateResponse(request, await downstream(request)),
    initializeAuth,
  );
  nitroApp.fetch = gate.fetch;
  nitroApp.hooks.hook("close", async () => {
    gate.dispose();
    await closeAuth();
  });
});
