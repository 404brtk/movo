import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: () => (
    <div className="min-h-svh">
      <header className="border-b">
        <div className="mx-auto flex h-20 max-w-5xl items-center justify-between gap-5 px-5 sm:px-8">
          <Link
            to="/"
            aria-label="movo home"
            className="rounded-sm text-2xl font-semibold tracking-[-0.065em] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            movo
          </Link>
          <span className="text-xs text-muted-foreground sm:text-sm">
            Your local media workspace
          </span>
        </div>
      </header>
      <Outlet />
    </div>
  ),
  notFoundComponent: () => (
    <main className="mx-auto max-w-xl space-y-4 px-6 py-20">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <Link to="/" className="underline underline-offset-4">
        Return home
      </Link>
    </main>
  ),
});
