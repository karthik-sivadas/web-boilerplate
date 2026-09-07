// @vitest-environment node
import { resolve } from "node:path";
import { ESLint } from "eslint";
import tseslint from "typescript-eslint";
import { expect, it } from "vitest";
import { boundaryPlugin } from "./boundaries";
const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ["**/*.ts", "**/*.tsx"],
      languageOptions: { parser: tseslint.parser },
      plugins: { architecture: boundaryPlugin },
      rules: { "architecture/layer-boundaries": "error" },
    },
  ],
});
const root = resolve(import.meta.dirname, "..");
it("enforces real consumer imports, including relative and dynamic-import bypasses", async () => {
  for (const [file, code] of [
    [
      "apps/web/src/boundary-consumer.ts",
      'import { createApp } from "../../api/src/app";',
    ],
    [
      "apps/web/src/boundary-consumer.ts",
      'export * from "../../../packages/workspace-core/src/index";',
    ],
    [
      "apps/web/src/boundary-consumer.ts",
      'const runtime = import("../../api/src/app");',
    ],
    [
      "apps/web/src/boundary-consumer.ts",
      'import { betterAuth } from "better-auth";',
    ],
    [
      "apps/web/src/boundary-consumer.ts",
      'import pg from "../../api/node_modules/pg/lib/index.js";',
    ],
    ["apps/web/src/boundary-consumer.ts", 'const pg = require("pg");'],
    [
      "apps/web/src/boundary-consumer.ts",
      'import { developmentConfiguration } from "../../../scripts/development-config";',
    ],
    [
      "packages/ui/src/boundary-consumer.ts",
      'import type { WorkspaceDto } from "../../contracts/src/v1/index";',
    ],
    [
      "packages/workspace-core/src/domain/boundary-consumer.ts",
      'import { workspaceApplication } from "../application/workspace";',
    ],
    [
      "packages/workspace-core/src/domain/boundary-consumer.ts",
      "const now = new Date();",
    ],
    [
      "packages/contracts/src/v1/boundary-consumer.ts",
      'import { transition } from "../../../workspace-core/src/index";',
    ],
  ]) {
    const [result] = await eslint.lintText(code!, {
      filePath: resolve(root, file!),
    });
    expect(
      result?.messages.some(
        (message) => message.ruleId === "architecture/layer-boundaries",
      ),
      `${file}: ${code}`,
    ).toBe(true);
  }
});
it.each([
  [
    "template import",
    "apps/web/src/consumer.ts",
    "const backend = import(`../../api/src/app`);",
  ],
  [
    "computed import",
    "apps/web/src/consumer.ts",
    'const target="../../api/src/app";const backend=import(target);',
  ],
  [
    "interpolated import",
    "apps/web/src/consumer.ts",
    'const target="app";const backend=import(`../../api/src/${target}`);',
  ],
  [
    "computed require",
    "packages/ui/src/consumer.ts",
    'const target="pg";const backend=require(target);',
  ],
  [
    "domain barrel",
    "packages/workspace-core/src/domain/consumer.ts",
    'import {workspaceApplication} from "../index";',
  ],
  [
    "test-module bypass",
    "packages/workspace-core/src/domain/consumer.ts",
    'import "./workspace.test";',
  ],
  [
    "domain package alias",
    "packages/workspace-core/src/domain/consumer.ts",
    'import {workspaceApplication} from "@workspace/core";',
  ],
  [
    "web package alias",
    "apps/web/src/consumer.ts",
    'import {workspaceApplication} from "@workspace/core";',
  ],
  [
    "web path alias from core",
    "packages/workspace-core/src/domain/consumer.ts",
    'import {readSessionIdentity} from "@/lib/auth/server";',
  ],
])("blocks %s", async (_name, file, code) => {
  const [result] = await eslint.lintText(code, {
    filePath: resolve(root, file),
  });
  expect(
    result?.messages.some(
      (message) => message.ruleId === "architecture/layer-boundaries",
    ),
  ).toBe(true);
});
it.each([
  "node:sqlite",
  "sqlite",
  "sqlite3",
  "better-sqlite3",
  "@libsql/client",
  "@sqlite.org/sqlite-wasm",
])("rejects SQLite driver %s in application layers", async (driver) => {
  for (const layer of [
    "apps/api",
    "apps/web",
    "packages/ui",
    "packages/contracts",
    "packages/workspace-core",
  ]) {
    for (const code of [
      `import db from "${driver}";`,
      `const db = require("${driver}");`,
      `const db = import("${driver}");`,
    ]) {
      const [result] = await eslint.lintText(code, {
        filePath: resolve(root, layer, "src/consumer.ts"),
      });
      expect(result?.errorCount, `${layer}: ${code}`).toBeGreaterThan(0);
    }
  }
});
it("permits intended inward imports and presentation contracts", async () => {
  for (const [file, code] of [
    [
      "apps/web/src/boundary-consumer.ts",
      'import { workspaceSchema } from "@workspace/contracts/v1";',
    ],
    [
      "apps/web/src/boundary-consumer.ts",
      'import { createAuthClient } from "better-auth/react";',
    ],
    [
      "apps/api/src/boundary-consumer.ts",
      'import { workspaceApplication } from "@workspace/core";',
    ],
    [
      "apps/web/src/boundary-consumer.ts",
      "const dto=import(`@workspace/contracts/v1`);",
    ],
    [
      "packages/workspace-core/src/domain/boundary-consumer.ts",
      'import { z } from "zod";',
    ],
  ]) {
    const [result] = await eslint.lintText(code!, {
      filePath: resolve(root, file!),
    });
    expect(result?.messages).toEqual([]);
  }
});
