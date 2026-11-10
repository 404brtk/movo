import { createContext, use } from "react";
import { Link } from "@tanstack/react-router";
import type { ElementContent, Root } from "hast";
import Markdown, { type Components } from "react-markdown";
import { mediaLink, revealHiddenCharacters } from "../lib/ask-view.ts";

export const MomentContext = createContext<(() => void) | null>(null);

function MomentLink({
  mediaId,
  startMs,
  children,
}: {
  mediaId: string;
  startMs: number | undefined;
  children: React.ReactNode;
}) {
  const onMoment = use(MomentContext);
  return (
    <Link
      to="/media/$mediaId"
      params={{ mediaId }}
      search={startMs === undefined ? {} : { startMs }}
      onClick={() => onMoment?.()}
      className="inline-flex h-5 items-center rounded-md bg-tint px-1.5 align-baseline text-[12px] font-medium text-primary-deep tabular-nums no-underline transition-[scale] duration-120 ease-snappy hover:bg-highlight focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring active:scale-[0.97]"
    >
      {children}
    </Link>
  );
}

const components: Components = {
  a: ({ href, children }) => {
    const target = mediaLink(href);
    if (target)
      return (
        <MomentLink mediaId={target.mediaId} startMs={target.startMs}>
          {children}
        </MomentLink>
      );
    if (!href || !/^https?:\/\//iu.test(href)) return <span>{children}</span>;
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className="text-primary-strong underline underline-offset-2"
      >
        {children}
      </a>
    );
  },
  img: ({ alt }) => <span className="text-muted-foreground">[{alt || "image"}]</span>,
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  h1: ({ children }) => <p className="mt-3 mb-1 font-semibold">{children}</p>,
  h2: ({ children }) => <p className="mt-3 mb-1 font-semibold">{children}</p>,
  h3: ({ children }) => <p className="mt-3 mb-1 font-semibold">{children}</p>,
  code: ({ children }) => (
    <code className="rounded-[4px] bg-muted px-1 py-px font-mono text-[12px]">{children}</code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg bg-muted p-2.5 text-[12px]">{children}</pre>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 pl-3 text-muted-foreground">{children}</blockquote>
  ),
};

const wordSpans = (value: string): ElementContent[] =>
  value.split(/(?<=\s)/u).map((word) => ({
    type: "element",
    tagName: "span",
    properties: { className: ["ask-word"] },
    children: [{ type: "text", value: word }],
  }));

const splitWords = (children: ElementContent[]): ElementContent[] =>
  children.flatMap((child): ElementContent[] => {
    if (child.type === "text") return wordSpans(child.value);
    if (child.type === "element" && child.tagName !== "code")
      return [{ ...child, children: splitWords(child.children) }];
    return [child];
  });

const fadeArrivingWords = () => (tree: Root) => {
  for (const node of tree.children)
    if (node.type === "element") node.children = splitWords(node.children);
};

export function AskMarkdown({ text, live = false }: { text: string; live?: boolean }) {
  return (
    <div className="text-[13.5px]/[21px] text-pretty wrap-anywhere">
      <Markdown skipHtml components={components} rehypePlugins={live ? [fadeArrivingWords] : []}>
        {revealHiddenCharacters(text)}
      </Markdown>
    </div>
  );
}
