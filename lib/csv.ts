
export function parseCSV(s: string): string[][] {
  s = s.replace(/^\uFEFF/, '');

  const delim = s.split('\n')[0].includes('\t')
    ? '\t'
    : ',';

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < s.length; i++) {
    const c = s[i];

    if (c === '"') {
      if (quoted && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        quoted = !quoted;
      }
    } else if (c === delim && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((c === '\n' || c === '\r') && !quoted) {
      if (c === '\r' && s[i + 1] === '\n') i++;

      row.push(cell);

      if (row.some(v => v.trim())) rows.push(row);

      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }

  if (quoted) {
    throw Error('따옴표가 닫히지 않은 CSV입니다.');
  }

  row.push(cell);

  if (row.some(v => v.trim())) rows.push(row);

  return rows;
}
