import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { activeModelPhases } from "../../shared/contracts/models.ts";
import { Button } from "../components/ui/button.tsx";
import { cancelModelInstallation, installModel, modelsOptions } from "../lib/api.ts";
import { formatBytes } from "../lib/format.ts";

export const Route = createFileRoute("/models")({ component: Models });
const languageNames = new Intl.DisplayNames(["en"], { type: "language" });
const phaseLabels = {
  idle: "",
  checking: "Checking the model cache…",
  downloading: "Downloading model…",
  verifying: "Verifying download…",
  complete: "Model installed and verified.",
  failed: "Model installation failed.",
  cancelled: "Download cancelled.",
  interrupted: "Installation interrupted.",
};

function Models() {
  const models = useQuery(modelsOptions);
  const client = useQueryClient();
  const action = useMutation({
    mutationFn: ({ id, cancel }: { id: string; cancel: boolean }) =>
      cancel ? cancelModelInstallation(id) : installModel(id),
    onSuccess: (updated) => {
      client.setQueryData(modelsOptions.queryKey, (current) =>
        current?.map((model) => (model.id === updated.id ? updated : model)),
      );
    },
  });
  return (
    <main className="mx-auto max-w-5xl space-y-8 px-5 py-10 sm:px-8 sm:py-14">
      <div className="space-y-3">
        <Link
          to="/"
          className="inline-flex min-h-10 items-center text-sm text-muted-foreground underline underline-offset-4"
        >
          Back to library
        </Link>
        <h1 className="text-4xl font-semibold tracking-tight">Models</h1>
        <p className="max-w-xl text-sm leading-6 text-muted-foreground">
          Install a model for local transcription. Downloading is optional; you can keep using your
          library without a model. Existing Parakeet Ultra weights in your Hugging Face cache are
          reused.
        </p>
      </div>
      {models.isPending ? <output>Loading models…</output> : null}
      {models.isError ? (
        <div role="alert" className="space-y-3">
          <p>{models.error.message}</p>
          <Button
            variant="outline"
            onClick={() => {
              void models.refetch();
            }}
          >
            Try again
          </Button>
        </div>
      ) : null}
      {action.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {action.error.message}
        </p>
      ) : null}
      {models.data?.map((model) => {
        const busy = activeModelPhases.includes(model.installation.phase);
        return (
          <section
            key={model.id}
            aria-labelledby={`model-${model.id}`}
            className="space-y-5 rounded-xl border p-5 sm:p-6"
          >
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
              <div className="space-y-2">
                <h2 id={`model-${model.id}`} className="text-lg font-semibold">
                  {model.name}
                </h2>
                <p className="text-sm text-muted-foreground">{model.description}</p>
              </div>
              <span className="shrink-0 text-sm font-medium">
                {model.state === "ready"
                  ? "Installed"
                  : model.state === "broken"
                    ? "Needs repair"
                    : "Not installed"}
              </span>
            </div>
            <p className="text-sm text-muted-foreground">
              {formatBytes(model.bytes)} download · {model.license} ·{" "}
              <a
                href={model.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-4"
              >
                Model source
              </a>
            </p>
            <details className="text-sm">
              <summary className="min-h-8 cursor-pointer text-muted-foreground">
                Supported languages ({model.languages.length})
              </summary>
              <p className="mt-2 max-w-2xl leading-6 text-muted-foreground">
                {model.languages
                  .map((language) => languageNames.of(language) ?? language)
                  .join(", ")}
              </p>
            </details>
            <output className="block text-sm text-muted-foreground">
              {model.installation.phase === "complete" && model.state !== "ready"
                ? ""
                : phaseLabels[model.installation.phase]}
            </output>
            {busy ? (
              <div className="space-y-2">
                <progress
                  aria-label={`${model.name} download`}
                  className="h-2 w-full accent-primary"
                  value={model.installation.downloadedBytes}
                  max={model.bytes}
                />
                <p className="text-xs text-muted-foreground">
                  {formatBytes(model.installation.downloadedBytes)} of {formatBytes(model.bytes)}.
                  You can leave this page; installation continues while Movo is running.
                </p>
              </div>
            ) : null}
            {model.installation.error || model.message ? (
              <p role="alert" className="text-sm wrap-anywhere text-destructive">
                {model.installation.error ?? model.message}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {busy ? (
                <Button
                  variant="outline"
                  className="h-11 px-4"
                  disabled={action.isPending}
                  onClick={() => action.mutate({ id: model.id, cancel: true })}
                >
                  Cancel installation
                </Button>
              ) : model.state === "missing" ? (
                <Button
                  className="h-11 px-4"
                  disabled={action.isPending}
                  onClick={() => action.mutate({ id: model.id, cancel: false })}
                >
                  {model.installation.phase === "failed" ||
                  model.installation.phase === "interrupted"
                    ? "Retry download"
                    : "Download model"}
                </Button>
              ) : model.state === "ready" ? (
                <p className="text-sm text-muted-foreground">
                  Verified weights in your Hugging Face cache.
                </p>
              ) : null}
              {!busy ? (
                <Button
                  variant="outline"
                  className="h-11 px-4"
                  onClick={() => {
                    action.reset();
                    void models.refetch();
                  }}
                >
                  Check again
                </Button>
              ) : null}
            </div>
          </section>
        );
      })}
    </main>
  );
}
