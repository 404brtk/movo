import { Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "../components/ui/button.tsx";
import { getHealth } from "../lib/api.ts";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => getHealth(signal),
    retry: false,
  });
  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col justify-center gap-6 px-6 py-16">
      <div className="space-y-3">
        <h1 className="text-4xl font-semibold tracking-tight">movo</h1>
        <p className="text-lg text-muted-foreground">Your local media workspace.</p>
      </div>
      <output className="flex items-center gap-2 text-sm">
        {health.isSuccess ? <HugeiconsIcon icon={Tick02Icon} size={20} aria-hidden="true" /> : null}
        <span>
          {health.isPending
            ? "Connecting to the local service…"
            : health.isError
              ? "The local service is unavailable."
              : "Local service connected."}
        </span>
      </output>
      {health.isError ? (
        <Button
          className="w-fit"
          onClick={() => {
            void health.refetch();
          }}
        >
          Try again
        </Button>
      ) : null}
    </main>
  );
}
