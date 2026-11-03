export function parseCSV(input: string): string[][] {
  const source = input.replace(/^\uFEFF/, '');
  const delimiter = source.split('\n')[0].includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const character = source[i];
    if (character === '"') {
      if (quoted && source[i + 1] === '"') { cell += '"'; i++; }
      else quoted = !quoted;
    } else if (character === delimiter && !quoted) {
      row.push(cell); cell = '';
    } else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && source[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some(value => value.trim())) rows.push(row);
      row = []; cell = '';
    } else cell += character;
  }
  if (quoted) throw Error('따옴표가 닫히지 않은 CSV입니다.');
  row.push(cell);
  if (row.some(value => value.trim())) rows.push(row);
  return rows;
}

export async function readReviewCSV(file: File) {
  if (file.size > 5 * 1024 * 1024) throw Error('5MB 이하 CSV를 선택해 주세요.');
  const buffer = await file.arrayBuffer();
  let text = new TextDecoder().decode(buffer);
  if (text.includes('\uFFFD')) text = new TextDecoder('euc-kr').decode(buffer);
  const rows = parseCSV(text);
  if (rows.length < 2) throw Error('열 이름과 리뷰가 포함된 CSV가 필요합니다.');
  const find = (pattern: RegExp) => rows[0].findIndex(header => pattern.test(header));
  return { rows, mapping: {
    text: Math.max(0, find(/본문|내용|리뷰|text|content|review/i)),
    rating: find(/별점|평점|rating|score/i),
    date: find(/날짜|작성일|date/i), option: find(/옵션|option/i),
  } };
}
