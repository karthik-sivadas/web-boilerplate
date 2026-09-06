import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { signUpUI, seedWorkspace } from "./auth-fixtures";
const fixtureIds = new WeakMap<Page, { foundation: string; archive: string }>();

const unexpectedBrowserMessages = new WeakMap<Page, string[]>();
const expectedNotFoundNavigation = new WeakSet<Page>();

test.beforeEach(async ({ page }) => {
  test.setTimeout(150_000);
  const messages: string[] = [];
  unexpectedBrowserMessages.set(page, messages);
  page.on("pageerror", (error) => messages.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    const expected404 =
      expectedNotFoundNavigation.has(page) &&
      message.type() === "error" &&
      (message.text() ===
        "Failed to load resource: the server responded with a status of 404 ()" ||
        message.text().includes("TypeError: Failed to fetch"));
    // Signup fixtures pace only real server-reported rate windows; unrelated errors still fail.
    const expectedFixtureRateLimit =
      message.type() === "error" &&
      message.text().includes("429") &&
      message.location().url.includes("/api/auth/sign-up/email");
    if (
      !expected404 &&
      !expectedFixtureRateLimit &&
      (message.type() === "error" ||
        (message.type() === "warning" && /hydration/i.test(message.text())))
    )
      messages.push(`console ${message.type()}: ${message.text()}`);
  });
  await page.goto("/sign-up");
  await expectNoSeriousAxeIssues(page);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "ltr");
  await page.evaluate(() => localStorage.clear());
  await signUpUI(page);
  await expect(page).toHaveURL(/\/$/);
  const fixture = await seedWorkspace(page.request, new URL(page.url()).origin);
  fixtureIds.set(page, {
    foundation: fixture.projects.find(
      (project) => project.name === "Foundation refresh",
    )!.id,
    archive: fixture.projects.find((project) => project.archived)!.id,
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "A clearer way to move work forward" }),
  ).toBeVisible();
});

test.afterEach(({ page }) => {
  expect(unexpectedBrowserMessages.get(page) ?? []).toEqual([]);
});

async function expectNoSeriousAxeIssues(page: Page) {
  // Aria exposes entering/exiting state; audit settled colors, not the fade's intermediate opacity.
  await expect(page.locator("[data-entering], [data-exiting]")).toHaveCount(0);
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
}

test("creates and renames a project, completes a task journey, persists, confirms project deletion, and handles 404", async ({
  page,
  request,
}) => {
  expect(
    await page
      .locator("body")
      .evaluate((element) => getComputedStyle(element).fontFamily),
  ).toContain("Outfit");
  expect(
    await page
      .locator("h1")
      .evaluate((element) => getComputedStyle(element).fontFamily),
  ).toContain("Oxanium");
  const health = await request.get("/health/live");
  expect(health.status()).toBe(200);
  expect(health.headers()["cache-control"]).toBe("no-store");
  expect(health.headers()["x-content-type-options"]).toBe("nosniff");
  await expect(health.json()).resolves.toEqual({ status: "ok" });
  const stylesheet = await page
    .locator('link[rel="stylesheet"]')
    .first()
    .getAttribute("href");
  expect(stylesheet).toBeTruthy();
  expect((await request.get(stylesheet as string)).status()).toBe(200);

  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page.getByRole("button", { name: "New project" }).click();
  await page.getByLabel("Project name").fill("Launch planning");
  await page.getByLabel("Description").fill("Prepare the next release.");
  await page.getByRole("button", { name: "Save project" }).click();
  const projectCard = page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Launch planning" });
  await expect(projectCard).toBeVisible();
  await projectCard.getByRole("link", { name: "Open" }).click();
  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Project name").fill("Launch brief");
  await page.getByRole("button", { name: "Save project" }).click();
  await expect(
    page.getByRole("heading", { name: "Launch brief", level: 1 }),
  ).toBeVisible();

  await page.getByRole("link", { name: /View in tasks/i }).click();
  await expect(
    page.getByRole("button", { name: /Filter by project/ }),
  ).toContainText("Launch brief");
  await page.getByRole("button", { name: "New task" }).click();
  await page.getByLabel("Task title").fill("Prepare launch brief");
  await page.getByLabel("Description").fill("Share milestones with the team.");
  await page.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByText("Prepare launch brief")).toBeVisible();

  const taskRow = page
    .locator("li")
    .filter({ hasText: "Prepare launch brief" });
  await taskRow.getByRole("button", { name: "Edit" }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: /Status/ })
    .click();
  await page.getByRole("option", { name: "Done", exact: true }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByLabel("Search tasks").fill("launch");
  await page.getByRole("button", { name: /Filter by status/ }).click();
  await page.getByRole("option", { name: "Done", exact: true }).click();
  await expect(page.getByText("Prepare launch brief")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Prepare launch brief")).toBeVisible();

  await page.goto(`/projects/${fixtureIds.get(page)!.archive}`);
  await expect(page.getByText(/cannot receive new tasks/i)).toBeVisible();
  await page.getByRole("link", { name: /View in tasks/i }).click();
  await page.getByRole("button", { name: "New task" }).click();
  await expect(
    page.getByRole("dialog").getByRole("button", { name: /Project/ }),
  ).not.toContainText("Completed experiments");
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.goto("/tasks?project=not-a-real-project");
  await expect(page.getByText("4 matching tasks")).toBeVisible();
  await page.goto("/tasks");
  await page.getByLabel("Search tasks").fill("Prepare launch brief");
  await taskRow
    .getByRole("button", { name: /Delete Prepare launch brief/i })
    .click();
  await page.getByRole("button", { name: "Delete task" }).click();
  await expect(
    page.getByText("Prepare launch brief", { exact: true }),
  ).not.toBeVisible();

  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await page
    .locator('[data-slot="card"]')
    .filter({ hasText: "Launch brief" })
    .getByRole("link", { name: "Open" })
    .click();
  await page
    .getByRole("button", { name: "Delete project", exact: true })
    .click();
  await page.getByLabel("Confirm project name").fill("Launch brief");
  await page.getByRole("button", { name: "Delete permanently" }).click();
  await expect(
    page.getByRole("heading", { name: "Launch brief", exact: true }),
  ).toHaveCount(0);
  expectedNotFoundNavigation.add(page);
  await page.goto("/missing");
  await expect(
    page.getByRole("heading", { name: /not in this workspace/i }),
  ).toBeVisible();
});

test("open dialogs trap and restore focus, and every primary screen has no serious axe issues", async ({
  page,
}) => {
  for (const route of [
    "/",
    "/projects",
    "/tasks",
    "/settings",
    `/projects/${fixtureIds.get(page)!.foundation}`,
  ]) {
    await page.goto(route);
    await expectNoSeriousAxeIssues(page);
  }

  await page.goto("/tasks");
  const trigger = page.getByRole("button", { name: "New task" });
  expect(
    await trigger.evaluate((element) => getComputedStyle(element).borderRadius),
  ).toBe("0px");
  expect(
    await trigger.evaluate((element) => getComputedStyle(element).cursor),
  ).toBe("pointer");
  await trigger.focus();
  await trigger.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expectNoSeriousAxeIssues(page);
  await page.keyboard.press("Tab");
  expect(
    await dialog.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});
