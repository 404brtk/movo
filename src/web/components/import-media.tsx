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
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.tsx";
import { MediaToolsSetup } from "./media-tools-setup.tsx";
import { Spinner } from "./spinner.tsx";

export function ImportMedia() {
  const input = useRef<HTMLInputElement>(null);
  const [panel, setPanel] = useState<"tools" | "error" | null>(null);
  const tools = useQuery(mediaToolsOptions);
  const queryClient = useQueryClient();
  const importing = useMutation({
    mutationFn: importMedia,
    onError: (error) => {
      const toolsMissing = error instanceof ApiError && error.status === 503;
      setPanel(toolsMissing ? "tools" : "error");
      if (toolsMissing)
        void queryClient.invalidateQueries({ queryKey: mediaToolsOptions.queryKey });
    },
    onSuccess: async (item) => {
      queryClient.setQueryData(mediaItemOptions(item.id).queryKey, item);
      await queryClient.invalidateQueries({ queryKey: mediaListKey });
    },
  });

  return (
    <Popover
      open={panel !== null}
      onOpenChange={(open) => {
        importing.reset();
        if (!open) setPanel(null);
        else if (tools.data?.ffprobe.state === "ready") input.current?.click();
        else setPanel("tools");
      }}
    >
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
      <PopoverTrigger
        render={<Button />}
        disabled={importing.isPending || tools.isPending}
        aria-busy={importing.isPending}
      >
        {importing.isPending ? (
          <Spinner />
        ) : (
          <HugeiconsIcon icon={Upload04Icon} data-icon="inline-start" aria-hidden="true" />
        )}
        {importing.isPending ? "Importing…" : "Import a file"}
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={16}
        className="w-[380px] max-w-[calc(100vw-2rem)] gap-0"
      >
        {importing.isError ? (
          <p role="alert" className="mb-3 text-[13px]/5 wrap-anywhere text-destructive last:mb-0">
            {importing.error.message}
          </p>
        ) : null}
        {panel === "tools" ? <MediaToolsSetup onClose={() => setPanel(null)} /> : null}
      </PopoverContent>
    </Popover>
  );
}
