import { Outlet, createFileRoute } from "@tanstack/react-router";
import { ProjectsPage } from "@/features/workspace/workspace";

export const Route = createFileRoute("/_authenticated/projects")({
  component: ProjectsRoute,
});
function ProjectsRoute() {
  return (
    <>
      <ProjectsPage />
      <Outlet />
    </>
  );
}
