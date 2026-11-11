import { type Ref, useRef, useState } from "react";
import { FileUploadIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Button } from "./ui/button.tsx";

const acceptedMedia = "audio/*,video/*,.mkv,.mka,.flac,.ogg,.webm,.m4a";

export function MediaDropZone({
  ref,
  disabled,
  onFiles,
}: {
  ref: Ref<HTMLButtonElement>;
  disabled: boolean;
  onFiles: (files: readonly File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      data-dragging={dragging || undefined}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
        setDragging(!disabled);
      }}
      onDragLeave={(event) => {
        const { relatedTarget } = event;
        if (!(relatedTarget instanceof Node && event.currentTarget.contains(relatedTarget)))
          setDragging(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        if (!disabled) onFiles([...event.dataTransfer.files]);
      }}
      className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border-strong bg-subtle px-4 py-6 text-center transition-colors data-dragging:border-primary data-dragging:bg-tint"
    >
      <HugeiconsIcon
        icon={FileUploadIcon}
        size={22}
        className="text-muted-foreground"
        aria-hidden="true"
      />
      <p className="text-[13px]/5 text-muted-foreground">Drop audio or video files here</p>
      <input
        ref={input}
        type="file"
        multiple
        accept={acceptedMedia}
        aria-label="Choose media files"
        className="hidden"
        onChange={(event) => {
          onFiles([...(event.currentTarget.files ?? [])]);
          event.currentTarget.value = "";
        }}
      />
      <Button
        ref={ref}
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => input.current?.click()}
      >
        Choose files
      </Button>
    </div>
  );
}
