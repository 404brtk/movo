import { ArrowUpRight01Icon, Copy01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Toast } from "@base-ui/react/toast";
import { sourceSite } from "../lib/source-sites.ts";
import { MenuIcon } from "./menu-icon.tsx";
import { DropdownMenuItem } from "./ui/dropdown-menu.tsx";

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

export function SourceLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="relative rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      <SourceSite url={url} />
    </a>
  );
}

export function SourceMenuItems({ url }: { url: string }) {
  const { add: addToast } = Toast.useToastManager();
  const copyLink = () =>
    navigator.clipboard.writeText(url).then(
      () => addToast({ title: "Link copied" }),
      () =>
        addToast({
          title: "Could not copy the link",
          description: "Allow clipboard access for this page, then try again.",
        }),
    );
  return (
    <>
      <DropdownMenuItem
        render={({ children, ...props }) => (
          <a {...props} href={url} target="_blank" rel="noreferrer">
            {children}
          </a>
        )}
      >
        <MenuIcon icon={ArrowUpRight01Icon} />
        View original source
      </DropdownMenuItem>
      <DropdownMenuItem onClick={() => void copyLink()}>
        <MenuIcon icon={Copy01Icon} />
        Copy link
      </DropdownMenuItem>
    </>
  );
}
