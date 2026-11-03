import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, hashRecoveryCode, newRecoveryCodes, totpAt, verifyTotp } from "../src/lib/totp";

// RFC 6238 test secret ("12345678901234567890"), SHA-1, read as 6-digit codes.
const SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("TOTP", () => {
  it("round-trips base32", () => {
    expect(base32Decode(SECRET).toString()).toBe("12345678901234567890");
    expect(SECRET).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  });

  it("matches the RFC 6238 test vectors", () => {
    expect(totpAt(SECRET, Math.floor(59 / 30))).toBe("287082");
    expect(totpAt(SECRET, Math.floor(1111111109 / 30))).toBe("081804");
    expect(totpAt(SECRET, Math.floor(1234567890 / 30))).toBe("005924");
    expect(totpAt(SECRET, Math.floor(2000000000 / 30))).toBe("279037");
  });

  it("accepts the current code and one step of drift, once", () => {
    const now = 1234567890 * 1000;
    const code = totpAt(SECRET, Math.floor(1234567890 / 30));
    const step = verifyTotp(SECRET, code, { now });
    expect(step).toBe(Math.floor(1234567890 / 30));
    expect(verifyTotp(SECRET, code, { now: now + 30_000 })).not.toBeNull();
    expect(verifyTotp(SECRET, code, { now: now + 90_000 })).toBeNull();
    expect(verifyTotp(SECRET, code, { now, lastUsedStep: step })).toBeNull();
    expect(verifyTotp(SECRET, "12345", { now })).toBeNull();
  });

  it("makes distinct recovery codes and hashes them case-insensitively", () => {
    const codes = newRecoveryCodes();
    expect(new Set(codes).size).toBe(8);
    expect(codes[0]).toMatch(/^[a-z2-7]{5}-[a-z2-7]{5}$/);
    expect(hashRecoveryCode(codes[0]!.toUpperCase())).toBe(hashRecoveryCode(codes[0]!));
  });
});
