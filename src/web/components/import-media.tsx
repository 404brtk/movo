import { useRef } from "react";
import { Upload04Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { importMedia, mediaItemOptions, mediaListOptions } from "../lib/api.ts";
import { Button } from "./ui/button.tsx";

export function ImportMedia() {
  const input = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const importing = useMutation({
    mutationFn: importMedia,
    onSuccess: async (item) => {
      queryClient.setQueryData(mediaItemOptions(item.id).queryKey, item);
      queryClient.setQueryData(mediaListOptions.queryKey, (current) => [item, ...(current ?? [])]);
      await queryClient.invalidateQueries({ queryKey: mediaListOptions.queryKey });
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
      <Button
        className="h-11 gap-2 px-4 text-sm"
        disabled={importing.isPending}
        onClick={() => input.current?.click()}
      >
        <HugeiconsIcon icon={Upload04Icon} size={18} aria-hidden="true" />
        Import a file
      </Button>
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
