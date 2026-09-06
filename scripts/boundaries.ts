import ts from "typescript";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { Rule } from "eslint";
const root = fileURLToPath(new URL("../", import.meta.url));
const config = ts.readConfigFile(
  resolve(root, "tsconfig.json"),
  ts.sys.readFile,
);
const options = ts.parseJsonConfigFileContent(
  config.config,
  ts.sys,
  root,
).options;
function zone(path: string) {
  const normalized = path.replaceAll("\\", "/");
  return normalized.includes("/packages/workspace-core/")
    ? "core"
    : normalized.includes("/packages/contracts/")
      ? "contracts"
      : normalized.includes("/packages/ui/")
        ? "ui"
        : normalized.includes("/apps/web/")
          ? "web"
          : normalized.includes("/apps/api/")
            ? "api"
            : "external";
}
function staticSpecifier(source?: {
  type: string;
  value?: unknown;
  expressions?: unknown[];
  quasis?: { value: { cooked?: string | null | undefined } }[];
}) {
  if (source?.type === "Literal" && typeof source.value === "string")
    return source.value;
  if (source?.type === "TemplateLiteral" && source.expressions?.length === 0)
    return source.quasis?.[0]?.value.cooked ?? undefined;
  return undefined;
}
function publicZone(specifier: string) {
  if (
    specifier === "@workspace/core" ||
    specifier.startsWith("@workspace/core/")
  )
    return "core";
  if (
    specifier === "@workspace/contracts" ||
    specifier.startsWith("@workspace/contracts/")
  )
    return "contracts";
  if (specifier === "@workspace/ui" || specifier.startsWith("@workspace/ui/"))
    return "ui";
  if (specifier === "api" || specifier.startsWith("api/")) return "api";
  return "external";
}
const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      boundary:
        "Layer boundary violation: {{from}} must not depend on {{dependency}}.",
      pure: "Core must use injected values, not runtime/browser globals.",
    },
  },
  create(context) {
    const file = context.filename;
    const from = zone(file);
    if (/\.test\.[cm]?[jt]sx?$/.test(file) || from === "external") return {};
    const check = (node: Rule.Node, dependency: unknown) => {
      if (typeof dependency !== "string") {
        context.report({
          node,
          messageId: "boundary",
          data: { from, dependency: "unsupported computed runtime import" },
        });
        return;
      }
      const resolved = ts.resolveModuleName(dependency, file, options, ts.sys)
        .resolvedModule?.resolvedFileName;
      let target = resolved ?? dependency;
      try {
        if (resolved) target = realpathSync(resolved);
      } catch {
        /* unresolved imports are also checked by tsc */
      }
      const resolvedZone = zone(target);
      const to =
        resolvedZone === "external" ? publicZone(dependency) : resolvedZone;
      const normalized = target.replaceAll("\\", "/");
      const rootBypass = Boolean(
        resolved &&
        target.startsWith(root) &&
        to === "external" &&
        !normalized.includes("/node_modules/"),
      );
      const sqlRuntime =
        /\/node_modules\/pg(?:-[^/]+)?\//.test(normalized) ||
        (/\/node_modules\/better-auth\//.test(normalized) &&
          !normalized.includes("/dist/client/"));
      const forbidden =
        (resolved !== undefined && /\.test\.[cm]?[jt]sx?$/.test(resolved)) ||
        rootBypass ||
        ((from === "web" || from === "ui") && sqlRuntime) ||
        (from === "core" &&
          ((to !== "core" && dependency !== "zod") ||
            (file.includes("/src/domain/") &&
              to === "core" &&
              !target.includes("/src/domain/")))) ||
        (from === "contracts" && to !== "contracts" && dependency !== "zod") ||
        (from === "web" &&
          (["api", "core"].includes(to) ||
            /^pg(?:\/|$)|^node:sqlite$/.test(dependency) ||
            ((dependency === "better-auth" ||
              dependency.startsWith("better-auth/")) &&
              dependency !== "better-auth/react" &&
              !dependency.startsWith("better-auth/client")))) ||
        (from === "ui" &&
          (["api", "web", "core", "contracts"].includes(to) ||
            /^(?:node:|pg$|better-auth|@tanstack\/react-query)/.test(
              dependency,
            ))) ||
        (from === "api" &&
          (["web", "ui"].includes(to) || /^react(?:\/|$)/.test(dependency)));
      if (forbidden)
        context.report({
          node,
          messageId: "boundary",
          data: { from, dependency },
        });
    };
    return {
      ImportDeclaration(node) {
        check(node, node.source.value);
      },
      ExportNamedDeclaration(node) {
        if (node.source) check(node, node.source.value);
      },
      ExportAllDeclaration(node) {
        check(node, node.source.value);
      },
      ImportExpression(node) {
        check(node, staticSpecifier(node.source));
      },
      CallExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "require")
          check(node, staticSpecifier(node.arguments[0]));
      },
      Identifier(node) {
        if (
          from === "core" &&
          [
            "process",
            "window",
            "document",
            "localStorage",
            "crypto",
            "Date",
          ].includes(node.name)
        )
          context.report({ node, messageId: "pure" });
      },
    };
  },
};
export const boundaryPlugin = { rules: { "layer-boundaries": rule } };
