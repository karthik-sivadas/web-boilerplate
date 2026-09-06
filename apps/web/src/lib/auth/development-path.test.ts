// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { developmentDataDirectory } from "./development-path";

it("reuses the nearest fake workspace's root data path from the app cwd", async () => {
  const root = await mkdtemp(join(tmpdir(), "auth-workspace-path-"));
  try {
    await writeFile(join(root, "pnpm-workspace.yaml"), "packages: []\n");
    const app = join(root, "apps/web");
    await mkdir(app, { recursive: true });
    expect(await developmentDataDirectory(app)).toBe(join(root, ".data"));
    expect(await developmentDataDirectory(root)).toBe(join(root, ".data"));
    await writeFile(join(app, "pnpm-workspace.yaml"), "packages: []\n");
    expect(await developmentDataDirectory(app)).toBe(join(app, ".data"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("fails clearly outside a workspace rather than creating data", async () => {
  const root = await mkdtemp(join(tmpdir(), "auth-no-workspace-"));
  try {
    await expect(developmentDataDirectory(root)).rejects.toThrow(
      "refusing to create a replacement data store",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
