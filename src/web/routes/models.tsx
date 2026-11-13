import { useId } from "react";
import { Link01Icon, Wrench01Icon } from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AskSettings } from "../components/ask-settings.tsx";
import { ListSkeleton } from "../components/list-skeleton.tsx";
import { MediaToolsSetup } from "../components/media-tools-setup.tsx";
import { ModelCard } from "../components/model-card.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { ToolRow } from "../components/tool-row.tsx";
import { Button } from "../components/ui/button.tsx";
import { YtdlpSetup } from "../components/ytdlp-setup.tsx";
import { mediaToolsOptions, modelsOptions, ytdlpOptions } from "../lib/api.ts";

export const Route = createFileRoute("/models")({ component: Models });

function Models() {
  const models = useQuery(modelsOptions);
  const toolsHeadingId = useId();
  return (
    <main className="mx-auto max-w-[800px] px-5 pt-9 pb-16">
      <PageHeader
        title="Models"
        description="Transcription always runs on this computer. Ask answers with a model you connect."
      />
      <h2 className="mt-9 text-[17px]/6 font-semibold tracking-[-0.01em]">Transcription</h2>
      {models.isPending ? <ListSkeleton label="Loading models" /> : null}
      {models.isError ? (
        <div role="alert" className="mt-8 space-y-4 rounded-lg border p-6">
          <p className="text-sm">{models.error.message}</p>
          <Button variant="outline" onClick={() => void models.refetch()}>
            Try again
          </Button>
        </div>
      ) : null}
      {models.data?.map((model) => (
        <ModelCard key={model.id} model={model} />
      ))}
      <section aria-labelledby={toolsHeadingId}>
        <h2
          id={toolsHeadingId}
          className="mt-8 mb-1.5 text-xs/[normal] font-medium text-muted-foreground"
        >
          Tools
        </h2>
        <ul aria-labelledby={toolsHeadingId}>
          <ToolRow
            icon={Wrench01Icon}
            name="media tools"
            title="Media tools"
            description="Reads imported files and prepares audio for transcription"
            options={mediaToolsOptions}
            tools={(status) => ({ FFprobe: status.ffprobe, FFmpeg: status.ffmpeg })}
            setup={MediaToolsSetup}
          />
          <ToolRow
            icon={Link01Icon}
            name="yt-dlp"
            title="yt-dlp"
            description="Reads and downloads video and podcast links"
            options={ytdlpOptions}
            tools={(status) => ({ "yt-dlp": status.ytdlp })}
            setup={YtdlpSetup}
          />
        </ul>
      </section>
      <AskSettings />
    </main>
  );
}
