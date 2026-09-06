import { createFileRoute } from "@tanstack/react-router";
import { ProjectDetailPage } from "@/features/workspace/workspace";

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  component: ProjectRoute,
});
function ProjectRoute() {
  return <ProjectDetailPage projectId={Route.useParams().projectId} />;
}
