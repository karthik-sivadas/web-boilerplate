import { createServerFn } from "@tanstack/react-start";
import { getRequest, setResponseStatus } from "@tanstack/react-start/server";
import { readSessionIdentity } from "@/lib/auth/server";
export type { UserDto } from "./identity";

function requestIdentity() {
  const request = getRequest();
  return readSessionIdentity(request.headers, request.signal);
}
export const getSessionIdentity = createServerFn({ method: "GET" }).handler(
  () => requestIdentity(),
);

export const getCurrentUser = createServerFn({ method: "GET" }).handler(
  async () => (await requestIdentity())?.user ?? null,
);

/** Real callable authorization boundary. Neither identity nor user id is an input. */
export const getProtectedProfile = createServerFn({ method: "GET" }).handler(
  async () => {
    const identity = await requestIdentity();
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
