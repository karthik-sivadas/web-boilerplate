import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("shared locale path mirrors layout and preserves Aria selection, portal focus, dismissal and consent in RTL", async ({
  page,
  isMobile,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:4174");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  if (!isMobile) {
    const sidebar = await page.locator("aside").boundingBox();
    const content = await page.locator("#content").boundingBox();
    expect(sidebar!.x).toBeGreaterThan(content!.x);
  }
  const trigger = page.getByRole("button", { name: "New task", exact: true });
  await trigger.focus();
  await trigger.press("Enter");
  const dialog = page.getByRole("dialog", { name: "New task", exact: true });
  await expect(dialog).toBeVisible();
  expect(
    await dialog.evaluate((element) => getComputedStyle(element).direction),
  ).toBe("rtl");
  const bounds = await dialog.boundingBox();
  expect(
    Math.abs(bounds!.x + bounds!.width / 2 - page.viewportSize()!.width / 2),
  ).toBeLessThan(3);
  await dialog.getByLabel("Task title").fill("RTL keyboard task");
  const status = dialog.getByRole("button", { name: /Status/ });
  await status.focus();
  await status.press("ArrowDown");
  await expect(page.getByRole("listbox")).toBeVisible();
  expect(
    await page
      .getByRole("listbox")
      .evaluate((element) => getComputedStyle(element).direction),
  ).toBe("rtl");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await expect(status).toContainText("Done");
  await dialog.getByRole("button", { name: "Create task" }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.locator("li").filter({ hasText: "RTL keyboard task" }),
  ).toContainText("Done");
  await expect(trigger).toBeFocused();
  await trigger.press("Enter");
  await page.keyboard.press("Tab");
  expect(
    await dialog.evaluate((element) =>
      element.contains(document.activeElement),
    ),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await page
    .locator('[data-slot="dialog-overlay"]')
    .click({ position: { x: 2, y: 2 } });
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await page.getByRole("link", { name: "Demo settings", exact: true }).click();
  const reset = page.getByRole("button", { name: "Reset data", exact: true });
  await reset.click();
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Cancel", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("alertdialog")).not.toBeVisible();
  await expect(reset).toBeFocused();
  const axe = await new AxeBuilder({ page }).analyze();
  expect(
    axe.violations.filter((v) =>
      ["serious", "critical"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);
  expect(errors).toEqual([]);
});
