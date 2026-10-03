import fs from "node:fs";
import type { RfmReviewIndexSummary } from "@inkback/rfm";

interface FinishResult {
  summary: RfmReviewIndexSummary;
  version: string;
  message: string;
}
interface OpenDocument {
  documentPath: string;
  openedAt: string;
  lastVersion: string;
  writable: boolean;
  finished: boolean;
  requestId?: string;
  result?: FinishResult;
}
export class OpenDocuments {
  private documents = new Map<string, OpenDocument>();
  open(documentPath: string, version: string, writable: boolean) {
    const real = fs.realpathSync(documentPath);
    let entry = this.documents.get(real);
    if (!entry) {
      entry = {
        documentPath: real,
        openedAt: new Date().toISOString(),
        lastVersion: version,
        writable,
        finished: false,
      };
      this.documents.set(real, entry);
    }
    entry.lastVersion = version;
    entry.writable = writable;
    return entry;
  }
  list() {
    return [...this.documents.values()].map(
      ({ requestId: _requestId, result: _result, ...entry }) => entry,
    );
  }
}
