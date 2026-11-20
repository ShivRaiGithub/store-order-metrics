import { Fragment } from "react";

/** Renders the small bit of markdown models use in short answers: **bold** and "- " bullets. */
export function ReplyText({ text }: { text: string }) {
  const bold = (line: string) =>
    line.split(/(\*\*[^*]+\*\*)/g).map((seg, i) =>
      seg.startsWith("**") && seg.endsWith("**") && seg.length > 4 ? (
        <strong key={i} className="font-semibold">
          {seg.slice(2, -2)}
        </strong>
      ) : (
        <Fragment key={i}>{seg}</Fragment>
      ),
    );
  return (
    <>
      {text.split("\n").map((line, i) => {
        const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
        if (bullet) {
          return (
            <div key={i} className="flex gap-2 pl-1">
              <span aria-hidden>•</span>
              <span>{bold(bullet[1])}</span>
            </div>
          );
        }
        return line.trim() === "" ? <div key={i} className="h-2" /> : <div key={i}>{bold(line)}</div>;
      })}
    </>
  );
}
