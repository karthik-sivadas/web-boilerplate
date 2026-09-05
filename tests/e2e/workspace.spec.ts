import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

const unexpectedBrowserMessages = new WeakMap<Page, string[]>();
const expectedNotFoundNavigation = new WeakSet<Page>();

test.beforeEach(async ({ page }) => {
  const messages: string[] = [];
  unexpectedBrowserMessages.set(page, messages);
  page.on("pageerror", (error) => messages.push(`pageerror: ${error.message}`));
  page.on("console", (message) => {
    const expected404 =
      expectedNotFoundNavigation.has(page) &&
      message.type() === "error" &&
      message.text() ===
        "Failed to load resource: the server responded with a status of 404 ()";
    if (
      !expected404 &&
      (message.type() === "error" ||
        (message.type() === "warning" && /hydration/i.test(message.text())))
    )
      messages.push(`console ${message.type()}: ${message.text()}`);
  });
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
});

test.afterEach(({ page }) => {
  expect(unexpectedBrowserMessages.get(page) ?? []).toEqual([]);
});

async function expectNoSeriousAxeIssues(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(
    results.violations.filter((violation) =>
      ["serious", "critical"].includes(violation.impact ?? ""),
    ),
  ).toEqual([]);
}

test("creates and renames a project, completes a task journey, persists, resets, and handles 404", async ({
  page,
  request,
}) => {
  const health = await request.get("/api/health");
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
    .locator("article")
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
  await expect(page.getByLabel("Filter by project")).toHaveValue(/project-/);
  await page.getByRole("button", { name: "New task" }).click();
  await page.getByLabel("Task title").fill("Prepare launch brief");
  await page.getByLabel("Description").fill("Share milestones with the team.");
  await page.getByRole("button", { name: "Create task" }).click();
  await expect(page.getByText("Prepare launch brief")).toBeVisible();

  const taskRow = page
    .locator("li")
    .filter({ hasText: "Prepare launch brief" });
  await taskRow.getByRole("button", { name: "Edit" }).click();
  await page.locator('select[name="status"]').selectOption("done");
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.getByLabel("Search tasks").fill("launch");
  await page.getByLabel("Filter by status").selectOption("done");
  await expect(page.getByText("Prepare launch brief")).toBeVisible();
  await page.reload();
  await expect(page.getByText("Prepare launch brief")).toBeVisible();

  await page.goto("/projects/p-archive");
  await expect(page.getByText(/cannot receive new tasks/i)).toBeVisible();
  await page.getByRole("link", { name: /View in tasks/i }).click();
  await page.getByRole("button", { name: "New task" }).click();
  await expect(
    page.getByRole("dialog").getByLabel("Project"),
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
  await expect(page.getByText("Prepare launch brief")).not.toBeVisible();

  await page.getByRole("link", { name: "Demo settings", exact: true }).click();
  await page.getByRole("button", { name: "Reset data" }).click();
  await page.getByRole("button", { name: "Reset demo data" }).click();
  await page.getByRole("link", { name: "Projects", exact: true }).click();
  await expect(page.getByText("Launch brief")).not.toBeVisible();
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
    "/projects/p-foundation",
  ]) {
    await page.goto(route);
    await expectNoSeriousAxeIssues(page);
  }

  await page.goto("/tasks");
  const trigger = page.getByRole("button", { name: "New task" });
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
