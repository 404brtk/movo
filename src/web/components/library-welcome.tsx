import { CpuIcon, FolderLibraryIcon, Search01Icon } from "@hugeicons/core-free-icons";
import { AccentIcon } from "./accent-icon.tsx";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty.tsx";

const facts = [
  {
    icon: FolderLibraryIcon,
    title: "A separate copy",
    description: "Every import is copied into Movo. Files up to 10 GiB.",
  },
  {
    icon: CpuIcon,
    title: "Transcribed on this computer",
    description: "Parakeet Ultra runs locally. Nothing is uploaded.",
  },
  {
    icon: Search01Icon,
    title: "Search what was said",
    description: "Find any recording by its title or a phrase in its transcript.",
  },
] as const;

export function LibraryWelcome() {
  return (
    <Empty className="mt-[72px] basis-full gap-0 p-0">
      <EmptyHeader className="max-w-[400px] gap-0">
        <EmptyMedia className="mb-0">
          <AccentIcon icon={FolderLibraryIcon} size={44} />
        </EmptyMedia>
        <EmptyTitle className="mt-[22px] text-xl/[26px] font-semibold tracking-[-0.015em]">
          Your library starts here
        </EmptyTitle>
        <EmptyDescription className="mt-2 text-sm/[22px]">
          Import an audio or video file to save a copy, or download one from a video or podcast
          link. Your original stays where it is.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function LibraryFacts() {
  return (
    <ul className="mt-[72px] grid w-full gap-6 border-t pt-7 sm:grid-cols-3">
      {facts.map((fact) => (
        <li key={fact.title}>
          <AccentIcon icon={fact.icon} size={20} />
          <h3 className="mt-3 text-[13px]/[normal] font-semibold">{fact.title}</h3>
          <p className="mt-1 text-[12.5px]/[19px] text-muted-foreground">{fact.description}</p>
        </li>
      ))}
    </ul>
  );
}
