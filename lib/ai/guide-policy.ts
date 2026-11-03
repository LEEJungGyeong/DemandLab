// Remove only explicit prohibitions attached directly to a matched action.
// Other actions in the same sentence remain subject to validation.
const hazard = '(?:침수(?:\\s*(?:시험|테스트))?|물에\\s*담그|분해|불에\\s*넣|화염|불꽃|전자레인지|고전압)';
const prohibition = '(?:(?:를|을|는|은|에)?\\s*(?:노출하|가열하|사용하|넣|하|시키)?지\\s*(?:마(?:세요|십시오|시오|라)|말(?:고|아야)|않(?:도록|습니다|고|는다|아야|기))|(?:를|을|는|은)?\\s*(?:금지|피하))';
const explicitHazardProhibition = new RegExp(hazard + prohibition, 'g');
const englishProhibition = /(?:do not|don't|never|avoid)\s+(?:disassembl\w*|submerg\w*|immersion|microwav\w*)/gi;
const explicitBiasProhibition = new RegExp(
  '(?:긍정(?:적)?으로\\s*(?:작성|표현|강조)|좋은\\s*점만\\s*(?:쓰|작성하|언급하)|단점(?:은|을)\\s*(?:숨기|제외하|언급하지)|부정적(?:인)?\\s*내용(?:을|은)?\\s*(?:제외하|삭제하))' +
  '(?:하)?지\\s*(?:마(?:세요|십시오|시오|라)|말(?:고|아야)|않(?:도록|습니다|고|는다|아야|기))', 'g');

export function guidePolicyViolation(text: string): 'unsafe' | 'biased' | undefined {
  const remaining = text.replace(explicitHazardProhibition, ' [금지 안내] ')
    .replace(englishProhibition, ' [금지 안내] ').replace(explicitBiasProhibition, ' [금지 안내] ');
  if (/침수|물에\s*담그|분해|불에\s*넣|화염|불꽃|전자레인지|고전압|immersion|submerge|disassembl|microwave|high voltage/i.test(remaining)) return 'unsafe';
  if (/긍정(?:적)?으로\s*(?:작성|표현|강조)|좋은\s*점만|단점(?:은|을).{0,8}(?:쓰지|숨기|제외|언급하지)|부정적(?:인)?\s*내용.*(?:제외|삭제)/.test(remaining)) return 'biased';
  return undefined;
}
