import { unzipSync, strFromU8 } from "fflate";
import { validateUpload } from "@/domain/rfps";
import type { IntakeSource } from "@/domain/rfp-intake";
export async function readSourceFile(file: File): Promise<IntakeSource> {
  validateUpload(file);
  if (file.size > 10 * 1024 * 1024) throw new Error("Choose a source file smaller than 10 MB.");
  const buffer = await file.arrayBuffer();
  const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buffer)))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
  let text = "";
  let warning = "";
  if (/\.txt$/i.test(file.name)) text = new TextDecoder().decode(buffer);
  else if (/\.docx$/i.test(file.name)) {
    const files = unzipSync(new Uint8Array(buffer), {
      filter: (f) => {
        if (f.name !== "word/document.xml") return false;
        if (f.originalSize > 2 * 1024 * 1024)
          throw new Error("Document text is too large to extract safely.");
        return true;
      },
    });
    const xml = files["word/document.xml"];
    if (!xml) throw new Error("This file is not a readable DOCX document.");
    const doc = new DOMParser().parseFromString(strFromU8(xml), "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("The document XML could not be read.");
    text = Array.from(doc.getElementsByTagNameNS("*", "p"))
      .map((p) =>
        Array.from(p.getElementsByTagNameNS("*", "t"))
          .map((t) => t.textContent || "")
          .join(""),
      )
      .join("\n");
    warning = "Main document text only; headers, footnotes, images and comments are not extracted.";
  } else {
    const pdf = await import("pdfjs-dist");
    pdf.GlobalWorkerOptions.workerSrc = (
      await import("pdfjs-dist/build/pdf.worker.min.mjs?url")
    ).default;
    const task = pdf.getDocument({
      data: new Uint8Array(buffer),
      useSystemFonts: false,
      disableFontFace: true,
      stopAtErrors: true,
    });
    const timer = setTimeout(() => void task.destroy(), 20000);
    try {
      const doc = await task.promise;
      if (doc.numPages > 100) throw new Error("Choose a PDF of 100 pages or fewer.");
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        text +=
          content.items
            .map((item) =>
              "str" in item ? item.str + ("hasEOL" in item && item.hasEOL ? "\n" : " ") : "",
            )
            .join("") + "\n";
        if (text.length > 100000) {
          warning = "Text extraction stopped after 100,000 characters.";
          break;
        }
      }
    } finally {
      clearTimeout(timer);
      await task.destroy();
    }
  }
  if (!text.trim())
    warning =
      "No selectable text found. Scans require OCR, which is not connected. Enter the details you know; the original file will be preserved.";
  return { text: text.slice(0, 100000), fileName: file.name, sha256, warning };
}
