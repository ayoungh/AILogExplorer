import { describe, expect, it } from "vitest";
import { decodeRaw, encodeRaw, encodeRawAsync } from "@/lib/server/compression";

describe("raw record compression", () => {
  it("round-trips small identity and large Brotli records", async () => {
    const small = { message: "hello" };
    const large = { output: "repeatable output ".repeat(1_000) };
    const identity = encodeRaw(small);
    const compressed = await encodeRawAsync(large);

    expect(identity.encoding).toBe("identity");
    expect(compressed.encoding).toBe("br");
    expect(decodeRaw(identity.data, identity.encoding)).toEqual(small);
    expect(decodeRaw(compressed.data, compressed.encoding)).toEqual(large);
  });
});
