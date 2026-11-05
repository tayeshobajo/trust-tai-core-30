// Node-only investigation prototype. NOT connected to the production route.
// Cloudflare cannot guarantee this lookup/pinning behavior; do not enable without runtime validation.
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import ipaddr from "ipaddr.js";
import { parseHTML } from "linkedom";
import type { IntakeSource } from "@/domain/rfp-intake";
export function validateSourceUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443") ||
    url.hostname.endsWith(".") ||
    !url.hostname.includes(".")
  )
    throw new Error("Use a public HTTPS source URL without credentials or a custom port.");
  if (/(^|\.)(google\.com|googleusercontent\.com|localhost|local|internal)$/.test(url.hostname))
    throw new Error(
      "For private Google documents, download a PDF or DOCX using your existing access and choose the file. Do not make it public.",
    );
  url.hash = "";
  return url;
}
export function publicAddress(address: string): boolean {
  try {
    return ipaddr.parse(address).range() === "unicast";
  } catch {
    return false;
  }
}
export function sourceFromHtml(html: string, url: string): IntakeSource {
  const { document } = parseHTML(html);
  const title =
    document.querySelector("h1")?.textContent?.trim() ||
    document.querySelector("title")?.textContent?.trim() ||
    "";
  document
    .querySelectorAll("script,style,nav,header,footer,iframe,form,noscript,svg")
    .forEach((n) => n.remove());
  const body = document.querySelector("main,article") || document.body;
  const text =
    Array.from(body.querySelectorAll("h1,h2,h3,p,li,td,dt,dd"))
      .map((n) => n.textContent?.trim())
      .filter(Boolean)
      .join("\n") ||
    body.textContent ||
    "";
  if (!text.trim())
    throw new Error(
      "This page has no readable text. Download its source document or paste the relevant text.",
    );
  return {
    title: title.slice(0, 240),
    text: text.slice(0, 100000),
    url,
    warning: "Public page text only. Linked documents and dynamic content were not read.",
  };
}
/** DNS validation + pinned connection for every hop; never forwards caller credentials. */
export async function readPublicSource(input: string): Promise<IntakeSource> {
  let url = validateSourceUrl(input);
  const stop = Date.now() + 15000;
  for (let hop = 0; hop < 4; hop++) {
    let lookupTimer: ReturnType<typeof setTimeout> | undefined;
    const addresses = await Promise.race([
      lookup(url.hostname, { all: true }),
      new Promise<never>((_, reject) => {
        lookupTimer = setTimeout(
          () => reject(new Error("Source lookup timed out.")),
          Math.min(3000, Math.max(1, stop - Date.now())),
        );
      }),
    ]).finally(() => clearTimeout(lookupTimer));
    if (!addresses.length || addresses.some((a) => !publicAddress(a.address)))
      throw new Error("This address is not an eligible public source.");
    const pinned = addresses[0]!;
    const result = await new Promise<{ body: string; redirect?: string; plain?: boolean }>(
      (resolve, reject) => {
        const req = httpsRequest(
          url,
          {
            agent: false,
            family: pinned.family,
            lookup: (_hostname, _options, callback) =>
              callback(null, pinned.address, pinned.family),
            headers: {
              Accept: "text/html,text/plain",
              "Accept-Encoding": "identity",
              "User-Agent": "CMD-Opportunity-Reader/1.0",
            },
          },
          (res) => {
            const status = res.statusCode || 0;
            if ([301, 302, 303, 307, 308].includes(status)) {
              res.destroy();
              resolve({ body: "", redirect: res.headers.location || "" });
              return;
            }
            if (status !== 200) {
              res.destroy();
              reject(
                new Error(
                  `Source returned HTTP ${status}. Upload the document or paste its text instead.`,
                ),
              );
              return;
            }
            const mime = res.headers["content-type"] || "";
            if (
              !/^(text\/html|text\/plain)(;|$)/i.test(mime) ||
              (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity")
            ) {
              res.destroy();
              reject(
                new Error(
                  "This URL is not a supported text page. Download the PDF or DOCX and choose the file.",
                ),
              );
              return;
            }
            if (Number(res.headers["content-length"] || 0) > 2 * 1024 * 1024) {
              res.destroy();
              reject(
                new Error("Source is larger than 2 MB. Choose a document or paste an excerpt."),
              );
              return;
            }
            let size = 0;
            const chunks: Buffer[] = [];
            res.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size > 2 * 1024 * 1024) {
                req.destroy(new Error("Source exceeds the download limit."));
                return;
              }
              chunks.push(chunk);
            });
            res.on("end", () =>
              resolve({
                body: Buffer.concat(chunks).toString("utf8"),
                plain: /^text\/plain/i.test(mime),
              }),
            );
            res.on("error", reject);
          },
        );
        const timer = setTimeout(
          () => req.destroy(new Error("Source read timed out.")),
          Math.max(1, stop - Date.now()),
        );
        req.on("close", () => clearTimeout(timer));
        req.on("error", reject);
        req.end();
      },
    );
    if (result.redirect !== undefined) {
      if (!result.redirect) throw new Error("Source redirected without a destination.");
      url = validateSourceUrl(new URL(result.redirect, url).href);
      continue;
    }
    if (result.plain) {
      if (!result.body.trim()) throw new Error("This source contains no readable text.");
      return {
        text: result.body.slice(0, 100000),
        url: url.href,
        warning: "Public plain text only; linked documents were not read.",
      };
    }
    return sourceFromHtml(result.body, url.href);
  }
  throw new Error("Too many source redirects. Choose the document instead.");
}
