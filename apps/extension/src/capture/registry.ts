/** Every adapter the extension ships, and the one guard that makes "adapters never throw" true. */
import type { Adapter, ExtractResult, PageContext } from "./adapter";
import { instacartAdapter } from "./adapters/instacart";

export const ADAPTERS: readonly Adapter[] = [instacartAdapter];

/** The first adapter whose `matches(url)` is true, or undefined. `matches` itself never throws. */
export function findAdapter(
  url: string,
  adapters: readonly Adapter[] = ADAPTERS,
): Adapter | undefined {
  for (const adapter of adapters) {
    try {
      if (adapter.matches(url)) return adapter;
    } catch {
      // A throwing matcher is a bug in that adapter, not a reason to break the others.
    }
  }
  return undefined;
}

/** Run an adapter with a last-resort catch, so even a broken adapter yields a failure value. */
export function runAdapter(adapter: Adapter, doc: Document, ctx: PageContext): ExtractResult {
  try {
    return adapter.extract(doc, ctx);
  } catch (e) {
    return {
      ok: false,
      reason: "adapter_threw",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}
