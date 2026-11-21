/**
 * Shared ISBN normalization & equivalence utilities for QIVORA.
 * Ensures every ISBN stored, queried, scanned, issued, or returned uses consistent
 * normalized values (only 0-9 and uppercase X, no hyphens or spaces).
 */

export function normalizeIsbn(raw: string | null | undefined): string {
  if (!raw) return '';
  return String(raw).replace(/[^0-9Xx]/g, '').toUpperCase();
}

export function isLikelyIsbn(raw: string | null | undefined): boolean {
  const norm = normalizeIsbn(raw);
  return /^(\d{9}[\dX]|\d{13})$/.test(norm);
}

export function isbn10To13(raw: string): string | null {
  const norm = normalizeIsbn(raw);
  if (!/^\d{9}[\dX]$/.test(norm)) return null;
  const core = `978${norm.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = Number(core[i]);
    sum += i % 2 === 0 ? digit : digit * 3;
  }
  const check = (10 - (sum % 10)) % 10;
  return `${core}${check}`;
}

export function isbn13To10(raw: string): string | null {
  const norm = normalizeIsbn(raw);
  if (!/^978\d{10}$/.test(norm)) return null;
  const core = norm.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(core[i]) * (10 - i);
  }
  const remainder = (11 - (sum % 11)) % 11;
  const check = remainder === 10 ? 'X' : String(remainder);
  return `${core}${check}`;
}

/**
 * Returns all normalized ISBN variants (e.g. both ISBN-13 and ISBN-10 equivalents)
 * so lookups succeed regardless of whether a book was saved as ISBN-10 or ISBN-13.
 */
export function getIsbnLookupCandidates(raw: string | null | undefined): string[] {
  const norm = normalizeIsbn(raw);
  if (!norm) return [];
  const candidates = new Set<string>([norm]);
  if (norm.length === 10) {
    const as13 = isbn10To13(norm);
    if (as13) candidates.add(as13);
  } else if (norm.length === 13) {
    const as10 = isbn13To10(norm);
    if (as10) candidates.add(as10);
  }
  return Array.from(candidates);
}

/**
 * Client-side helper to check if a stored ISBN matches a user search query
 * regardless of hyphens, spaces, or casing.
 */
export function matchesIsbnSearch(storedIsbn: string | null | undefined, query: string): boolean {
  if (!storedIsbn) return false;
  const qNorm = normalizeIsbn(query);
  if (qNorm.length < 3) return false;
  const storedNorm = normalizeIsbn(storedIsbn);
  if (storedNorm.includes(qNorm)) return true;
  const candidates = getIsbnLookupCandidates(qNorm);
  return candidates.some((c) => storedNorm === c || storedNorm.includes(c));
}
