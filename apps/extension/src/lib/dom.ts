/** Tiny DOM helpers. No innerHTML: all copy is set as text. */

type Attrs = Record<string, string> & { text?: string };

export function el(tag: string, attrs: Attrs = {}, children: Node[] = []): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "text") node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) node.appendChild(child);
  return node;
}

export function list(items: readonly string[]): HTMLElement {
  return el(
    "ul",
    {},
    items.map((text) => el("li", { text })),
  );
}

export function mount(node: HTMLElement, rootId = "app"): void {
  const root = document.getElementById(rootId);
  if (!root) throw new Error(`No #${rootId} element to mount into`);
  root.replaceChildren(node);
}
