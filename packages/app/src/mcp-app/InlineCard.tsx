import type { RfmReviewIndexSummary } from "@inkback/rfm";
import { Button } from "../components/ui/button";
export function InlineCard({
  documentPath,
  summary,
  writable,
  onOpen,
}: {
  documentPath: string;
  summary: RfmReviewIndexSummary;
  writable: boolean;
  onOpen: () => void;
}) {
  return (
    <main
      className="rounded-xl border bg-background p-5 text-foreground"
      data-testid="mcp-inline-card"
    >
      <h1 className="text-lg font-semibold">
        {documentPath.split(/[\\/]/).pop()}
      </h1>
      <p className="my-3 text-sm">
        {summary.unresolved} unresolved items · {summary.comments} comments ·{" "}
        {summary.suggestions} suggestions
      </p>
      {!writable && <p className="mb-3 text-sm">Read-only</p>}
      <Button onClick={onOpen}>Open review</Button>
    </main>
  );
}
