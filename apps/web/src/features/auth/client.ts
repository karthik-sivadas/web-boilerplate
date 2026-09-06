import { createAuthClient } from "better-auth/react";

// Same-origin calls keep session credentials in HttpOnly cookies; no URL,
// token, or session state is persisted in browser storage.
export const authClient = createAuthClient();
