import { createFileRoute } from "@tanstack/react-router";
import { OverviewPage } from "@/features/workspace/workspace";
export const Route = createFileRoute("/_authenticated/")({
  component: OverviewPage,
});
