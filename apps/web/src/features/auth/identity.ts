export type UserDto = { id: string; name: string; email: string };
/** Session id is an invalidation identity, never the bearer token. */
export type SessionIdentity = { user: UserDto; sessionId: string };
