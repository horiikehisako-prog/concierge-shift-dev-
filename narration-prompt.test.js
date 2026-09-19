const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { BASIC_NARRATION_PROMPT, OUTPUT_FORMAT, buildNarrationMessages } = require('./api/narration-prompt');
test('one basic prompt plus data, without extra style instructions', () => {
  const input = JSON.stringify({ hearingSheet: { hobbies: 'Reading' }, styleReferences: [] });
  const messages = buildNarrationMessages(input);
  assert.equal(messages.length, 2);
  assert.equal(messages[0].content, BASIC_NARRATION_PROMPT + '\n\n' + OUTPUT_FORMAT);
  assert.equal(messages[1].content, input);
});
test('old browser rules and dictionary cannot reintroduce instructions', () => {
  const source = fs.readFileSync(path.join(__dirname, 'api/generate-narration.js'), 'utf8');
  const context = vm.createContext({ module: { exports: {} }, require: require('node:module').createRequire(path.join(__dirname, 'api/generate-narration.js')) });
  vm.runInContext(source + ';this.compact = compactNarrationPrompt;', context);
  const result = JSON.parse(context.compact(JSON.stringify({ hearingSheet: { hobbies: 'Reading' }, writingRules: { season: 'summer', nameUsageRule: 'OLD_RULE' }, outputRules: ['OLD_RULE'], hisakoReplacementDictionary: { entries: ['OLD_RULE'] } })));
  assert.deepEqual(Object.keys(result).sort(), ['hearingSheet', 'season', 'styleReferences']);
  assert.ok(!JSON.stringify(result).includes('OLD_RULE'));
  assert.equal(result.hearingSheet.hobbies, 'Reading');
  assert.equal((source.match(/buildNarrationMessages\(prompt\)/g) || []).length, 2);
});
