
import type { Review, ColumnMapping } from './types';

export function sponsored(text: string): boolean {
  return /쿠팡\s*체험단|상품을\s*무료로\s*제공받|무료\s*제공.*구매후기/.test(text);
}

export function normalizeReviews(
  rows: string[][],
  mapping: ColumnMapping
): { reviews: Review[]; skipped: number } {
  const seen = new Set<string>();
  const reviews: Review[] = [];
  let skipped = 0;

  for (const row of rows.slice(1)) {
    const text = (row[mapping.text] || '').trim();

    if (!text || seen.has(text)) {
      skipped++;
      continue;
    }

    seen.add(text);

    reviews.push({
      id: reviews.length,
      text,
      rating: row[mapping.rating] || '',
      date: row[mapping.date] || '',
      option: row[mapping.option] || '',
      sponsored: sponsored(text),
    });
  }

  return { reviews, skipped };
}
