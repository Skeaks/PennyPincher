// S01 gate self-test: deliberately references document.cookie. Must be rejected by forbidden-api.
export function readCookies(): string {
  return document.cookie;
}
