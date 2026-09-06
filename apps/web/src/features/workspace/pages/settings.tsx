import { useEffect, useState } from "react";
import { receiptResultSchema } from "@workspace/contracts/v1";
import { workspaceRequest } from "../api/client";
import { Card } from "@workspace/ui/components/card";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@workspace/ui/components/alert-dialog";
import type { ExportDto, ImportResultDto } from "@workspace/contracts/v1";
import { useWorkspace } from "../hooks/workspace-context";
import { useSessionActions } from "../../auth/session-context";
import { PageHeader } from "../components/frame";
import { RequestError } from "../components/forms";
import {
  previewLegacy,
  parseWorkspaceExport,
  downloadWorkspace,
} from "../legacy-import/reader";
import styles from "../workspace.module.css";
export function SettingsPage() {
  const actions = useWorkspace(),
    session = useSessionActions();
  const [preview, setPreview] = useState<ExportDto | null>(null),
    [receipt, setReceipt] = useState<ImportResultDto["receipt"] | null>(null),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!session) return;
    let active = true;
    const abort = new AbortController();
    void workspaceRequest(
      {
        sessionId: session.identity.sessionId,
        canAct: session.canAct,
        reconcile: session.reconcile,
      },
      "workspace/import-receipt",
      receiptResultSchema,
      { signal: abort.signal },
    )
      .then((result) => {
        if (active) setReceipt(result.receipt);
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : "Import receipt unavailable. Reload to retry.",
          );
      });
    return () => {
      active = false;
      abort.abort();
    };
  }, [session, actions.workspace.revision]);
  const empty =
    !actions.workspace.projects.length && !actions.workspace.tasks.length;
  const showError = (cause: unknown) =>
    setError(
      cause instanceof Error ? cause.message : "Could not read the import.",
    );
  const readLegacy = () => {
    if (!session?.canAct()) return;
    try {
      const data = previewLegacy(window.localStorage, session.identity.user.id);
      setPreview(data);
      setError(
        data
          ? ""
          : "No legacy data exists for this account. The anonymous key was not read.",
      );
    } catch (cause) {
      showError(cause);
    }
  };
  return (
    <>
      <PageHeader eyebrow="Data ownership" title="Settings" />
      <Card className={styles.panel}>
        <h2>Export your workspace</h2>
        <p>
          Download a versioned snapshot from PostgreSQL. Import and rollback are
          explicit actions, not automatic synchronization.
        </p>
        <Button
          variant="outline"
          isDisabled={actions.busy}
          onPress={() => void actions.reload()}
        >
          Reload workspace
        </Button>
        <Button
          onPress={() => {
            void actions
              .export()
              .then((data) => {
                if (session?.canAct())
                  downloadWorkspace(data, "workspace.json");
              })
              .catch(showError);
          }}
        >
          Export workspace
        </Button>
      </Card>
      <Card className={styles.panel}>
        <h2>Preserve legacy data</h2>
        <p>
          Preview only this signed-in account's old browser key, or choose an
          exported JSON file. Old keys and files remain unchanged. A new
          PostgreSQL account does not recover an old account ID: offline
          authentication preservation must be performed separately by an
          operator.
        </p>
        <Button variant="outline" onPress={readLegacy}>
          Preview this account's legacy data
        </Button>
        <Label htmlFor="import-file">Choose workspace export</Label>
        <Input
          id="import-file"
          type="file"
          accept="application/json,.json"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file || !session?.canAct()) return;
            if (file.size > 2 * 1024 * 1024) {
              setError("Import exceeds 2 MiB.");
              return;
            }
            const lease = session.canAct;
            void file
              .text()
              .then((raw) => {
                if (lease()) {
                  setPreview(parseWorkspaceExport(raw));
                  setError("");
                }
              })
              .catch(showError);
          }}
        />
        {preview ? (
          <section>
            <h3>Import preview</h3>
            <p>
              {preview.workspace.projects.length} projects ·{" "}
              {preview.workspace.tasks.length} tasks
            </p>
            <ul>
              {preview.workspace.projects.map((project) => (
                <li key={project.id}>{project.name}</li>
              ))}
            </ul>
            <Button
              variant="outline"
              onPress={() =>
                downloadWorkspace(preview, "legacy-workspace.json")
              }
            >
              Download preview
            </Button>
            <Button
              isDisabled={!empty || actions.busy || actions.needsReload}
              onPress={() => setConfirm(true)}
            >
              Review import
            </Button>
            {!empty ? (
              <p>
                Import requires an empty remote workspace. Existing data will
                not be merged or overwritten.
              </p>
            ) : null}
          </section>
        ) : null}
      </Card>
      {receipt ? (
        <Card className={styles.panel}>
          <h2>Import receipt</h2>
          <p>
            Receipt: {receipt.fingerprint}. Rollback is allowed only before any
            subsequent edit.
          </p>
          <Button
            variant="outline"
            isDisabled={
              actions.busy ||
              actions.needsReload ||
              actions.workspace.revision !== receipt.importedRevision
            }
            onPress={() => {
              void actions.rollback(receipt.fingerprint).then((saved) => {
                if (saved) setReceipt(null);
              });
            }}
          >
            Roll back this import
          </Button>
        </Card>
      ) : null}
      {error ? (
        <p role="alert">{error} Original data was not changed.</p>
      ) : null}
      <AlertDialog
        isOpen={confirm}
        onOpenChange={setConfirm}
        className={styles.dialog ?? ""}
      >
        <AlertDialogTitle>Import this workspace?</AlertDialogTitle>
        <AlertDialogDescription>
          The server will validate and remap IDs into your empty account. Old
          browser data will remain unchanged. Duplicate imports are rejected.
        </AlertDialogDescription>
        <RequestError />
        <div className={styles.dialogActions}>
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <AlertDialogCancel autoFocus>Cancel</AlertDialogCancel>
          <Button
            isDisabled={actions.busy || actions.needsReload}
            onPress={() => {
              if (preview)
                void actions.import(preview).then((result) => {
                  if (result) {
                    setReceipt(result.receipt);
                    setConfirm(false);
                  }
                });
            }}
          >
            Confirm import
          </Button>
        </div>
      </AlertDialog>
    </>
  );
}
