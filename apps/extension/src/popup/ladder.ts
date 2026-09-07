/**
 * The ladder section of the popup (S11): the cell's price tiers as bars, the user's tier
 * highlighted, the floor marked, the API's explain line, and one of three states. Pure view
 * model plus a renderer over `el()`; the fetch happens in render.ts. No claim language
 * anywhere in this file (CLAUDE.md rule 10).
 */
import type { PriceObservation } from "@pennypincher/schema";
import { el } from "../lib/dom";
import type { CellFetch, CellSummary } from "../sync/transport";

/**
 * The cell an observation belongs to, exactly as the API computes it
 * (apps/api/src/repo/observations.ts): retailer|retailerStoreId|retailerSku|fulfillment|zip3,
 * absent parts as empty strings.
 */
export function cellKeyOf(o: PriceObservation): string {
  return [
    o.retailer,
    o.store?.retailerStoreId ?? "",
    o.product.retailerSku,
    o.context.fulfillment,
    o.context.zip3 ?? "",
  ].join("|");
}

export interface TierBar {
  price: number;
  /** 0..1 */
  share: number;
  n: number;
  /** The tier the user's recorded price sits on. */
  mine: boolean;
  /** The lowest confirmed tier. */
  floor: boolean;
}

export type LadderView =
  /** Not asked yet, or in flight. */
  | { kind: "loading" }
  /** The build has no pilot token: the ladder cannot be asked for. */
  | { kind: "unconfigured" }
  /** The panel has a ladder for this cell. */
  | {
      kind: "resolved";
      tiers: TierBar[];
      summary: string;
      n: number;
      currency: string;
      mineOnLadder: boolean;
    }
  /** The panel has observations but not enough to resolve; `needed` more would do it. */
  | { kind: "unresolved"; needed: number; summary: string; n: number; moreWillHelp: boolean }
  /** Nobody has observed this cell in the window, or the panel could not be reached. */
  | { kind: "no_data"; summary?: string; unreachable?: boolean };

/** Fold a cell fetch and the user's own price into what the popup shows. Pure. */
export function ladderView(fetched: CellFetch, myPriceMinor: number): LadderView {
  if (!fetched.ok) return { kind: "no_data", unreachable: true };
  return ladderViewOf(fetched.cell, myPriceMinor);
}

export function ladderViewOf(cell: CellSummary, myPriceMinor: number): LadderView {
  const r = cell.resolution;
  if (r.status === "RESOLVED") {
    const tiers = r.tiers.map((t, i) => ({
      price: t.price,
      share: t.share,
      n: t.n,
      mine: t.price === myPriceMinor,
      floor: i === 0,
    }));
    return {
      kind: "resolved",
      tiers,
      summary: cell.summary,
      n: r.n,
      currency: r.currency,
      mineOnLadder: tiers.some((t) => t.mine),
    };
  }
  if (r.reason === "no_observations") return { kind: "no_data", summary: cell.summary };
  return {
    kind: "unresolved",
    needed: r.needed,
    summary: cell.summary,
    n: r.n,
    moreWillHelp: r.reason !== "too_many_tiers",
  };
}

/** "$0.22", "$12.00"; other currencies as "12.00 EUR". Mirrors stats' formatMinor. */
export function formatMinor(amountMinor: number, currency: string): string {
  const major = Math.floor(amountMinor / 100);
  const minor = amountMinor % 100;
  const body = `${major}.${String(minor).padStart(2, "0")}`;
  return currency === "USD" ? `$${body}` : `${body} ${currency}`;
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** "RESOLVED" / "UNRESOLVED" / "NO DATA": the state word the brief asks for. */
export function stateText(view: LadderView): string {
  switch (view.kind) {
    case "resolved":
      return "RESOLVED";
    case "unresolved":
      return "UNRESOLVED";
    case "no_data":
      return "NO DATA";
    case "loading":
      return "Checking the panel…";
    case "unconfigured":
      return "NO DATA";
  }
}

/** "Needs 12 more observations" / "Needs 1 more observation". */
export function neededText(needed: number): string {
  return `Needs ${needed} more ${needed === 1 ? "observation" : "observations"}`;
}

/** "You contributed 12 observations this week." */
export function contributionText(n: number): string {
  return `You contributed ${n} ${n === 1 ? "observation" : "observations"} this week.`;
}

function tierRow(tier: TierBar, currency: string): HTMLElement {
  const classes = ["tier"];
  if (tier.mine) classes.push("mine");
  if (tier.floor) classes.push("floor");
  const marks: string[] = [];
  if (tier.floor) marks.push("floor");
  if (tier.mine) marks.push("your price");
  const label = `${formatMinor(tier.price, currency)} · ${percent(tier.share)}${marks.length ? ` (${marks.join(", ")})` : ""}`;
  return el("li", { class: classes.join(" ") }, [
    el("span", { class: "tier-label", text: label }),
    el("span", { class: "bar-track" }, [
      el("span", {
        class: "bar",
        style: `width: ${Math.max(2, Math.round(tier.share * 100))}%`,
        role: "img",
        "aria-label": `${percent(tier.share)} of ${tier.n === 1 ? "1 observation" : `${tier.n} observations`}`,
      }),
    ]),
  ]);
}

/** The ladder section as DOM. Exported so every state can be rendered in a test. */
export function ladderElement(view: LadderView): HTMLElement {
  const children: Node[] = [
    el("h2", { text: "Panel ladder" }),
    el("p", { class: `state state-${view.kind}`, text: stateText(view) }),
  ];
  switch (view.kind) {
    case "loading":
      break;
    case "unconfigured":
      children.push(
        el("p", { class: "muted", text: "This build has no panel access configured." }),
      );
      break;
    case "resolved":
      children.push(
        el(
          "ol",
          { class: "ladder" },
          view.tiers.map((t) => tierRow(t, view.currency)),
        ),
        el("p", { class: "muted", text: view.summary }),
      );
      if (!view.mineOnLadder) {
        children.push(
          el("p", {
            class: "muted",
            text: "Your recorded price is not one of the confirmed tiers yet.",
          }),
        );
      }
      break;
    case "unresolved":
      if (view.moreWillHelp) children.push(el("p", { text: neededText(view.needed) }));
      children.push(el("p", { class: "muted", text: view.summary }));
      break;
    case "no_data":
      children.push(
        el("p", {
          class: "muted",
          text: view.unreachable
            ? "Could not reach the panel. The ladder will show once it is back."
            : (view.summary ?? "No one in the panel has recorded this cell in the last 3 days."),
        }),
      );
      break;
  }
  return el("section", { class: "ladder-section" }, children);
}
