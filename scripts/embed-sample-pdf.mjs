#!/usr/bin/env node
// Regenerates src/samplePdf.ts from assets/sample-handwriting.pdf.
//
// That PDF is the handwritten sample page as it comes out of the real capture
// pipeline, so the sample note's attachment is shaped exactly like a genuine
// delivery: the page box is the image itself (no added margin) and the embedded
// JPEG is the borderless crop.
//
// NOTE: the web and mobile onboarding still ship an older, bordered crop of the
// same page (apps/web/public/sample-handwriting.jpg and
// apps/mobile-app/assets/images/sample-handwriting.jpg in the monorepo). Those
// were deliberately left alone; refresh them from this PDF when convenient.
//
// Run this after replacing the PDF:
//   node scripts/embed-sample-pdf.mjs
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pdf = readFileSync(resolve(root, 'assets/sample-handwriting.pdf'));
const b64 = pdf.toString('base64');

const out = `// GENERATED FILE — do not edit by hand.
// Source: assets/sample-handwriting.pdf (the handwritten sample page).
// Regenerate with: node scripts/embed-sample-pdf.mjs

/** The handwritten sample page as a single-page PDF, base64-encoded (${(pdf.length / 1024).toFixed(0)} KB). */
export const SAMPLE_PDF_BASE64 =
  "${b64}";
`;
writeFileSync(resolve(root, 'src/samplePdf.ts'), out);
console.log(`wrote src/samplePdf.ts (${(b64.length / 1024).toFixed(0)} KB base64)`);
