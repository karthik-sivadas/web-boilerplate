import { definePlugin } from "nitro";
import { webTransport } from "../web-transport";
export default definePlugin((nitroApp) => {
  const downstream = nitroApp.fetch;
  nitroApp.fetch = (request) => webTransport(request, downstream);
});
