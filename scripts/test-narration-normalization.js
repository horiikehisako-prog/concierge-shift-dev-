const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = `${fs.readFileSync("api/generate-narration.js", "utf8")}
this.testHelpers = { normalizeQuotationContext, pickMemoryCards };`;
const context = {
  module: { exports: {} },
  exports: {},
  require,
  process,
  console,
  fetch,
  Buffer,
  setTimeout,
  clearTimeout,
  AbortController,
};
vm.createContext(context);
vm.runInContext(source, context);

const draft = {
  openingNarration: [
    "ゴルフへ出かけられる朝には、支度を一つひとつ整えておられた正雄様。",
    "お帰りになったあとは、居間で静かに過ごされることもあり、その穏やかな佇まいが思い起こされます。",
    "同じ食卓を囲むひとときを大切にされ、いつもの席におられる正雄様を囲んで、食事の時間が流れてまいりました。",
    "ここに集う思いは、正雄様と過ごした一つひとつの場面へと向かっております。",
  ].join("\n"),
  closingNarration: [
    "お帰りの時には外まで見送り、その姿を最後まで見届けておられたこともありました。",
    "そのお気持ちとともに、正雄様をお見送りいたします。",
  ].join("\n"),
};
const cleaned = context.testHelpers.normalizeQuotationContext(draft);
for (const banned of [
  "一つひとつ整えて",
  "穏やかな佇まい",
  "いつもの席",
  "時間が流れて",
  "ここに集う思い",
  "最後まで見届けて",
  "お見送りいたします",
]) {
  assert.equal(
    `${cleaned.openingNarration}\n${cleaned.closingNarration}`.includes(banned),
    false,
    `residual phrase: ${banned}`,
  );
}

const plan = context.testHelpers.pickMemoryCards({
  familyMemories: "旅から帰ると家族に出来事を話した。",
  memorableEvents: "商店と地域のボランティアに出かけた。",
  hobbies: "旅行とカラオケが好きで、犬や猫を見ると足を止めた。",
  familyFeelings: "その姿を忘れずにいたい。",
});
assert.deepEqual(
  Array.from(plan.opening.supports[0].doNotRepeatTopics),
  ["travel"],
);
assert.equal(plan.opening.supports[0].text.includes("カラオケ"), true);

console.log("narration normalization tests passed");
