import { describe, expect, it } from "vitest";
import { contentPolicyIssues, inspectCandidate, pathPolicyIssues } from "../scripts/check-public-tree.mjs";

describe("public tree privacy policy", () => {
  it("accepts ordinary source and clearly synthetic examples", () => {
    expect(inspectCandidate("lib/parser.ts", "Contact maintainer@example.com and read /tmp/synthetic.json")).toEqual([]);
    expect(inspectCandidate("tests/fixtures/example.json", JSON.stringify({ title: "Synthetic conversation" }))).toEqual([]);
  });

  it("rejects screenshots, databases, exported logs, and environment files", () => {
    expect(pathPolicyIssues(["docs", "screenshots", "desktop.png"].join("/"))).toContain("private or generated directory");
    expect(pathPolicyIssues(["private", "session.jsonl"].join("/"))).toContain("AI log export");
    expect(pathPolicyIssues(["cache", "index.sqlite-wal"].join("/"))).toContain("database sidecar");
    expect(pathPolicyIssues(["private", "state.vscdb"].join("/"))).toContain("database");
    expect(pathPolicyIssues(".env.local")).toContain("environment file");
  });

  it("allows only the exact generated provider-native fixture paths", () => {
    expect(pathPolicyIssues("examples/provider-native/codex-example.jsonl")).toEqual([]);
    expect(pathPolicyIssues("examples/provider-native/claude-code-example.jsonl")).toEqual([]);
    expect(pathPolicyIssues("examples/provider-native/claude-desktop-example-audit.jsonl")).toEqual([]);
    expect(pathPolicyIssues("examples/provider-native/cursor-example.vscdb")).toEqual([]);
    expect(pathPolicyIssues("examples/provider-native/another-example.jsonl")).toContain("AI log export");
    expect(pathPolicyIssues("examples/provider-native/cursor-example-copy.vscdb")).toContain("database");
  });

  it("rejects personal paths and non-example email addresses", () => {
    const macHome = ["/Users", "sample-person", "Documents", "private-log.json"].join("/");
    const realEmail = ["person", "company.test"].join("@");
    expect(contentPolicyIssues(`Read ${macHome}`)).toContain("absolute user-home path");
    expect(contentPolicyIssues(`Contact ${realEmail}`)).toContain("non-example email address");
  });

  it("rejects credentials without echoing their values", () => {
    const apiKey = `sk-${"A1".repeat(16)}`;
    const privateKey = ["-----BEGIN RSA ", "PRIVATE KEY-----"].join("");
    expect(contentPolicyIssues(apiKey)).toContain("OpenAI-style API key");
    expect(contentPolicyIssues(privateKey)).toContain("private key material");
  });
});
