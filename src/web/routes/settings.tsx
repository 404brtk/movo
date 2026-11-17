import { type ReactNode, useId } from "react";
import { Link01Icon, Wrench01Icon } from "@hugeicons/core-free-icons";
import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { AskSettings } from "../components/ask-settings.tsx";
import { ListSkeleton } from "../components/list-skeleton.tsx";
import { MediaToolsSetup } from "../components/media-tools-setup.tsx";
import { ModelRow } from "../components/model-row.tsx";
import { PageHeader } from "../components/page-header.tsx";
import { ToolRow } from "../components/tool-row.tsx";
import { Button } from "../components/ui/button.tsx";
import { YtdlpSetup } from "../components/ytdlp-setup.tsx";
import { mediaToolsOptions, modelsOptions, ytdlpOptions } from "../lib/api.ts";

export const Route = createFileRoute("/settings")({ component: Settings });

function SettingsSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="mt-10">
      <h2 id={headingId} className="text-[17px]/6 font-semibold tracking-[-0.01em]">
        {title}
      </h2>
      <p className="mt-0.5 text-[13px]/5 text-pretty text-muted-foreground">{description}</p>
      {children}
    </section>
  );
}

function Settings() {
  const models = useQuery(modelsOptions);
  return (
    <main className="mx-auto max-w-[800px] px-5 pt-9 pb-16">
      <PageHeader
        title="Settings"
        description="What Movo uses to add recordings and transcribe them on this computer, and the models Ask answers with."
      />
      <SettingsSection
        title="Adding recordings"
        description="Needed to import files and to save recordings from links."
      >
        <ul className="mt-2">
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
      </SettingsSection>
      <SettingsSection
        title="Transcription"
        description="Runs on this computer. Recordings never leave it."
      >
        {models.isPending ? <ListSkeleton label="Loading models" /> : null}
        {models.isError ? (
          <div role="alert" className="mt-4 space-y-4 rounded-lg border p-6">
            <p className="text-sm">{models.error.message}</p>
            <Button variant="outline" onClick={() => void models.refetch()}>
              Try again
            </Button>
          </div>
        ) : null}
        {models.data ? (
          <ul className="mt-2">
            {models.data.map((model) => (
              <ModelRow key={model.id} model={model} />
            ))}
          </ul>
        ) : null}
      </SettingsSection>
      <SettingsSection
        title="Ask"
        description="Answers questions about your recordings with a model you connect."
      >
        <AskSettings />
      </SettingsSection>
    </main>
  );
}
