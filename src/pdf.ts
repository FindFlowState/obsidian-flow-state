/**
 * Minimal single-page PDF writer: wraps one JPEG in a page of the same size.
 *
 * This replaces jsPDF, which we only ever used for exactly this. jsPDF pulls
 * ~1 MB into the bundle and ships code paths that inject <script> elements
 * (its "open in new window" output and a core-js setImmediate shim), which
 * the Obsidian community-plugin review flags as a security error even though
 * we never call them. A hand-rolled PDF is ~60 lines and has no such baggage.
 *
 * The page is sized to the image (1 px = 1 pt), so there is no letterboxing:
 * the whole page is picture. The processor rasterises pages by scaling the
 * long edge to a fixed pixel size, so page dimensions only set the aspect.
 *
 * Pure function (no DOM) so it can be unit-tested in Node.
 */

export interface JpegImage {
  /** Raw JPEG file bytes (baseline or progressive; any DCTDecode-able stream). */
  bytes: Uint8Array;
  /** Pixel dimensions of the JPEG; also the page size in points. */
  width: number;
  height: number;
}

const encoder = new TextEncoder();

/**
 * Build a one-page PDF containing `image`, returned as raw bytes suitable
 * for `new Blob([bytes], { type: "application/pdf" })`.
 */
export function jpegToPdf(image: JpegImage): Uint8Array<ArrayBuffer> {
  const { bytes, width, height } = image;
  if (!(width > 0) || !(height > 0)) throw new Error("Image has no dimensions.");
  if (bytes.length === 0) throw new Error("Image has no data.");

  // Draw the image across the entire page.
  const content = `q ${width} 0 0 ${height} 0 0 cm /Im0 Do Q`;
  const contentBytes = encoder.encode(content);

  // Objects are numbered 1..5 in this order. Each entry is one whole object
  // (header, body, "endobj") so xref offsets fall out of the lengths.
  const objects: Uint8Array[] = [
    encoder.encode("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"),
    encoder.encode("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"),
    encoder.encode(
      `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
        `/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>\nendobj\n`,
    ),
    concat([
      encoder.encode(
        `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytes.length} >>\nstream\n`,
      ),
      bytes,
      encoder.encode("\nendstream\nendobj\n"),
    ]),
    concat([
      encoder.encode(`5 0 obj\n<< /Length ${contentBytes.length} >>\nstream\n`),
      contentBytes,
      encoder.encode("\nendstream\nendobj\n"),
    ]),
  ];

  // The second line is the conventional "this file is binary" marker.
  const header = concat([encoder.encode("%PDF-1.4\n%"), new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3]), encoder.encode("\n")]);
  const offsets: number[] = [];
  let position = header.length;
  for (const obj of objects) {
    offsets.push(position);
    position += obj.length;
  }
  const xrefOffset = position;

  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return concat([header, ...objects, encoder.encode(xref + trailer)]);
}

function concat(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
