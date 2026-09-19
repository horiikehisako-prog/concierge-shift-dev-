const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = vm.createContext({ module: { exports: {} } });
vm.runInContext(fs.readFileSync(path.join(__dirname, 'api/generate-narration.js'), 'utf8') + '\nthis.applyRule = applyNameRule; this.strip = stripNonNarrationSections;', context);
const prompt = JSON.stringify({ hearingSheet: { deceasedName: '堀池　チエノ', narrationName: 'チエノ' } });

test('first mention and final lines use the full name with deceased prefix', () => {
  const result = context.applyRule({ openingNarration: 'チエノ様とのお別れです。堀池チエノ様は歌がお好きでした。', closingNarration: '故 チエノ様を偲びます。' }, prompt);
  assert.equal(result.openingNarration, '故 堀池　チエノ様とのお別れです。チエノ様は歌がお好きでした。');
  assert.ok(result.closingNarration.startsWith('チエノ様を偲びます。'));
  assert.equal(result.closingNarration.split('故 堀池　チエノ様').length - 1, 2);
  assert.deepEqual(context.applyRule(result, prompt), result);
});
test('existing prefix is not duplicated', () => {
  const prefixed = JSON.stringify({ hearingSheet: { deceasedName: '故 堀池　チエノ様', narrationName: 'チエノ' } });
  const result = context.applyRule({ openingNarration: '故 堀池　チエノ様とのお別れです。', closingNarration: 'チエノ様を偲びます。' }, prefixed);
  assert.equal(result.openingNarration, '故 堀池　チエノ様とのお別れです。');
  assert.ok(!result.closingNarration.includes('故 故'));
});
test('space entities do not remain in narration', () => {
  assert.equal(context.strip('文章です。 &#x20;\n次の文章。'), '文章です。  \n次の文章。');
});
