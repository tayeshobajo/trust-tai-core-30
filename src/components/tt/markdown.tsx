import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { cn } from "@/lib/utils";

/** Readable Trust Tai rendering of saved Markdown. No raw HTML is allowed. */
export function Markdown({ content, className }: { content: string; className?: string }) {
  return (
    <div className={cn("max-w-reading space-y-4 text-sm text-muted-foreground", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h2 className="tt-display mt-8 text-2xl text-foreground first:mt-0">{children}</h2>
          ),
          h2: ({ children }) => (
            <h3 className="mt-8 text-lg font-semibold tracking-tight text-foreground first:mt-0">
              {children}
            </h3>
          ),
          h3: ({ children }) => (
            <h4 className="mt-6 text-base font-semibold text-foreground first:mt-0">{children}</h4>
          ),
          p: ({ children }) => <p className="leading-relaxed">{children}</p>,
          ul: ({ children }) => (
            <ul className="ml-4 list-disc space-y-1.5 marker:text-border">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="ml-4 list-decimal space-y-1.5 marker:text-border">{children}</ol>
          ),
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold text-foreground">{children}</strong>
          ),
          em: ({ children }) => <em className="italic text-foreground">{children}</em>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-royal/40 pl-4 italic text-foreground">
              {children}
            </blockquote>
          ),
          code: ({ children }) => (
            <code className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[12px] text-foreground">
              {children}
            </code>
          ),
          hr: () => <hr className="border-border" />,
          a: ({ children, href }) => (
            <a
              href={href}
              className="text-royal underline underline-offset-4"
              rel="noreferrer noopener"
              target="_blank"
            >
              {children}
            </a>
          ),
          table: ({ children }) => (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-border py-2 pr-4 font-medium text-foreground">
              {children}
            </th>
          ),
          td: ({ children }) => <td className="border-b border-border py-2 pr-4">{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
