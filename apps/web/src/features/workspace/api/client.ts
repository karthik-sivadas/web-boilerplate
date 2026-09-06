import { expectedSessionHeader, errorSchema } from "@workspace/contracts/v1";
import type { z } from "zod";
export interface ActionLease {
  sessionId: string;
  canAct(): boolean;
  reconcile(): Promise<void>;
}
export class WorkspaceApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function workspaceRequest<T>(
  lease: ActionLease,
  path: string,
  schema: z.ZodType<T>,
  options: {
    method?: string;
    body?: unknown;
    revision?: number;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  if (!lease.canAct())
    throw new WorkspaceApiError(
      "SESSION_CHANGED",
      "The action's session is no longer current.",
    );
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)])
    : AbortSignal.timeout(15000);
  try {
    const response = await fetch(`/api/v1/${path}`, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      signal,
      headers: {
        [expectedSessionHeader]: lease.sessionId,
        "content-type": "application/json",
        ...(options.revision === undefined
          ? {}
          : { "If-Match": `"${options.revision}"` }),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
    const raw: unknown = await response.json();
    signal.throwIfAborted();
    if (!lease.canAct())
      throw new WorkspaceApiError(
        "SESSION_CHANGED",
        "Discarded a response from an expired session.",
      );
    if (!response.ok) {
      const parsed = errorSchema.safeParse(raw);
      const code = parsed.success ? parsed.data.error.code : "UNAVAILABLE";
      if (code === "SESSION_CHANGED" || response.status === 401) {
        void lease.reconcile();
        throw new WorkspaceApiError(
          "SESSION_CHANGED",
          "Your session changed. Workspace hidden while checking.",
        );
      }
      throw new WorkspaceApiError(
        code,
        parsed.success ? parsed.data.error.message : "Service unavailable.",
      );
    }
    return schema.parse(raw);
  } catch (error) {
    if (error instanceof WorkspaceApiError) throw error;
    throw new WorkspaceApiError(
      "UNAVAILABLE",
      "Request could not be confirmed. Reload before retrying; it may have committed.",
    );
  }
}
