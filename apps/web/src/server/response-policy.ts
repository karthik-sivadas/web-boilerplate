/** Final Fetch response policy, including Router redirects and raw server-function responses. */
export function privateResponse(
  request: Request,
  response: Response,
): Response {
  if (new URL(request.url).pathname === "/api/health") return response;
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "private, no-store");
  // Cloning Headers preserves distinct Set-Cookie entries, unlike joining their values.
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
