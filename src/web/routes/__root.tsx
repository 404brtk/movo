import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import { AppHeader } from "../components/app-header.tsx";
import { NotFound } from "../components/not-found.tsx";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <div className="min-h-svh">
      <AppHeader />
      <Outlet />
    </div>
  ),
  notFoundComponent: () => <NotFound />,
});
