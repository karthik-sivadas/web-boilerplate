import { createFileRoute } from "@tanstack/react-router";
import { proxyApi } from "../../server/api-transport";
const handle = ({ request }: { request: Request }) => proxyApi(request);
export const Route = createFileRoute("/api/$")({
  server: {
    handlers: {
      GET: handle,
      POST: handle,
      PATCH: handle,
      PUT: handle,
      DELETE: handle,
      OPTIONS: handle,
      HEAD: handle,
    },
  },
});
