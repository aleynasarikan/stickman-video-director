import { readFileSync } from "node:fs";
import path from "node:path";
import tls from "node:tls";

/**
 * Trusts extra CA certificates (PEM files, comma separated) for outgoing HTTPS, on top of
 * Node's built-in roots. Needed for servers that omit their intermediate certificate:
 * browsers and curl fill the gap themselves, Node does not. Verification stays on.
 */
export function loadExtraCaCerts(list: string | undefined, root: string): string[] {
  const files = (list ?? "").split(",").map((f) => f.trim()).filter(Boolean);
  if (!files.length) return [];
  const extra = files.map((f) => readFileSync(path.resolve(root, f), "utf8"));
  tls.setDefaultCACertificates([...tls.getCACertificates("default"), ...extra]);
  return files;
}
