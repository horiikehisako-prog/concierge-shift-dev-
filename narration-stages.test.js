const test=require('node:test');
const assert=require('node:assert/strict');
const {sectionMessages,validateFacts,sign,verify,handleStages}=require('./api/narration-stages');
const plan={confirmed:true,common:{deceasedName:'TEST'},season:'SUMMER_ONLY',facts:[{id:'a',destination:'opening',quotes:[{text:'OPEN_ONLY'}]},{id:'b',destination:'closing',quotes:[{text:'CLOSE_ONLY'}]},{id:'c',destination:'unused',quotes:[{text:'UNUSED'}]}]};
test('section payloads are isolated and unconfirmed generation is refused',()=>{
  const open=sectionMessages(plan,'opening')[1].content;
  const close=sectionMessages(plan,'closing')[1].content;
  assert.ok(open.includes('OPEN_ONLY')&&open.includes('SUMMER_ONLY'));
  assert.ok(!open.includes('CLOSE_ONLY')&&!open.includes('UNUSED'));
  assert.ok(close.includes('CLOSE_ONLY'));
  assert.ok(!close.includes('OPEN_ONLY')&&!close.includes('SUMMER_ONLY')&&!close.includes('UNUSED'));
  assert.throws(()=>sectionMessages({...plan,confirmed:false},'opening'));
});
test('quotes must exist verbatim in questionnaire, duplicates are rejected',()=>{
  const fact={quotes:[{field:'hobbies',text:'flowers'}],destination:'opening'};
  assert.equal(validateFacts([fact],{hobbies:'flowers and crafts'}).length,1);
  assert.throws(()=>validateFacts([fact],{hobbies:'crafts'}));
  assert.throws(()=>validateFacts([fact,fact],{hobbies:'flowers'}));
});
test('confirmation tokens cannot be changed',()=>{
  const token=sign(plan,'test-key');
  assert.equal(verify(token,'test-key').common.deceasedName,'TEST');
  assert.throws(()=>verify(token+'0','test-key'));
});
test('production endpoint rejects without AI call',async()=>{
  const env=process.env.VERCEL_ENV;
  process.env.VERCEL_ENV='production';
  try{
    const res={setHeader(){},end(){}};
    await handleStages({},res,{action:'extract'});
    assert.equal(res.statusCode,404);
  }finally{if(env===undefined) delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=env;}
});
