const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('./api/generate-narration');
const { BASIC_NARRATION_PROMPT, OUTPUT_FORMAT } = require('./api/narration-prompt');

test('preview returns assembled system message without network or personal data; production rejects', async () => {
  const oldFetch = global.fetch;
  const oldEnv = process.env.VERCEL_ENV;
  global.fetch = () => { throw new Error('Network must not be called'); };
  try {
    const invoke = async model => {
      const req = { method: 'POST', url: '/api/generate-narration?previewPrompt=1', body: { model, prompt: JSON.stringify({ season: 'summer', hearingSheet: { name: 'PRIVATE_TEST_NAME' }, selectedLibraryStyleReferences: [] }) } };
      const res = { setHeader() {}, end(text) { this.body = JSON.parse(text); } };
      await handler(req, res);
      return res;
    };
    process.env.VERCEL_ENV = 'preview';
    for (const model of ['gpt-5.1', 'gpt-4o']) {
      const res = await invoke(model);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.generated, false);
      assert.deepEqual(res.body.systemMessages, [{ role: 'system', content: BASIC_NARRATION_PROMPT + '\n\n' + OUTPUT_FORMAT }]);
      assert.ok(!JSON.stringify(res.body).includes('PRIVATE_TEST_NAME'));
    }
    process.env.VERCEL_ENV = 'production';
    assert.equal((await invoke('gpt-5.1')).statusCode, 404);
  } finally {
    global.fetch = oldFetch;
    if (oldEnv === undefined) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = oldEnv;
  }
});
