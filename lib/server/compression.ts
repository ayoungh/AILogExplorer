import { brotliCompress, brotliCompressSync, brotliDecompressSync, constants } from "node:zlib";

export type EncodedRaw = { data: Buffer; encoding: "identity" | "br"; bytes: number };

export function encodeRaw(value: unknown): EncodedRaw {
  const source = Buffer.from(JSON.stringify(value ?? null), "utf8");
  if (source.length <= 4096) return { data: source, encoding: "identity", bytes: source.length };
  return {
    data: brotliCompressSync(source, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 2 },
    }),
    encoding: "br",
    bytes: source.length,
  };
}

export async function encodeRawAsync(value: unknown): Promise<EncodedRaw> {
  const source = Buffer.from(JSON.stringify(value ?? null), "utf8");
  if (source.length <= 4096) return { data: source, encoding: "identity", bytes: source.length };
  const data = await new Promise<Buffer>((resolve, reject) => {
    brotliCompress(source, { params: { [constants.BROTLI_PARAM_QUALITY]: 2 } }, (error, result) => {
      if (error) reject(error);
      else resolve(result);
    });
  });
  return { data, encoding: "br", bytes: source.length };
}

export function decodeRaw(data: Buffer, encoding: string): unknown {
  const json = encoding === "br" ? brotliDecompressSync(data).toString("utf8") : data.toString("utf8");
  return JSON.parse(json);
}


