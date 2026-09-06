// @vitest-environment node
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { developmentConfiguration } from "./development-config";
import { parse } from "dotenv";
import { parseEnv } from "node:util";
it.each([
  ["double quote and backslash", 'quote"and\\slash'],
  ["single quote", "quote'only"],
  ["backslashes", String.raw`two\\slashes`],
  ["literal backslash-n", String.raw`literal\ncharacters`],
  ["real newline", "first\nsecond"],
  ["hash and surrounding spaces", "  value # hash  "],
])(
  "preserves %s credentials through dotenv and Node --env-file",
  async (_label, suffix) => {
    const directory = await mkdtemp(join(tmpdir(), "config-roundtrip-"));
    const path = join(directory, "owned.env");
    const value = `synthetic-stable-prefix-000000000000:${suffix}`;
    const url = new URL("postgresql://fixture@127.0.0.1:55490/fixture_dev");
    url.password = value;
    try {
      await developmentConfiguration(path, {
        DATABASE_URL: url.href,
        BETTER_AUTH_SECRET: value,
      });
      const bytes = await readFile(path, "utf8");
      const second = await developmentConfiguration(path, {});
      for (const parsed of [second, parse(bytes), parseEnv(bytes)]) {
        expect(parsed.BETTER_AUTH_SECRET === value).toBe(true);
        expect(parsed.POSTGRES_PASSWORD === value).toBe(true);
        expect(parsed.DATABASE_URL === url.href).toBe(true);
      }
      const child = spawnSync(
        process.execPath,
        [
          `--env-file=${path}`,
          "-e",
          "const expected=JSON.parse(require('node:fs').readFileSync(0,'utf8'));process.stdout.write(String(Object.entries(expected).every(([key,value])=>process.env[key]===value)))",
        ],
        {
          env: { PATH: process.env.PATH },
          input: JSON.stringify({
            BETTER_AUTH_SECRET: value,
            POSTGRES_PASSWORD: value,
            DATABASE_URL: url.href,
          }),
          encoding: "utf8",
          timeout: 10000,
        },
      );
      expect(child.status).toBe(0);
      expect(child.stdout).toBe("true");
      expect((await readFile(path, "utf8")) === bytes).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
);
it("rejects unrepresentable values before creating a file and never rewrites an existing selection", async () => {
  const directory = await mkdtemp(join(tmpdir(), "config-reject-"));
  const path = join(directory, "owned.env");
  try {
    for (const value of [
      "synthetic-prefix-00000000000000000'\"`\nvalue",
      `synthetic-prefix-00000000000000000${String.fromCharCode(0)}`,
    ]) {
      await expect(
        developmentConfiguration(path, { BETTER_AUTH_SECRET: value }),
      ).rejects.toThrow();
      await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
    }
    await developmentConfiguration(path, {});
    const before = await readFile(path, "utf8");
    await developmentConfiguration(path, {
      BETTER_AUTH_SECRET: "synthetic-override-00000000000000000'\"`\n",
    });
    expect((await readFile(path, "utf8")) === before).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("rejects a selected parser-incompatible file without changing any bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "config-existing-"));
  const path = join(directory, "owned.env");
  const bytes =
    "DATABASE_URL=postgresql://fixture@127.0.0.1:55490/fixture_dev\nBETTER_AUTH_SECRET=" +
    JSON.stringify('synthetic-stable-prefix-00000000000"quote\\slash') +
    "\n";
  try {
    await writeFile(path, bytes, { mode: 0o600 });
    expect(
      parse(bytes).BETTER_AUTH_SECRET !== parseEnv(bytes).BETTER_AUTH_SECRET,
    ).toBe(true);
    await expect(developmentConfiguration(path, {})).rejects.toThrow(
      "not changed",
    );
    expect((await readFile(path, "utf8")) === bytes).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("the actual setup CLI works from a foreign cwd without opening default private stores", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workspace-setup-cli-"));
  const root = resolve(import.meta.dirname, "..");
  const path = join(directory, "owned.env");
  try {
    const run = () =>
      spawnSync(
        process.execPath,
        [
          resolve(root, "node_modules/tsx/dist/cli.mjs"),
          resolve(root, "scripts/local.ts"),
          "setup",
          `--config=${path}`,
        ],
        {
          cwd: directory,
          env: { PATH: process.env.PATH },
          encoding: "utf8",
          timeout: 15000,
        },
      );
    const first = run();
    expect(first.status).toBe(0);
    const bytes = await readFile(path, "utf8");
    const second = run();
    expect(second.status).toBe(0);
    expect((await readFile(path, "utf8")) === bytes).toBe(true);
    expect(first.stdout.includes("No database was migrated or reset")).toBe(
      true,
    );
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
it("creates stable restrictive owned config, loads dotenv, respects inherited values and never overwrites", async () => {
  const directory = await mkdtemp(join(tmpdir(), "workspace-config-fixture-"));
  const path = join(directory, "generated.env");
  try {
    const first = await developmentConfiguration(path, {
      POSTGRES_PORT: "55490",
      UNRELATED_PRIVATE_VALUE: "must-not-be-persisted",
    });
    const bytes = await readFile(path, "utf8");
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(bytes.includes("UNRELATED_PRIVATE_VALUE")).toBe(false);
    const second = await developmentConfiguration(path, {});
    expect(second.BETTER_AUTH_SECRET === first.BETTER_AUTH_SECRET).toBe(true);
    expect(second.DATABASE_URL === first.DATABASE_URL).toBe(true);
    expect(new URL(second.TEST_DATABASE_URL).pathname).toBe(
      "/web_boilerplate_test_admin",
    );
    const overridden = await developmentConfiguration(path, {
      BETTER_AUTH_URL: "http://localhost:3010",
    });
    expect(overridden.BETTER_AUTH_URL).toBe("http://localhost:3010");
    expect((await readFile(path, "utf8")) === bytes).toBe(true);
    const incomplete = join(directory, "existing.env");
    await writeFile(incomplete, "# existing operator file\n");
    await expect(developmentConfiguration(incomplete, {})).rejects.toThrow(
      "not changed",
    );
    expect(await readFile(incomplete, "utf8")).toBe(
      "# existing operator file\n",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
