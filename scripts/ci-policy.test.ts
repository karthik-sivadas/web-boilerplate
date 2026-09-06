// @vitest-environment node
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
it("retains the reviewed CI action SHAs, fixed runner and read-only token permissions", async () => {
  const source = await readFile(
    new URL("../.github/workflows/ci.yml", import.meta.url),
    "utf8",
  );
  const allowed = new Set([
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
    "pnpm/action-setup@ea17c68df8912ef543352723c149a84f56e3d413",
    "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
    "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a",
  ]);
  const used = [...source.matchAll(/uses:\s*(\S+)/g)].map((match) => match[1]);
  expect(used.every((action) => allowed.has(action!))).toBe(true);
  expect([...allowed].every((action) => used.includes(action))).toBe(true);
  expect(/permissions:\s*\n\s+contents: read\s*\n/.test(source)).toBe(true);
  expect(
    [...source.matchAll(/runs-on:\s*(\S+)/g)].every(
      (match) => match[1] === "ubuntu-24.04",
    ),
  ).toBe(true);
  expect(source.includes("pnpm test:docker")).toBe(true);
  expect(source.includes("postgres:16.15-bookworm")).toBe(true);
});
