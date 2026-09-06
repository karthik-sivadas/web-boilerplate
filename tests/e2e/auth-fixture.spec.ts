import { expect, test } from "@playwright/test";
import { signUpUI } from "./auth-fixtures";

test("signup fixture waits for verified workspace, not just response or URL", async ({
  page,
}) => {
  test.setTimeout(150_000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.goto("/sign-up");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let observe!: () => void;
  const requested = new Promise<void>((resolve) => {
    observe = resolve;
  });
  await page.route("**/api/auth/get-session**", async (route) => {
    observe();
    await held;
    await route.continue();
  });
  let completed = false;
  const signup = signUpUI(page).then(() => {
    completed = true;
  });
  try {
    await requested;
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { name: "Checking your session…" }),
    ).toBeVisible();
    expect(completed).toBe(false);
  } finally {
    release();
    await signup;
  }
  await expect(
    page.getByRole("heading", { name: "A clearer way to move work forward" }),
  ).toBeVisible();
  // The caller can now perform its direct-route audit without unloading signup navigation.
  await page.goto("/tasks");
  await expect(
    page.getByRole("button", { name: "New task", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
