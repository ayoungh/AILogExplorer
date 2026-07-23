import { describe, expect, it } from "vitest";
import { isLoopbackRequest, mutationAllowed } from "@/lib/server/security";

describe("local request security", () => {
  it("accepts exact loopback origins", () => {
    const request = new Request("http://127.0.0.1:3210/api/jobs/scan", {
      headers: { host: "127.0.0.1:3210", origin: "http://127.0.0.1:3210" },
    });
    expect(isLoopbackRequest(request)).toBe(true);
    expect(mutationAllowed(request)).toBe(true);
  });

  it("rejects remote hosts and cross-origin loopback aliases", () => {
    expect(isLoopbackRequest(new Request("http://example.com/api/overview"))).toBe(false);
    const request = new Request("http://127.0.0.1:3210/api/index", {
      headers: { host: "127.0.0.1:3210", origin: "http://localhost:3210" },
    });
    expect(mutationAllowed(request)).toBe(false);
  });
});
