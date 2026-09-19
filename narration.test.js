const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const formatter = source.slice(source.indexOf('const compassFormatDraft='), source.indexOf('const compassFirstFilled='));
const generator = source.slice(source.indexOf('const compassGenerateNarration=async'), source.indexOf('function CompassAISettingsEditor'));
function makeGenerate(fetch) {
  const context = vm.createContext({
    fetch,
    clean: value => String(value || '').trim(),
    normalizeAISettings: () => ({}),
    resolveCompassApiProxyPath: () => '/api/generate-narration',
    DEFAULT_AI_SETTINGS: { model: 'test-model', temperature: 0, maxTokens: 100 },
  });
  vm.runInContext(formatter + generator + ';this.generate = compassGenerateNarration;', context);
  return () => context.generate({ cfg: {}, prompt: 'Test only' });
}
const response = (status, data) => async () => ({ status, ok: status === 200, json: async () => data });

for (const status of [401, 429, 500, 501, 503]) {
  test(`HTTP ${status} rejects instead of returning a replacement draft`, async () => {
    await assert.rejects(makeGenerate(response(status, {}))());
  });
}
test('network failure rejects', async () => {
  await assert.rejects(makeGenerate(async () => { throw new Error('Offline'); })(), /Offline/);
});
for (const data of [null, {}, { openingNarration: 'Only opening' }, { closingNarration: 'Only closing' }]) {
  test(`incomplete success payload is rejected: ${JSON.stringify(data)}`, async () => {
    await assert.rejects(makeGenerate(response(200, data))());
  });
}
test('HTML response is rejected even with HTTP 200', async () => {
  await assert.rejects(makeGenerate(async () => ({ status: 200, ok: true, json: async () => { throw new Error('HTML'); } }))());
});
test('complete AI response is preserved', async () => {
  const draft = await makeGenerate(response(200, { openingNarration: 'Opening.', closingNarration: 'Closing.' }))();
  assert.equal(draft.openingNarration, 'Opening.');
  assert.equal(draft.closingNarration, 'Closing.');
  assert.equal(draft.generationSource, 'openai');
});
