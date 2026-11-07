import { parseHTML } from "linkedom";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import {
  SOURCE_LIMITS,
  PublicSourceError,
  approvedSourceUrl,
  isPublicSourceAddress,
  normalizedAddress,
  type SourceEvidence,
} from "./studio-research-source-evidence.server";
export * from "./studio-research-source-evidence.server";
export function createPublicSourceReader(io = { lookup, request: httpsRequest }) {
  return async (
    inputs: readonly string[],
    approved: readonly string[],
  ): Promise<SourceEvidence[]> => {
    if (
      !inputs.length ||
      inputs.length > SOURCE_LIMITS.count ||
      new Set(inputs).size !== inputs.length
    )
      throw new PublicSourceError("url_not_approved");
    const urls = inputs.map((value) => approvedSourceUrl(value, approved));
    const deadline = Date.now() + SOURCE_LIMITS.timeoutMs;
    const evidence: SourceEvidence[] = [];
    let totalBytes = 0;
    for (const url of urls) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const addresses = await Promise.race([
        io.lookup(url.hostname, { all: true }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new PublicSourceError("timeout")),
            Math.max(1, deadline - Date.now()),
          );
        }),
      ])
        .catch((error) => {
          throw error instanceof PublicSourceError ? error : new PublicSourceError("fetch_failed");
        })
        .finally(() => clearTimeout(timer));
      if (!addresses.length || addresses.some((a) => !isPublicSourceAddress(a.address)))
        throw new PublicSourceError("non_public_address");
      const pinned = addresses[0]!;
      if (Date.now() >= deadline) throw new PublicSourceError("timeout");
      const received = await new Promise<{ body: string; mime: string }>((resolve, reject) => {
        let settled = false;
        const fail = (error: PublicSourceError) => {
          if (!settled) {
            settled = true;
            reject(error);
          }
        };
        const req = io.request(
          url,
          {
            method: "GET",
            agent: false,
            family: pinned.family,
            servername: url.hostname,
            rejectUnauthorized: true,
            lookup: (_host, _options, callback) => callback(null, pinned.address, pinned.family),
            headers: {
              Accept: "text/html,text/plain",
              "Accept-Encoding": "identity",
              "User-Agent": "TrustTai-Studio-SourceReader/1.0",
            },
          },
          (res) => {
            const status = res.statusCode ?? 0;
            if (status >= 300 && status <= 399) {
              fail(new PublicSourceError("redirect_rejected"));
              res.destroy();
              return;
            }
            const mime = String(res.headers["content-type"] ?? "")
              .split(";")[0]!
              .trim()
              .toLowerCase();
            const encoding = res.headers["content-encoding"];
            if (
              status !== 200 ||
              !["text/html", "text/plain"].includes(mime) ||
              (encoding && encoding !== "identity")
            ) {
              fail(new PublicSourceError("response_rejected"));
              res.destroy();
              return;
            }
            const declared = res.headers["content-length"];
            if (declared && (!/^\d+$/.test(declared) || Number(declared) > SOURCE_LIMITS.bytes)) {
              fail(new PublicSourceError("source_too_large"));
              res.destroy();
              return;
            }
            const chunks: Buffer[] = [];
            let bytes = 0;
            res.on("data", (chunk: Buffer) => {
              if (settled) return;
              bytes += chunk.length;
              totalBytes += chunk.length;
              if (bytes > SOURCE_LIMITS.bytes || totalBytes > SOURCE_LIMITS.totalBytes) {
                fail(new PublicSourceError("source_too_large"));
                req.destroy();
                return;
              }
              chunks.push(chunk);
            });
            res.on("end", () => {
              if (!settled) {
                settled = true;
                resolve({ body: Buffer.concat(chunks).toString("utf8"), mime });
              }
            });
            res.on("aborted", () => fail(new PublicSourceError("fetch_failed")));
            res.on("error", () => fail(new PublicSourceError("fetch_failed")));
          },
        );
        req.on("socket", (socket) =>
          socket.once("secureConnect", () => {
            try {
              if (
                !socket.remoteAddress ||
                normalizedAddress(socket.remoteAddress) !== normalizedAddress(pinned.address)
              ) {
                fail(new PublicSourceError("non_public_address"));
                req.destroy();
              }
            } catch {
              fail(new PublicSourceError("non_public_address"));
              req.destroy();
            }
          }),
        );
        const stop = setTimeout(
          () => {
            fail(new PublicSourceError("timeout"));
            req.destroy();
          },
          Math.max(1, deadline - Date.now()),
        );
        req.on("close", () => {
          clearTimeout(stop);
          if (!settled) fail(new PublicSourceError("fetch_failed"));
        });
        req.on("error", () => fail(new PublicSourceError("fetch_failed")));
        req.end();
      }).catch((error) => {
        throw error instanceof PublicSourceError ? error : new PublicSourceError("fetch_failed");
      });
      evidence.push(extractSource(received.body, received.mime, url.href, Date.now()));
    }
    return evidence;
  };
}

export function extractSource(
  body: string,
  mime: string,
  url: string,
  now: number,
): SourceEvidence {
  let title = "Public source",
    text = body;
  if (mime === "text/html") {
    // linkedom parses inert markup: no browser, script execution, subresource fetch or link following.
    const { document } = parseHTML(body);
    document
      .querySelectorAll(
        "script,style,iframe,object,embed,form,input,button,nav,header,footer,noscript,svg,template,link,meta",
      )
      .forEach((n) => n.remove());
    title = document.querySelector("title,h1")?.textContent ?? title;
    text =
      (document.querySelector("main,article,body") ?? document.documentElement)?.textContent ?? "";
  }
  const clean = (value: string) =>
    value
      .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  text = clean(text).slice(0, SOURCE_LIMITS.textChars);
  if (!text) throw new PublicSourceError("empty_source");
  return {
    url,
    title: clean(title).slice(0, 160),
    text,
    sha256: createHash("sha256").update(text).digest("hex"),
    retrievedAt: new Date(now).toISOString(),
    publishedAt: null,
  };
}

/** Dependency injection is for offline tests only; production caller must use defaults. */
