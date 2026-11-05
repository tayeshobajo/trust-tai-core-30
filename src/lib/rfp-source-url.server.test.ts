// @vitest-environment node
import { it, expect, vi } from "vitest";
import {
  validateSourceUrl,
  publicAddress,
  sourceFromHtml,
  readPublicSource,
} from "./rfp-source-url.server";
import * as dns from "node:dns/promises";
vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
it("rejects credentials, non-HTTPS, private Google documents, and custom ports", () => {
  for (const u of [
    "http://example.org",
    "https://user:secret@example.org",
    "https://example.org:8443",
    "https://docs.google.com/document/d/private/edit",
    "https://localhost",
    "file:///etc/passwd",
  ])
    expect(() => validateSourceUrl(u)).toThrow();
});
it("rejects private, loopback, mapped, link-local, multicast and reserved addresses", () => {
  for (const a of [
    "127.0.0.1",
    "10.0.0.1",
    "192.168.0.1",
    "172.16.2.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "::1",
    "fc00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ])
    expect(publicAddress(a), a).toBe(false);
  expect(publicAddress("93.184.216.34")).toBe(true);
});
it("rejects mixed public/private DNS results before connecting", async () => {
  const spy = vi.mocked(dns.lookup).mockResolvedValue([
    { address: "93.184.216.34", family: 4 },
    { address: "10.0.0.1", family: 4 },
  ] as never);
  await expect(readPublicSource("https://example.org")).rejects.toThrow("not an eligible");
  spy.mockReset();
});
it("extracts inert text without scripts or navigation", () => {
  const r = sourceFromHtml(
    "<html><head><title>RFP</title></head><body><nav>Skip</nav><main><h1>Website RFP</h1><p>Issued by: Test Board</p><script>steal()</script></main></body></html>",
    "https://example.org",
  );
  expect(r.title).toBe("Website RFP");
  expect(r.text).toContain("Issued by: Test Board");
  expect(r.text).not.toContain("steal");
  expect(r.text).not.toContain("Skip");
});

vi.mock("node:https", () => ({ request: vi.fn() }));
import { request } from "node:https";
import { EventEmitter } from "node:events";
function response(status: number, headers: Record<string, string>, chunks: string[] = []) {
  vi.mocked(request).mockImplementationOnce(((
    _url: URL,
    _options: unknown,
    callback: (res: unknown) => void,
  ) => {
    const req = new EventEmitter() as EventEmitter & {
      end: () => void;
      destroy: (error?: Error) => void;
    };
    req.destroy = (error) => {
      if (error) req.emit("error", error);
      req.emit("close");
    };
    req.end = () => {
      const res = new EventEmitter() as EventEmitter & {
        statusCode: number;
        headers: typeof headers;
        destroy: () => void;
      };
      res.statusCode = status;
      res.headers = headers;
      res.destroy = () => req.emit("close");
      callback(res);
      for (const chunk of chunks) res.emit("data", Buffer.from(chunk));
      res.emit("end");
      req.emit("close");
    };
    return req;
  }) as never);
}
it("revalidates a redirect destination before connecting to a private address", async () => {
  vi.mocked(request).mockClear();
  vi.mocked(dns.lookup)
    .mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as never)
    .mockResolvedValueOnce([{ address: "10.0.0.1", family: 4 }] as never);
  response(302, { location: "https://private.example.org/secret" });
  await expect(readPublicSource("https://example.org")).rejects.toThrow("not an eligible");
  expect(request).toHaveBeenCalledTimes(1);
});
it("limits streamed bytes even when content-length is missing", async () => {
  vi.mocked(dns.lookup).mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as never);
  response(200, { "content-type": "text/html" }, ["x".repeat(2 * 1024 * 1024 + 1)]);
  await expect(readPublicSource("https://example.org")).rejects.toThrow("download limit");
});
it("preserves literal plain text instead of parsing it as HTML", async () => {
  vi.mocked(dns.lookup).mockResolvedValueOnce([{ address: "93.184.216.34", family: 4 }] as never);
  response(200, { "content-type": "text/plain" }, ["Title: Website services\nBudget: <unknown>"]);
  const result = await readPublicSource("https://example.org");
  expect(result.text).toContain("<unknown>");
});
