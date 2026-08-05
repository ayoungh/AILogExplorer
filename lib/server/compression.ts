import { PassThrough, Readable } from "node:stream";
import { brotliCompress, brotliCompressSync, brotliDecompressSync, constants, createBrotliDecompress } from "node:zlib";

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

export async function previewJsonText(data: Buffer, encoding: string, maxBytes: number) {
  if (encoding !== "br") {
    return {
      text: data.subarray(0, maxBytes).toString("utf8"),
      truncated: data.length > maxBytes,
      bytes: data.length,
    };
  }

  return new Promise<{ text: string; truncated: boolean; bytes: number | null }>((resolve, reject) => {
    const source = Readable.from([data]);
    const decoder = createBrotliDecompress();
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    let length = 0;
    let settled = false;

    const finish = (truncated: boolean) => {
      if (settled) return;
      settled = true;
      resolve({ text: Buffer.concat(chunks, length).toString("utf8"), truncated, bytes: truncated ? null : length });
      if (truncated) {
        source.destroy();
        decoder.destroy();
        output.destroy();
      }
    };

    output.on("data", (chunk: Buffer) => {
      const remaining = maxBytes - length;
      if (remaining > 0) {
        const value = chunk.length > remaining ? chunk.subarray(0, remaining) : chunk;
        chunks.push(value);
        length += value.length;
      }
      if (chunk.length > remaining) finish(true);
    });
    output.on("end", () => finish(false));
    output.on("error", (error) => { if (!settled) reject(error); });
    decoder.on("error", (error) => { if (!settled) reject(error); });
    source.pipe(decoder).pipe(output);
  });
}

export function streamJsonText(data: Buffer, encoding: string) {
  const source = Readable.from([data]);
  const stream = encoding === "br" ? source.pipe(createBrotliDecompress()) : source;
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}

