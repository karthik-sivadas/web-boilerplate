import { exportSchema, type ExportDto } from "@workspace/contracts/v1";
export function workspaceStorageKey(userId: string) {
  if (!userId) throw new Error("Authenticated user ID required.");
  return `web-boilerplate.workspace:${userId}`;
}
export function parseWorkspaceExport(raw: string): ExportDto {
  if (new TextEncoder().encode(raw).byteLength > 2 * 1024 * 1024)
    throw new Error("Import exceeds 2 MiB.");
  return exportSchema.parse(JSON.parse(raw));
}
/** Explicit user action only. No anonymous-key access and no write/delete interface. */
export function previewLegacy(
  storage: Pick<Storage, "getItem">,
  userId: string,
): ExportDto | null {
  const raw = storage.getItem(workspaceStorageKey(userId));
  return raw === null ? null : parseWorkspaceExport(raw);
}
export function downloadWorkspace(data: ExportDto, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
