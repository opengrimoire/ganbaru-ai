import type * as ReviewDiffRuntimeModule from "./diff-runtime";

/** Keeps the enhanced desktop diff runtime outside mobile bundles. */
export function loadChatReviewDiffRuntime(): Promise<typeof ReviewDiffRuntimeModule> {
  return Promise.reject(new Error("Enhanced Chat diffs are unavailable on mobile"));
}
