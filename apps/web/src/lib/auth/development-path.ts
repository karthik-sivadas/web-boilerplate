import { stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/** Development only. Never inspect a private store to discover the workspace. */
export async function developmentDataDirectory(cwd: string): Promise<string> {
  let directory = resolve(cwd);
  for (;;) {
    try {
      if ((await stat(join(directory, "pnpm-workspace.yaml"))).isFile())
        return join(directory, ".data");
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !("code" in error) ||
        error.code !== "ENOENT"
      )
        throw error;
    }
    const parent = dirname(directory);
    if (parent === directory)
      throw new Error(
        "Development authentication requires a pnpm-workspace.yaml ancestor; refusing to create a replacement data store.",
      );
    directory = parent;
  }
}
