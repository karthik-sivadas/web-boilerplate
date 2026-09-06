import { createServerFn } from "@tanstack/react-start";
import {
  getRequestHeaders,
  setResponseStatus,
} from "@tanstack/react-start/server";
import { readSessionIdentity } from "@/lib/auth/server";
export type { UserDto } from "./identity";

export const getSessionIdentity = createServerFn({ method: "GET" }).handler(
  () => readSessionIdentity(getRequestHeaders()),
);

export const getCurrentUser = createServerFn({ method: "GET" }).handler(
  async () => (await readSessionIdentity(getRequestHeaders()))?.user ?? null,
);

/** Real callable authorization boundary. Neither identity nor user id is an input. */
export const getProtectedProfile = createServerFn({ method: "GET" }).handler(
  async () => {
    const identity = await readSessionIdentity(getRequestHeaders());
    if (!identity) {
      setResponseStatus(401);
      return new Response("Unauthorized", {
        status: 401,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "private, no-store",
        },
      });
    }
    return identity.user;
  },
);
