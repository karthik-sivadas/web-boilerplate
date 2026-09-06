import { Link } from "@tanstack/react-router";
import { Card } from "@workspace/ui/components/card";
import { useWorkspace } from "../hooks/workspace-context";
import { overview } from "../view-models/projections";
import { PageHeader } from "../components/frame";
import { TaskList } from "../components/task-list";
import styles from "../workspace.module.css";
export function OverviewPage() {
  const { workspace } = useWorkspace();
  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="A clearer way to move work forward"
      />
      <section className={styles.metrics} aria-label="Workspace metrics">
        {overview(workspace).map(([value, label]) => (
          <Card key={label} className={styles.metric}>
            <strong>{value}</strong>
            <span>{label}</span>
          </Card>
        ))}
      </section>
      {!workspace.projects.length ? (
        <section className={styles.empty}>
          <h2>Welcome to your empty workspace</h2>
          <p>Nothing is seeded or imported automatically.</p>
          <Link to="/projects">Create your first project</Link>
        </section>
      ) : null}
      <section className={styles.twoColumn}>
        <Card className={styles.panel}>
          <div className={styles.sectionTitle}>
            <div>
              <p className={styles.eyebrow}>Next up</p>
              <h2>Recent tasks</h2>
            </div>
            <Link to="/tasks" search={{ project: undefined }}>
              View all
            </Link>
          </div>
          <TaskList
            tasks={[...workspace.tasks]
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .slice(0, 4)}
            projects={
              new Map(
                workspace.projects.map((project) => [project.id, project]),
              )
            }
          />
        </Card>
        <Card className={styles.panel}>
          <div className={styles.sectionTitle}>
            <div>
              <p className={styles.eyebrow}>At a glance</p>
              <h2>Projects</h2>
            </div>
            <Link to="/projects">Manage</Link>
          </div>
          <div className={styles.projectSummary}>
            {workspace.projects.map((project) => (
              <Link
                key={project.id}
                to="/projects/$projectId"
                params={{ projectId: project.id }}
              >
                <span>
                  <b>{project.name}</b>
                  <small>
                    {
                      workspace.tasks.filter(
                        (task) => task.projectId === project.id,
                      ).length
                    }{" "}
                    tasks {project.archived ? "· Archived" : ""}
                  </small>
                </span>
              </Link>
            ))}
          </div>
        </Card>
      </section>
    </>
  );
}
