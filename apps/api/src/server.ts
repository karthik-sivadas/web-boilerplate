import { serve } from "@hono/node-server";
import { Server } from "node:http";
import type { createApp } from "./app";

export function listen(
  app: ReturnType<typeof createApp>["app"],
  port: number,
  hostname = "127.0.0.1",
) {
  const server = serve({
    fetch: app.fetch,
    port,
    hostname,
    serverOptions: { maxHeaderSize: 16384 },
  });
  if (!(server instanceof Server)) throw new Error("HTTP/1 server required.");
  server.headersTimeout = 10000;
  server.requestTimeout = 15000;
  server.keepAliveTimeout = 5000;
  server.setTimeout(15000);
  return server;
}
