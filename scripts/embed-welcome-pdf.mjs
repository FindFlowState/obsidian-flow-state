#!/usr/bin/env node
// Regenerates src/welcomePdf.ts from assets/welcome-sample.pdf.
// Run this after replacing the sample PDF (e.g. with a real handwritten scan):
//   node scripts/embed-welcome-pdf.mjs
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pdf = readFileSync(resolve(root, 'assets/welcome-sample.pdf'));
const b64 = pdf.toString('base64');

const out = `// GENERATED FILE — do not edit by hand.
// Source: assets/welcome-sample.pdf (the handwritten welcome letter).
// Regenerate with: node scripts/embed-welcome-pdf.mjs

/** The handwritten welcome letter, base64-encoded (${(pdf.length / 1024).toFixed(0)} KB PDF). */
export const WELCOME_PDF_BASE64 =
  "${b64}";
`;
writeFileSync(resolve(root, 'src/welcomePdf.ts'), out);
console.log(`wrote src/welcomePdf.ts (${(b64.length / 1024).toFixed(0)} KB base64)`);
