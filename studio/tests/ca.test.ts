import { describe, expect, it } from "vitest";
import path from "node:path";
import tls from "node:tls";
import { loadExtraCaCerts } from "../server/ca";

describe("extra CA certificates", () => {
  it("does nothing when unset", () => {
    expect(loadExtraCaCerts(undefined, ".")).toEqual([]);
    expect(loadExtraCaCerts(" , ", ".")).toEqual([]);
  });

  it("adds the bundled intermediate on top of the default roots", () => {
    const before = tls.getCACertificates("default").length;
    const root = path.resolve(__dirname, "..");
    expect(loadExtraCaCerts("certs/geotrust-tls-rsa-ca-g1.pem", root)).toHaveLength(1);
    expect(tls.getCACertificates("default").length).toBe(before + 1);
  });

  it("fails loudly on a missing file", () => {
    expect(() => loadExtraCaCerts("certs/yok.pem", ".")).toThrow();
  });
});
