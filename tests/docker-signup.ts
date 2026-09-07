import type { Page } from "playwright";

export async function submitDockerSignup(page: Page) {
  // Observe both failures immediately, including while click is still pending
  // and when browser cleanup rejects the response waiter after a failed click.
  const [response] = await Promise.all([
    page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/auth/sign-up/email" &&
        response.request().method() === "POST",
    ),
    page.getByRole("button", { name: "Create account", exact: true }).click(),
  ]);
  return response;
}
