import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { sha256Hex } from "../../src/capture/sha256";

function reference(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

describe("sha256Hex", () => {
  it("matches the published vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    expect(sha256Hex("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")).toBe(
      "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1",
    );
  });

  it("agrees with Node's crypto across block boundaries and non-ASCII input", () => {
    const samples = [
      "a".repeat(55),
      "a".repeat(56),
      "a".repeat(63),
      "a".repeat(64),
      "a".repeat(65),
      "a".repeat(1000),
      "<div>$0.22 each (est.) • $0.59 / lb — Wegmans</div>",
      "日本語のテキストと絵文字 🍌",
    ];
    for (const s of samples) expect(sha256Hex(s)).toBe(reference(s));
  });
});
