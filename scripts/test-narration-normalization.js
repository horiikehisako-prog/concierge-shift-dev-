const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = `${fs.readFileSync("api/generate-narration.js", "utf8")}
this.testHelpers = { normalizeQuotationContext, pickMemoryCards, extractStyleReferenceSection, narrationSentenceCount };`;
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

const familyNear = context.testHelpers.normalizeQuotationContext({
  openingNarration: [
    "いつも笑顔が身近にありました。歌ったり、踊ったりされる澄子様のお姿を、ご家族は愛らしく感じておられました。",
    "歌ったり、踊ったりされることもあり、そのお姿を可愛いと感じられることがありました。",
    "歌ったり、踊ったりされるお姿は、ご家族に愛らしく感じられていたとうかがっております。",
    "歌われることがあり、踊られることもありました。そのお姿を、ご家族は愛らしく感じておられました。",
    "いつも笑顔が身近にあった澄子様。歌われたり、踊られたりするお姿は、愛らしく受けとめられていました。ご家族との間に浮かぶ最初の記憶として、その表情と動きが残されております。",
    "歌に声を重ね、踊りに身体を動かされるお姿を、ご家族は愛らしく感じておられました。",
    "歌を歌われ、踊られるお姿もありました。そのお姿を、ご家族は愛らしく感じておられたとのことです。",
    "手芸に親しみ、野菜やお花を育てることも、澄子様の暮らしの中にございました。",
    "編み物を楽しまれていました。庭の草花を育てておられました。手を使うこと、草花に向き合うことが、澄子様の暮らしの中にございました。",
    "育つ様子を見ておられる澄子様でございました。",
    "編み物を楽しみ、手を動かして形にしておられました。庭の草花にも手をかけ、育つ様子を見ておられました。",
    "人と接することを好まれ、思い立つとすぐに行動へ移される方でいらっしゃいました。人と言葉を交わすことも、澄子様の過ごし方の中にありました。",
    "人と接することを好まれました。思い立つとすぐに行動へ移されることもございました。",
    "人と接することを好まれ、朗らかに過ごされました。思い立つと、すぐに行動へ移されました。",
    "家族を大切にされていた澄子様は、よく「人を悪く言わないでいよう」と話しておられました。",
    "人と接することがお好きで、思い立つとすぐに行動へ移しておられました。朗らかに人と関わられ、よく「人を悪く言わないでいよう」と話しておられました。",
    "ご家族とともに過ごされた場面に、澄子様の声や動きが思い出されます。",
    "よく笑っておられたお顔、歌や踊り、手芸、野菜やお花を育てる日々。",
    "その折々のお姿を思い返しながら、今日までの歩みに、深い感謝をお寄せのことと存じます。",
    "これまでの日々にいただいたものへ、深く感謝を捧げます。",
    "ご家族を大切にしてこられた澄子様。その歩みを前に、言葉にならないほどの感謝があふれてまいります。",
    "澄子様と過ごされた一つひとつに、今、ありがとうの思いが寄せられております。",
  ].join("\n"),
  closingNarration: [
    "その行き先の名とともに、澄子様を囲んだひとときが思い起こされます。",
    "その朗らかさを忘れずにいたい。ご家族のお気持ちは、今、その言葉に静かに重なっております。",
    "その折々を思い返しながら、澄子様の朗らかさを忘れずにいたいというお気持ちが、今、静かに残されております。",
    "そのご旅行のことを思いながら、私も澄子様を見習い、明るく前向きに歩んでいきたいというお気持ちが残されております。",
    "その行き先の名とともに、澄子様と過ごされたひとときが残されております。",
    "その朗らかさを忘れずにいたいという思いを、今、静かに抱いておられます。",
    "行き先の名と、九月という月が、あの時のことを静かに伝えてまいります。",
    "その朗らかさを忘れずにいたいというご家族のお気持ちが、今、残されております。",
    "行き先の名をたどると、九月に出かけられたことが思い起こされます。",
    "その朗らかさを忘れずにいたい。ご家族には、そのお気持ちがございます。",
    "松江、高松、熊本という行き先の名と、九月という月が、ひとつの思い出として残ります。",
    "その朗らかさを忘れずにいたいという思いが、ご家族の中に残されております。",
    "松江、高松、熊本へと向かわれた九月の旅行。その一つひとつの行き先が、親子三代で過ごされた時をたどらせてくれます。",
    "その朗らかさを忘れずにいたいという思いが、ご家族の中に残されています。",
    "親子三代で、松江、高松、熊本へ旅行されたことがございました。いずれも誕生日月の九月であり、その行き先の名が、今もひとつずつたどられてまいります。九月に出かけた親子三代の旅行。ご家族は、澄子様のその朗らかさを忘れずにいたいと願っておられます。",
  ].join("\n"),
});
for (const banned of [
  "ご家族は愛らしく感じて",
  "感じておられたとのことです",
  "可愛いと感じられることがありました",
  "愛らしく感じられていたとうかがって",
  "歌われることがあり、踊られることもありました",
  "最初の記憶として、その表情と動き",
  "ご家族は愛らしく感じて",
  "暮らしの中にございました",
  "手を使うこと、草花に向き合うこと",
  "育つ様子を見ておられる澄子様でございました",
  "手を動かして形にしておられました",
  "過ごし方の中にありました",
  "人と接することを好まれました。思い立つと",
  "人と接することを好まれ、朗らかに過ごされました",
  "家族を大切にされていた澄子様は",
  "朗らかに人と関わられ、よく",
  "澄子様の声や動きが思い出されます",
  "よく笑っておられたお顔、歌や踊り、手芸",
  "ありがとうの思いが寄せられて",
  "深い感謝をお寄せのことと存じます",
  "深く感謝を捧げます",
  "言葉にならないほどの感謝があふれて",
  "澄子様を囲んだひととき",
  "その言葉に静かに重なって",
  "お気持ちが、今、静かに残されて",
  "私も澄子様を見習い",
  "澄子様と過ごされたひとときが残されて",
  "思いを、今、静かに抱いて",
  "あの時のことを静かに伝えて",
  "ご家族のお気持ちが、今、残されて",
  "九月に出かけられたことが思い起こされます",
  "ご家族には、そのお気持ちがございます",
  "ひとつの思い出として残ります",
  "ご家族の中に残されて",
  "親子三代で過ごされた時をたどらせて",
  "九月に出かけた親子三代の旅行",
]) {
  assert.equal(
    `${familyNear.openingNarration}\n${familyNear.closingNarration}`.includes(banned),
    false,
    `family-distance phrase remained: ${banned}`,
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

const smilingPlan = context.testHelpers.pickMemoryCards({
  familyMemories: "いつも笑顔が身近にあった。歌ったり踊ったりする姿を家族は愛らしく感じていた。",
  memorableEvents: "親子三代で旅行した。",
  favoritePhrases: "「人を悪く言わないでいよう」とよく言っていた。",
  hobbies: "編み物を楽しみ、庭の草花を育てていた。",
  personality: "朗らかで、人と接することが好きだった。思い立つとすぐに行動へ移した。",
  valuedThings: "家族を大切にしていた。",
  familyFeelings: "その朗らかさを忘れずにいたい。",
});
assert.equal(
  smilingPlan.opening.supports.some(card => card.field === "personality"),
  true,
);
assert.deepEqual(
  Array.from(
    smilingPlan.opening.supports.find(card => card.field === "personality")
      .doNotRepeatTopics,
  ),
  ["smile"],
);
assert.equal(
  smilingPlan.opening.supports.some(card => card.field === "valuedThings"),
  true,
);

const markdownReference = [
  "# 教科書",
  "### 【開式前ナレーション】",
  "一文目です。",
  "二文目です。",
  "### 【閉式後ナレーション】",
  "閉式後です。",
].join("\n\n");
const openingReference = context.testHelpers.extractStyleReferenceSection(
  markdownReference,
  "opening",
);
assert.equal(openingReference.includes("閉式後です"), false);
assert.equal(context.testHelpers.narrationSentenceCount(openingReference), 2);

console.log("narration normalization tests passed");
