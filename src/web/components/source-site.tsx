import { HugeiconsIcon } from "@hugeicons/react";
import { sourceSite } from "../lib/source-sites.ts";

export function SourceSite({ url }: { url: string }) {
  const { name, icon } = sourceSite(url);
  return (
    <>
      {icon ? (
        <HugeiconsIcon
          icon={icon}
          size={13}
          aria-hidden="true"
          className="mr-1 inline-block align-[-2px]"
        />
      ) : null}
      {name}
    </>
  );
}
