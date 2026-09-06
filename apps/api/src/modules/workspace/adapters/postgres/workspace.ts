import type { Pool, PoolClient } from "pg";
import {
  emptyWorkspace,
  workspaceSchema,
  WorkspaceFailure,
  type Workspace,
  type WorkspacePreservation,
  type Actor,
} from "@workspace/core";
import { transaction } from "../../../../infrastructure/postgres";

async function load(client: PoolClient, owner: string): Promise<Workspace> {
  const revision = await client.query<{ revision: string }>(
    "SELECT revision FROM workspace WHERE owner_id=$1",
    [owner],
  );
  if (!revision.rows[0]) return emptyWorkspace();
  const projects = await client.query(
    "SELECT id, name, description, archived FROM project WHERE owner_id=$1 ORDER BY id LIMIT 101",
    [owner],
  );
  const tasks = await client.query(
    'SELECT id, project_id AS "projectId", title, description, status, created_at AS "createdAt", updated_at AS "updatedAt" FROM task WHERE owner_id=$1 ORDER BY id LIMIT 1001',
    [owner],
  );
  const parsed = workspaceSchema.safeParse({
    revision: Number(revision.rows[0].revision),
    projects: projects.rows,
    tasks: tasks.rows,
  });
  if (!parsed.success) throw new Error("Invalid persisted workspace.");
  return parsed.data;
}
export function postgresWorkspace(pool: Pool): WorkspacePreservation {
  const change = (
    actor: Actor,
    expectedRevision: number,
    apply: (state: Workspace) => Workspace,
    receipt?: { kind: "import" | "rollback"; fingerprint: string },
  ) =>
    transaction(pool, "write", async (client) => {
      const owner = actor.userId;
      await client.query(
        "INSERT INTO workspace(owner_id,revision) VALUES($1,0) ON CONFLICT DO NOTHING",
        [owner],
      );
      const locked = await client.query<{ revision: string }>(
        "SELECT revision FROM workspace WHERE owner_id=$1 FOR UPDATE",
        [owner],
      );
      if (Number(locked.rows[0]?.revision) !== expectedRevision)
        throw new WorkspaceFailure(
          "REVISION_CONFLICT",
          "Workspace changed. Reload before retrying.",
        );
      if (receipt) {
        const prior = await client.query<{
          imported_revision: string;
          rolled_back: boolean;
        }>(
          "SELECT imported_revision,rolled_back FROM workspace_import_receipt WHERE owner_id=$1 AND fingerprint=$2",
          [owner, receipt.fingerprint],
        );
        if (receipt.kind === "import") {
          if (prior.rowCount)
            throw new WorkspaceFailure(
              "RULE_VIOLATION",
              "This import was already applied.",
            );
          await client.query(
            "INSERT INTO workspace_import_receipt(owner_id,fingerprint,imported_revision) VALUES($1,$2,$3)",
            [owner, receipt.fingerprint, expectedRevision + 1],
          );
        } else {
          if (
            !prior.rows[0] ||
            prior.rows[0].rolled_back ||
            Number(prior.rows[0].imported_revision) !== expectedRevision
          )
            throw new WorkspaceFailure(
              "RULE_VIOLATION",
              "Import rollback is unavailable after subsequent changes.",
            );
          await client.query(
            "UPDATE workspace_import_receipt SET rolled_back=true WHERE owner_id=$1 AND fingerprint=$2",
            [owner, receipt.fingerprint],
          );
        }
      }
      const current = await load(client, owner);
      const next = workspaceSchema.parse(apply(current));
      next.projects.sort((a, b) => a.id.localeCompare(b.id));
      next.tasks.sort((a, b) => a.id.localeCompare(b.id));
      if (next.revision !== current.revision + 1)
        throw new Error("Invalid revision transition.");
      // Small bounded aggregate; one owner lock and one atomic replacement. No generic repository.
      await client.query("DELETE FROM task WHERE owner_id=$1", [owner]);
      await client.query("DELETE FROM project WHERE owner_id=$1", [owner]);
      for (const p of next.projects)
        await client.query(
          "INSERT INTO project(owner_id,id,name,description,archived) VALUES($1,$2,$3,$4,$5)",
          [owner, p.id, p.name, p.description, p.archived],
        );
      for (const t of next.tasks)
        await client.query(
          "INSERT INTO task(owner_id,id,project_id,title,description,status,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
          [
            owner,
            t.id,
            t.projectId,
            t.title,
            t.description,
            t.status,
            t.createdAt,
            t.updatedAt,
          ],
        );
      await client.query("UPDATE workspace SET revision=$2 WHERE owner_id=$1", [
        owner,
        next.revision,
      ]);
      return next;
    });
  return {
    read: (actor) =>
      transaction(pool, "read", (client) => load(client, actor.userId)),
    change,
    receipt: (actor) =>
      transaction(pool, "read", async (client) => {
        const result = await client.query<{
          fingerprint: string;
          imported_revision: string;
        }>(
          "SELECT fingerprint,imported_revision FROM workspace_import_receipt WHERE owner_id=$1 AND rolled_back=false ORDER BY imported_revision DESC LIMIT 1",
          [actor.userId],
        );
        return result.rows[0]
          ? {
              fingerprint: result.rows[0].fingerprint,
              importedRevision: Number(result.rows[0].imported_revision),
            }
          : null;
      }),
    importEmpty: (actor, revision, fingerprint, apply) =>
      change(actor, revision, apply, { kind: "import", fingerprint }),
    rollbackImport: (actor, revision, fingerprint, apply) =>
      change(actor, revision, apply, { kind: "rollback", fingerprint }),
  };
}
