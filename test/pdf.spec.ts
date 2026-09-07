import { describe, it, expect } from 'vitest';
import { jpegToPdf } from '../src/pdf';

/** One char per byte, so string indices equal byte offsets. */
const decoder = { decode: (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('') };

/** Fake JPEG payload: SOI marker, some binary junk (incl. newlines and "%"), EOI marker. */
function fakeJpeg(len = 300): Uint8Array {
  const b = new Uint8Array(len);
  b[0] = 0xff; b[1] = 0xd8;
  for (let i = 2; i < len - 2; i++) b[i] = (i * 37 + 11) & 0xff;
  b[len - 2] = 0xff; b[len - 1] = 0xd9;
  return b;
}

describe('jpegToPdf', () => {
  const jpeg = fakeJpeg();
  const pdf = jpegToPdf({ bytes: jpeg, width: 640, height: 480 });
  const text = decoder.decode(pdf);

  it('produces a well-formed PDF skeleton', () => {
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.endsWith('%%EOF\n')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text).toContain('/Kids [3 0 R] /Count 1');
    expect(text).toContain('/MediaBox [0 0 640 480]');
    expect(text).toContain('/Filter /DCTDecode');
    expect(text).toContain('/Width 640 /Height 480');
    expect(text).toContain('/Root 1 0 R');
  });

  it('embeds the JPEG bytes verbatim with the right stream length', () => {
    const lengthMatch = text.match(/\/Filter \/DCTDecode \/Length (\d+) >>\nstream\n/);
    expect(lengthMatch).not.toBeNull();
    expect(Number(lengthMatch![1])).toBe(jpeg.length);
    const start = lengthMatch!.index! + lengthMatch![0].length;
    expect(Array.from(pdf.slice(start, start + jpeg.length))).toEqual(Array.from(jpeg));
    expect(decoder.decode(pdf.slice(start + jpeg.length, start + jpeg.length + 10))).toBe('\nendstream');
  });

  it('writes an xref table whose offsets point at each object', () => {
    const xrefAt = text.lastIndexOf('\nxref\n') + 1;
    const startxref = Number(text.match(/startxref\n(\d+)\n%%EOF/)![1]);
    expect(startxref).toBe(xrefAt);

    const entries = text.slice(xrefAt).match(/^(\d{10}) 00000 n $/gm)!;
    expect(entries).toHaveLength(5);
    entries.forEach((entry, i) => {
      const offset = Number(entry.slice(0, 10));
      expect(decoder.decode(pdf.slice(offset, offset + 8))).toBe(`${i + 1} 0 obj\n`);
    });
  });

  it('draws the image across the whole page', () => {
    expect(text).toContain('q 640 0 0 480 0 0 cm /Im0 Do Q');
  });

  it('rejects empty or dimensionless images', () => {
    expect(() => jpegToPdf({ bytes: new Uint8Array(0), width: 10, height: 10 })).toThrow(/no data/);
    expect(() => jpegToPdf({ bytes: jpeg, width: 0, height: 10 })).toThrow(/no dimensions/);
  });
});
