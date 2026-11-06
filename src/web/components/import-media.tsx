import { useRef, useState } from "react";
import { Upload04Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ApiError,
  importMedia,
  mediaItemOptions,
  mediaListKey,
  mediaToolsOptions,
} from "../lib/api.ts";
import { Button } from "./ui/button.tsx";
import { MediaToolsSetup } from "./media-tools-setup.tsx";

export function ImportMedia() {
  const input = useRef<HTMLInputElement>(null);
  const toolsTrigger = useRef<HTMLButtonElement>(null);
  const [showTools, setShowTools] = useState(false);
  const tools = useQuery(mediaToolsOptions);
  const queryClient = useQueryClient();
  const importing = useMutation({
    mutationFn: importMedia,
    onError: (error) => {
      if (error instanceof ApiError && error.status === 503) {
        setShowTools(true);
        void queryClient.invalidateQueries({ queryKey: mediaToolsOptions.queryKey });
      }
    },
    onSuccess: async (item) => {
      queryClient.setQueryData(mediaItemOptions(item.id).queryKey, item);
      await queryClient.invalidateQueries({ queryKey: mediaListKey });
    },
  });

  return (
    <div className="flex max-w-full flex-col items-start gap-3 sm:items-end">
      <input
        ref={input}
        type="file"
        accept="audio/*,video/*,.mkv,.mka,.flac,.ogg,.webm,.m4a"
        aria-label="Choose media file"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) importing.mutate(file);
        }}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          ref={toolsTrigger}
          variant="ghost"
          className="h-11 px-3"
          aria-expanded={showTools}
          aria-controls="media-tools-setup"
          onClick={() => setShowTools((current) => !current)}
        >
          Media tools
        </Button>
        <Button
          className="h-11 gap-2 px-4 text-sm"
          disabled={importing.isPending || tools.isPending}
          onClick={() => {
            importing.reset();
            if (tools.data?.ffprobe.state === "ready") input.current?.click();
            else setShowTools(true);
          }}
        >
          <HugeiconsIcon icon={Upload04Icon} size={18} aria-hidden="true" />
          Import a file
        </Button>
      </div>
      {showTools ? (
        <MediaToolsSetup
          onClose={() => {
            setShowTools(false);
            toolsTrigger.current?.focus();
          }}
        />
      ) : null}
      {importing.isPending ? (
        <output className="max-w-sm text-sm wrap-anywhere text-muted-foreground">
          Importing {importing.variables.name}…
        </output>
      ) : null}
      {importing.isError ? (
        <p role="alert" className="max-w-sm text-sm wrap-anywhere text-destructive">
          {importing.error.message}
        </p>
      ) : null}
    </div>
  );
}
