import { describe, expect, it } from "vitest";
import { decodeRaw, encodeRaw, encodeRawAsync, previewJsonText, streamJsonText } from "@/lib/server/compression";

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

  it("bounds previews and streams complete JSON text", async () => {
    const value = { output: "bounded preview ".repeat(2_000) };
    const encoded = await encodeRawAsync(value);
    const preview = await previewJsonText(encoded.data, encoded.encoding, 256);
    const complete = await new Response(streamJsonText(encoded.data, encoded.encoding)).text();

    expect(preview.text.length).toBeLessThanOrEqual(256);
    expect(preview.truncated).toBe(true);
    expect(preview.bytes).toBeNull();
    expect(JSON.parse(complete)).toEqual(value);
  });
});
