import { expect, type Page } from "@playwright/test";

/** SSR controls are actionable before their React handlers exist. Probe the
 * existing React Aria focus state, not document load or a private React global.
 * Refocus on each poll: focusing once before hydration does not replay focus.
 */
export async function waitForAuthInteractive(page: Page) {
  const submit = page.getByRole("button", {
    name: /^(Create account|Sign in)$/,
  });
  await expect(async () => {
    await submit.blur();
    await submit.focus();
    expect(await submit.getAttribute("data-focused")).toBe("true");
  }).toPass({ timeout: 30_000 });
}
