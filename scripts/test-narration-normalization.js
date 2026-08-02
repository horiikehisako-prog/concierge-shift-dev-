const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = `${fs.readFileSync("api/generate-narration.js", "utf8")}
this.testHelpers = { normalizeQuotationContext, normalizeFamilyNearNarration, buildStableFamilyPortrait, qualityCheckNarration, narrationCandidateScore, pickMemoryCards, staffSelectedMemoryPlan, compactNarrationPrompt, extractStyleReferenceSection, narrationSentenceCount, applyNameRule, closingStartsWithSeasonalLanguage };`;
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

const chienoPrompt = JSON.stringify({
  hearingSheet: {
    fullName: "堀池 チエノ",
    narrationName: "チエノ",
    age: "91",
  },
});
const chienoFamilyNear = context.testHelpers.normalizeFamilyNearNarration({
  openingNarration: [
    "チエノ様を思うと、いつも笑っておられたお顔が浮かびます。笑っているお顔しか思い出せないほど、よく笑っておられた方でした。そのお顔が、ご家族の記憶に残っています。",
    "歌をうたわれることがありました。踊られることもあり、そのお姿はいつも可愛いと感じられていた記憶として残っています。",
    "手芸では、手を動かして形にしておられました。野菜を育て、お花にも手をかけておられたチエノ様。",
    "ご家族を大切にしてこられたことも、チエノ様をたどるうえで欠かせない記憶でございます。",
  ].join("\n\n"),
  closingNarration: [
    "親子三代で、六甲、小倉、下関、博多へご旅行に行かれました。どのご旅行も、お誕生日月である十月に行かれたものでした。",
    "行き先の名をたどると、十月のご旅行が思い起こされます。私も彼女を見習い、明るく前向きに歩んでいきたいというお気持ちが残されています。",
  ].join("\n\n"),
}, chienoPrompt);
const chienoFull = `${chienoFamilyNear.openingNarration}\n${chienoFamilyNear.closingNarration}`;
for (const banned of [
  "笑っているお顔しか思い出せないほど、よく笑っておられた方でした",
  "可愛いと感じられていた記憶として",
  "手を動かして形にしておられました",
  "をたどるうえで欠かせない記憶",
  "ご旅行に行かれました",
  "行き先の名をたどると",
  "私も彼女",
]) {
  assert.equal(chienoFull.includes(banned), false, `latest awkward phrase remained: ${banned}`);
}
assert.equal(chienoFamilyNear.closingNarration.includes("チエノ様のように"), true);

const chienoLatest = context.testHelpers.normalizeFamilyNearNarration({
  openingNarration: [
    "チエノ様を思うと、いつも笑っておられたお顔が浮かびます。笑っているお顔しか思い出せないほど、よく笑っておられた方でございました。そのお顔は、ご家族の記憶に残っています。",
    "歌われることがありました。踊られることもあり、そのご様子は、いつも可愛らしいものとして残されています。",
    "手芸では、手を動かして形にしてこられました。野菜には手をかけて育てておられました。お花にも手をかけて育ててこられたチエノ様。手芸に向かう手元も、野菜やお花に手をかけるお姿も、今では懐かしい場面でございます。",
    "ご家族を大切にしてこられました。折に触れて、「人の悪口を言ってはいけない」と話しておられました。",
    "チエノ様とともに過ごしてこられたことへ、感謝の思いが寄せられます。",
    "尽きることのない感謝の思いを胸に、まもなく開式のお時間でございます。",
  ].join("\n\n"),
  closingNarration: [
    "親子三代で、六甲へ出かけられました。小倉、下関、博多へも、ご一緒に旅行をされました。いずれも、お誕生日月である十月に行かれたものでございます。",
    "六甲、小倉、下関、博多という行き先が、チエノ様とのご旅行を思い起こさせます。私も彼女を見習い、明るく前向きに歩んでいきたい、というお気持ちが残されています。",
  ].join("\n\n"),
}, chienoPrompt);
const chienoLatestFull = `${chienoLatest.openingNarration}\n${chienoLatest.closingNarration}`;
for (const banned of [
  "よく笑っておられた方でございました",
  "そのお顔は、ご家族の記憶に残っています",
  "歌われることがありました。踊られることもあり",
  "野菜には手をかけて育てておられました。お花にも",
  "感謝の思いが寄せられます。\n\n尽きることのない感謝",
  "私も彼女",
  "ご一緒に旅行をされました",
  "という行き先が",
]) {
  assert.equal(chienoLatestFull.includes(banned), false, `newest awkward phrase remained: ${banned}`);
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
assert.equal(smilingPlan.opening.maximumFacts, 3);
assert.equal(1 + smilingPlan.opening.supports.length <= 3, true);
assert.equal(smilingPlan.opening.supports.some(card => card.field === "favoritePhrases"), true);
assert.equal(smilingPlan.opening.supports.some(card => card.field === "hobbies"), true);

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

const studioOutputRegression = context.testHelpers.normalizeFamilyNearNarration({
  openingNarration: [
    "夏の光が、まぶしく降りそそいでおります。",
    "故堀池 チエノ様は、91年という尊いご生涯を閉じ、静かに人生の幕を下ろされました。",
    "チエノ様を思うと、まず浮かぶのは、よく笑っておられたお顔です。いつも笑っているお顔しか思い出せないほど、その表情はご家族の記憶に残っています。",
    "歌を歌われることがありました。踊られることもあり、そのご様子は、いつも可愛いものとして残されています。",
    "手芸では、手を動かして形にしておられました。野菜を育て、お花にも手をかけてこられた日々がございます。手芸に向かわれる手元も、野菜やお花に手をかけられるお姿も、今は懐かしく思い返されます。",
    "ご家族を大切にしておられたチエノ様。折に触れて、「人の悪口を言ってはいけない」と話しておられました。",
    "よく笑っておられたお顔から、歌や踊り、手芸、野菜やお花へと、チエノ様との記憶はそれぞれの場面に残されています。",
  ].join("\n\n"),
  closingNarration: [
    "十月のお誕生日月には、親子三代で出かけられました。六甲へ、小倉へ、下関へ、博多へと向かわれたことがございました。",
    "その行き先の名は、チエノ様とともに出かけられた思い出として残っています。私も彼女を見習い、明るく前向きに歩んでいきたい、というご家族のお気持ちでございます。",
  ].join("\n\n"),
}, chienoPrompt);
const studioOutputFull = `${studioOutputRegression.openingNarration}\n${studioOutputRegression.closingNarration}`;
for (const banned of [
  "まず浮かぶのは、よく笑っておられたお顔です",
  "歌を歌われることがありました",
  "手芸では、手を動かして形にしておられました",
  "ご家族を大切にしておられたチエノ様。",
  "よく笑っておられたお顔から、歌や踊り、手芸",
  "その行き先の名は",
  "私も彼女",
  "というご家族のお気持ちでございます",
]) {
  assert.equal(studioOutputFull.includes(banned), false, `studio regression remained: ${banned}`);
}
assert.equal(studioOutputRegression.openingNarration.includes("「いつも笑っている顔しか思い出せない」とご家族が語られるほど、日々のそばにはチエノ様の笑顔がありました。"), true);
assert.equal(studioOutputRegression.closingNarration.includes("親子三代で六甲、小倉、下関、博多へ出かけられました。"), true);

const staleProductionDraft = {
  openingNarration: [
    "夏の光が、庭先にも濃く注ぐ頃でございます。",
    "故堀池 チエノ様は、91年という尊いご生涯を閉じ、静かに人生の幕を下ろされました。",
    "チエノ様といえば、いつも笑っておられるお顔が思い浮かびます。よく笑われるその表情ばかりが思い出されるほど、そのお顔は近くにありました。その笑顔も、ご家族の記憶に残っています。",
    "歌を歌われることがありました。踊られることもあり、そのご様子はいつも可愛らしいものでした。声を重ね、身体を動かされるお姿も、チエノ様を思う場面の一つです。",
    "手芸では、手を動かして形にしておられました。野菜には手をかけて育てておられました。お花にも手をかけて育てておられました。手芸に向かう手元も、野菜やお花に手をかけるお姿も、今では懐かしく思い出されます。",
    "ご家族を大切にされていたチエノ様。折に触れて、「人の悪口を言ってはいけない」と話しておられました。",
    "尽きることのない感謝の思いを胸に、まもなく開式のお時間でございます。",
  ].join("\n\n"),
  closingNarration: [
    "お誕生日月の十月には、親子三代で旅行に行かれました。六甲へ行かれました。小倉へも行かれ、下関、博多へも足を運ばれました。十月に出かけられたそれぞれの旅は、親子三代で過ごされた思い出として残されています。チエノ様のように、明るく前向きでありたい。そのお気持ちが、これからの日々へと続いてまいります。",
  ].join("\n\n"),
};
const staleProductionCheck = context.testHelpers.qualityCheckNarration(staleProductionDraft, chienoPrompt);
assert.equal(staleProductionCheck.ok, false);
assert.equal(staleProductionCheck.failures.includes("excessive trait repetition"), true);
assert.equal(staleProductionCheck.failures.includes("repetitive past endings"), true);
assert.equal(context.testHelpers.narrationCandidateScore(staleProductionDraft, chienoPrompt).score >= 2000, true);

const latestShortDraft = {
  openingNarration: [
    "蝉の声が響く夏の日でございます。",
    "故堀池 チエノ様は、91年という尊いご生涯を閉じ、静かに人生の幕を下ろされました。",
    "チエノ様を思うと、いつも笑っておられたお顔が浮かびます。ほかのお顔を思い出せないほど、よく笑っておられた方でした。その表情は、ご家族の記憶に残っています。",
    "歌を歌われることがありました。踊られることもあり、そのお姿を可愛いと感じておられた記憶が残されています。声を重ね、身体を動かされるチエノ様。そこで浮かぶお姿も、ご家族の記憶の中にあります。",
    "手芸では、手を動かして形にしておられました。野菜を育て、お花にも手をかけてこられた日々がありました。手芸に向かう手元も、野菜やお花に手をかけるお姿も、今では懐かしい場面です。",
    "ご家族を大切にしておられたチエノ様。折に触れて、「人の悪口を言ってはいけない」と話しておられました。",
    "尽きることのない感謝の思いを胸に、まもなく開式のお時間でございます。",
  ].join("\n\n"),
  closingNarration: [
    "親子三代で、六甲、小倉、下関、博多へ旅へ出かけられました。いずれも、お誕生日月である十月のご旅行でした。訪れた地名と十月という月が、これからもご家族の中に残ってまいります。私も彼女を見習い、明るく前向きに歩んでいきたい、という思いが寄せられています。",
  ].join("\n\n"),
};
const latestShortCheck = context.testHelpers.qualityCheckNarration(latestShortDraft, chienoPrompt);
assert.equal(latestShortCheck.ok, false);
assert.equal(latestShortCheck.failures.includes("invented family feeling"), true);
const tinyCheck = context.testHelpers.qualityCheckNarration({
  openingNarration: "蝉の声が響く季節です。\n故堀池 チエノ様は、91年という尊いご生涯を閉じ、静かに人生の幕を下ろされました。\n尽きることのない感謝の思いを胸に、まもなく開式のお時間でございます。",
  closingNarration: "旅行を楽しまれました。",
}, chienoPrompt);
assert.equal(tinyCheck.failures.includes("opening too short"), true);
assert.equal(tinyCheck.failures.includes("closing too short"), true);

const duplicatedIntroDraft = context.testHelpers.applyNameRule({
  openingNarration: [
    "夏の陽ざしが深まり、蝉の声に季節の盛りを感じるころでございます。",
    "皆様にはご多用の中、ご参列を賜り、誠にありがとうございます。",
    "故・堀池故堀池 チエノ様は、九十一年のご生涯を歩まれ、このたび葬儀の日を迎えられました。",
    "去る二〇二六年七月四日、九十一歳にて生涯を閉じられました、堀池チエノ様の葬儀にあたり、開式に先立ち、ともに過ごされた日々を振り返らせていただきます。",
    "チエノ様を思うと、笑っておられたお顔が浮かびます。",
    "そのご生涯を偲び、",
    "明るく前向きな故堀池 チエノ様は、思い立つとすぐに動かれました。",
    "皆様には、どうぞお心静かにご参列くださいますよう、お願い申し上げます。",
    "皆様には、しばらくの間、静かにお心をお寄せくださいますようお願い申し上げます。",
    "皆様にはご起立いただき、合掌にてお迎えくださいますようお願い申し上げます。",
    "皆様、どうぞご静粛にお心をお向けください。",
    "笑っておられたお顔を偲び、まもなく開式のお時間でございます。",
    "皆様には、開式まで今しばらくお待ちくださいますようお願い申し上げます。",
    "本日は、チエノ様とともに過ごされた日々を胸に、",
    "これより、故・堀池チエノ様の葬儀を執り行わせていただきます。",
    "ただいまより、チエノ様の葬儀を執り行います。",
    "家族を大切にされたチエノ様へ、これより皆様とともにお別れの時を進めてまいります。",
    "まもなく、堀池チエノ様の葬儀を開式いたします。",
    "尽きることのない感謝の思いを胸に、まもなく開式のお時間でございます。",
  ].join("\n\n"),
  closingNarration: "親子三代で旅行に出かけられました。",
}, chienoPrompt);
assert.equal((duplicatedIntroDraft.openingNarration.match(/故堀池 チエノ様/gu) || []).length, 1);
assert.equal(duplicatedIntroDraft.openingNarration.includes("故・堀池故堀池"), false);
assert.equal(duplicatedIntroDraft.openingNarration.includes("葬儀の日を迎えられました"), false);
assert.equal(duplicatedIntroDraft.openingNarration.includes("開式に先立ち"), false);
assert.equal(duplicatedIntroDraft.openingNarration.includes("九十一歳にて"), false);
assert.equal((duplicatedIntroDraft.openingNarration.match(/まもなく開式のお時間でございます。/gu) || []).length, 1);
assert.equal(duplicatedIntroDraft.openingNarration.includes("開式まで今しばらくお待ち"), false);
assert.equal(duplicatedIntroDraft.openingNarration.includes("葬儀を執り行わせていただきます"), false);
assert.equal(duplicatedIntroDraft.openingNarration.includes("葬儀を執り行います"), false);
assert.equal(duplicatedIntroDraft.openingNarration.includes("ご参列くださいますよう"), false);
assert.equal(duplicatedIntroDraft.openingNarration.includes("ご参列を賜り"), false);
assert.equal(duplicatedIntroDraft.openingNarration.includes("日々を胸に、"), false);
assert.equal(duplicatedIntroDraft.openingNarration.includes("お心をお寄せ"), false);
assert.equal(duplicatedIntroDraft.openingNarration.includes("ご起立"), false);
assert.equal(duplicatedIntroDraft.openingNarration.includes("ご静粛に"), false);
assert.equal(duplicatedIntroDraft.openingNarration.includes("これより皆様とともにお迎え"), false);
assert.equal(duplicatedIntroDraft.openingNarration.includes("お別れの時を進め"), false);
assert.equal(duplicatedIntroDraft.openingNarration.includes("葬儀を開式"), false);
assert.equal(duplicatedIntroDraft.openingNarration.includes("そのご生涯を偲び、"), false);

const repeatedMemoryDraft = context.testHelpers.normalizeFamilyNearNarration({
  openingNarration: [
    "蝉の声が遠く近くに響く、この季節。\n故試験 花子様は、91年という尊いご生涯を閉じ、静かに人生の幕を下ろされました。\n花子様を思うとき、ご家族の中にまず浮かぶのは、笑っているお顔でございました。\nいつも笑っている顔しか思い出せないほど、よく笑っておられたことが、まず心に浮かびます。\n何か特別な場面だけではなく、その表情が記憶の入口となっております。\n歌に声を重ね、ときには踊るように身体を動かされました。",
    "手芸を楽しみ、野菜や花にも手をかけておられました。",
    "笑っておられたお顔、歌や踊り、手芸、野菜や花に触れる日々をたどりながら、花子様へ心を寄せてまいります。",
  ].join("\n\n"),
  closingNarration: [
    "親子三代で旅行に出かけられました。",
    "開式前にたどった記憶とは別の思い出として残されています。",
  ].join("\n\n"),
}, chienoPrompt);
assert.equal((repeatedMemoryDraft.openingNarration.match(/いつも笑っている顔しか思い出せない/gu) || []).length, 1);
assert.equal(repeatedMemoryDraft.openingNarration.includes("蝉の声が遠く近くに響く"), true);
assert.equal(repeatedMemoryDraft.openingNarration.includes("故試験 花子様は"), true);
assert.equal(repeatedMemoryDraft.openingNarration.includes("花子様を思うとき"), false);
assert.equal(repeatedMemoryDraft.openingNarration.includes("歌に声を重ね"), true);
assert.equal(repeatedMemoryDraft.openingNarration.includes("記憶の入口"), false);
assert.equal(repeatedMemoryDraft.openingNarration.includes("歌や踊り、手芸、野菜や花"), false);
assert.equal(repeatedMemoryDraft.closingNarration.includes("開式前にたどった記憶"), false);
const exactSmilePrompt = JSON.stringify({
  hearingSheet: {
    fullName: "試験 花子",
    narrationName: "花子",
    age: "91",
    familyMemories: "いつも笑っている顔しか思い出せないほど、よく笑う人だった。",
    familyFeelings: "その明るさを見習い、前向きに歩んでいきたい。",
  },
});
const restoredSmile = context.testHelpers.normalizeFamilyNearNarration({
  openingNarration: "夏の季節です。\n故試験 花子様は、91年という尊いご生涯を閉じ、静かに人生の幕を下ろされました。\nご家族の記憶に残る花子様は、いつも笑顔でいらっしゃいました。\n歌を楽しまれました。",
  closingNarration: "旅行を楽しまれました。\n\nその明るさを心に、これからの日々も前を向いて歩んでいきたいと感じています。",
}, exactSmilePrompt);
assert.equal((restoredSmile.openingNarration.match(/いつも笑っている顔しか思い出せない/gu) || []).length, 1);
assert.equal(restoredSmile.openingNarration.includes("歌を楽しまれました"), true);
assert.equal(restoredSmile.closingNarration.includes("その明るさを見習い、前向きに歩んでいきたい"), true);
assert.equal(restoredSmile.closingNarration.includes("前を向いて"), false);
assert.equal(context.testHelpers.closingStartsWithSeasonalLanguage("青葉園、白浜へ旅行されました。"), false);
assert.equal(context.testHelpers.closingStartsWithSeasonalLanguage("青葉の美しい季節となりました。"), true);
const repeatedTravel = context.testHelpers.normalizeFamilyNearNarration({
  openingNarration: "開式前本文。",
  closingNarration: "青葉園、白浜、緑川、花里へ旅行されたことがありました。いずれも誕生日月の十月のことです。親子三代で出かけられました。",
}, chienoPrompt);
assert.equal((repeatedTravel.closingNarration.match(/親子三代/gu) || []).length, 1);
assert.equal((repeatedTravel.closingNarration.match(/十月/gu) || []).length, 1);

const latestUserDraft = context.testHelpers.normalizeFamilyNearNarration({
  openingNarration: [
    "夏の光が深まり、蝉の声に季節の盛りを感じる頃でございます。",
    "故試験 花子様は、91年という尊いご生涯を閉じ、静かに人生の幕を下ろされました。",
    "「いつも笑っている顔しか思い出せない」とご家族が語られるほど、日々のそばには花子様の笑顔がありました。",
    "歌に声を重ね、ときには踊るように身体を動かされる姿は、いつも可愛いものとして残されています。",
    "手芸に向かえば、手を動かして形にしていかれる。野菜やお花にも手をかけ、育つ様子を見守ってこられました。",
    "明るく、前向きで、人の悪口を言わず、行動力をもって人と接することを大好きにされていました。口癖のように人の悪口を言ってはいけないと言われ、その言葉もご家族のそばにあります。",
  ].join("\n\n"),
  closingNarration: [
    "親子三代で、六甲、小倉、下関、博多へ旅行に行かれました。どの旅も、お誕生日月である十月に出かけられたものです。親子三代で同じ行程をたどったことが、花子様との思い出として残されています。",
    "その明るさを心に、これからの日々も前を向いて歩んでいきたいという思いが、ご家族にはあります。十月の旅のことも、これから静かに思い返されてまいります。",
  ].join("\n\n"),
}, exactSmilePrompt);
const latestUserFull = `${latestUserDraft.openingNarration}\n${latestUserDraft.closingNarration}`;
assert.equal(latestUserFull.includes("人と接することを大好きにされていました"), false);
assert.equal((latestUserFull.match(/人の悪口を言ってはいけない/gu) || []).length, 1);
assert.equal(latestUserFull.includes("旅行に行かれました"), false);
assert.equal((latestUserDraft.closingNarration.match(/親子三代/gu) || []).length, 1);
assert.equal((latestUserDraft.closingNarration.match(/十月/gu) || []).length, 1);
assert.equal(latestUserDraft.closingNarration.includes("その明るさを見習い、前向きに歩んでいきたい"), true);

const productionSmokeDraft = context.testHelpers.normalizeFamilyNearNarration({
  openingNarration: [
    "蝉の声が遠く近くに響く、この季節。",
    "故試験 花子様は、91年という尊いご生涯を閉じ、静かに人生の幕を下ろされました。",
    "「いつも笑っている顔しか思い出せない」とご家族が語られるほど、日々のそばには花子様の笑顔がありました。",
    "歌に声を重ね、ときには踊るように身体を動かされる姿を、ご家族はいつも可愛いと感じておられました。",
    "手芸を楽しむときには手を動かして形にし、野菜や花にも手をかけて育てておられました。その育つ様子を見守ることも、花子様の暮らしの中にありました。",
    "明るく前向きで、人と接することが大好きだった花子様は、思い立ったらすぐに行動されました。人を悪く言ってはいけないとよく話され、家族を大切にしておられました。",
  ].join("\n\n"),
  closingNarration: [
    "親子三代で青葉園、白浜、緑川、花里へ旅行されました。いずれも、花子様の誕生日月である十月のことでした。親子三代で出かけたその旅行が、ご家族の中に残っています。",
    "その明るさを見習い、前向きに歩んでいきたい――そのお気持ちも、ご家族の胸にあります。",
  ].join("\n\n"),
}, exactSmilePrompt);
const productionSmokeFull = `${productionSmokeDraft.openingNarration}\n${productionSmokeDraft.closingNarration}`;
assert.equal(productionSmokeFull.includes("いつも可愛いと感じておられました"), false);
assert.equal(productionSmokeFull.includes("手をかけて育てておられました"), false);
assert.equal(productionSmokeFull.includes("行動されました。人を悪く"), false);
assert.equal((productionSmokeDraft.closingNarration.match(/親子三代/gu) || []).length, 1);
assert.equal((productionSmokeDraft.closingNarration.match(/十月/gu) || []).length, 1);

const latestProductionSmokeDraft = context.testHelpers.normalizeFamilyNearNarration({
  openingNarration: [
    "「いつも笑っている顔しか思い出せない」とご家族が語られるほど、日々のそばには花子様の笑顔がありました。",
    "故試験 花子様は、91年という尊いご生涯を閉じ、静かに人生の幕を下ろされました。",
    "歌に声を重ね、ときには踊るように身体を動かされる。",
    "思い出の中には、そんな愛らしいお姿もございます。",
    "手芸を楽しむときには、手を動かして少しずつ形にしていかれる。野菜や花にも手をかけ、育つ様子を見ておられました。",
    "人と接することが大好きで、思い立ったらすぐに行動される花子様。人を悪く言ってはいけないとよく話し、家族を大切にしてこられました。",
  ].join("\n\n"),
  closingNarration: "お誕生日月の十月には、親子三代で青葉園、白浜、緑川、花里へ出かけられました。その土地の名に触れるたび、ともに過ごした旅の日々もよみがえります。\n\nその明るさを見習い、前向きに歩んでいきたい――そのお気持ちも、ご家族の胸にあります。",
}, exactSmilePrompt);
assert.equal(latestProductionSmokeDraft.openingNarration.includes("育つ様子を見ておられました"), false);
assert.equal(latestProductionSmokeDraft.openingNarration.includes("すぐに行動される"), false);
assert.equal((latestProductionSmokeDraft.openingNarration.match(/人の悪口を言ってはいけない/gu) || []).length, 1);

const missingSeasonDraft = context.testHelpers.applyNameRule({
  openingNarration: "「いつも笑っている顔しか思い出せない」とご家族が語られるほど、日々のそばには花子様の笑顔がありました。\n故試験 花子様は、91年という尊いご生涯を閉じ、静かに人生の幕を下ろされました。",
  closingNarration: "親子三代で旅へ出かけられました。",
}, exactSmilePrompt);
assert.equal(missingSeasonDraft.openingNarration.startsWith("蝉の声が遠く近くに響くこの季節。\n故試験 花子様は、"), true);
assert.equal((missingSeasonDraft.openingNarration.match(/故試験 花子様/gu) || []).length, 1);

const thirdProductionSmokeDraft = context.testHelpers.normalizeFamilyNearNarration({
  openingNarration: [
    "蝉の声が遠く近くに響くこの季節。",
    "故試験 花子様は、91年という尊いご生涯を閉じ、静かに人生の幕を下ろされました。",
    "「いつも笑っている顔しか思い出せない」とご家族が語られるほど、日々のそばには花子様の笑顔がありました。",
    "歌に声を重ね、ときには踊るように身体を動かされる姿を、ご家族はいつも可愛いと感じていました。",
    "手芸を楽しむときには、手を動かして少しずつ形にしていかれる。野菜や花にも手をかけ、その育ちを見守っておられました。",
    "人と接することが大好きで、思い立ったらすぐに行動される花子様。明るく前向きに過ごされる中で、人を悪く言ってはいけないと、よく話しておられました。",
    "そして、花子様が大切にしてこられたのはご家族でした。その思いを受けながら、",
  ].join("\n\n"),
  closingNarration: "親子三代で青葉園、白浜、緑川、花里へ旅行されました。いずれも誕生日月の十月のことでした。花子様とご家族がそろって出かけられた記憶として、今もその月が思い出されます。\n\nその明るさを見習い、前向きに歩んでいきたい――そのお気持ちも、ご家族の胸にあります。",
}, exactSmilePrompt);
const thirdProductionFull = `${thirdProductionSmokeDraft.openingNarration}\n${thirdProductionSmokeDraft.closingNarration}`;
assert.equal(thirdProductionFull.includes("その思いを受けながら、"), false);
assert.equal(thirdProductionFull.includes("可愛いと感じていました"), false);
assert.equal(thirdProductionFull.includes("育ちを見守っておられました"), false);
assert.equal(thirdProductionFull.includes("すぐに行動される"), false);
assert.equal((thirdProductionSmokeDraft.closingNarration.match(/親子三代/gu) || []).length, 1);
assert.equal((thirdProductionSmokeDraft.closingNarration.match(/十月/gu) || []).length, 1);

const stablePortraitPrompt = JSON.stringify({
  hearingSheet: {
    fullName: "試験 花子",
    narrationName: "花子",
    age: "91",
    familyMemories: "いつも笑っている顔しか思い出せないほど、よく笑う人だった。",
    memorableEvents: "歌ったり踊ったりする姿を、家族はいつも可愛いと感じていた。",
    hobbies: "手芸を楽しみ、野菜や花を育てていた。",
    personality: "明るく前向きで、人と接することが大好きだった。思い立ったらすぐに行動した。",
    favoritePhrases: "「人の悪口を言ってはいけない」とよく話していた。",
    valuedThings: "家族を大切にしていた。",
    travelAnniversaryEffort: "親子三代で青葉園、白浜、緑川、花里へ旅行した。いずれも誕生日月の十月だった。",
    familyFeelings: "その明るさを見習い、前向きに歩んでいきたい。",
  },
  writingRules: { season: "夏" },
});
const stablePortraitBody = context.testHelpers.buildStableFamilyPortrait({
  openingNarration: "不安定な初稿",
  closingNarration: "不安定な初稿",
}, stablePortraitPrompt);
assert.notEqual(stablePortraitBody, null);
const stablePortrait = context.testHelpers.applyNameRule(stablePortraitBody, stablePortraitPrompt);
assert.equal(stablePortrait.openingNarration.startsWith("蝉の声が遠く近くに響き、木々の葉陰に涼を探すこの季節。"), true);
assert.equal(stablePortrait.openingNarration.includes("その場を明るく"), false);
assert.equal(stablePortrait.openingNarration.includes("ご家族が語られるほど"), false);
assert.equal((stablePortrait.openingNarration.match(/人の悪口を言ってはいけない/gu) || []).length, 1);
assert.equal((stablePortrait.closingNarration.match(/親子三代/gu) || []).length, 1);
assert.equal((stablePortrait.closingNarration.match(/十月/gu) || []).length, 1);
const stablePortraitCheck = context.testHelpers.qualityCheckNarration(stablePortrait, stablePortraitPrompt);
assert.equal(stablePortraitCheck.failures.length, 0);
const alternatePhrasePrompt = stablePortraitPrompt.replace(
  "人の悪口を言ってはいけない",
  "人を悪く言ってはいけない"
);
const alternatePhrasePortrait = context.testHelpers.buildStableFamilyPortrait({}, alternatePhrasePrompt);
assert.notEqual(alternatePhrasePortrait, null);
assert.equal(alternatePhrasePortrait.openingNarration.includes("「人を悪く言ってはいけない」"), true);
const shuffledPortraitPrompt = JSON.stringify({
  hearingSheet: {
    fullName: "試験 花子",
    narrationName: "花子",
    age: "91",
    familyMemories: "いつも笑っている顔しか思い出せない。歌ったり踊ったりする姿が可愛らしかった。",
    memorableEvents: "手芸を楽しみ、野菜や花を育てた。親子三代で青葉園、白浜、緑川、花里へ旅行した。",
    hobbies: "人と接することが好きで、行動力があった。",
    personality: "人の悪口を言ってはいけないと話した。家族を大切にした。",
    notes: "誕生日月の十月の旅。その姿を見習い、明るく前向きに歩んでいきたい。",
  },
  writingRules: { season: "夏" },
});
const shuffledPortrait = context.testHelpers.buildStableFamilyPortrait({}, shuffledPortraitPrompt);
assert.notEqual(shuffledPortrait, null);
assert.equal(shuffledPortrait.closingNarration.includes("親子三代で青葉園、白浜、緑川、花里へ"), true);
assert.equal(shuffledPortrait.closingNarration.includes("お誕生日月の十月"), true);
const actualCompassInputPrompt = JSON.stringify({
  hearingSheet: {
    deceasedName: "堀池 チエノ",
    narrationName: "チエノ",
    age: "91",
    personality: "明るい、前向き、人の悪口を言わない、行動力がある、人と接する事が大好き",
    hobbies: "手芸、野菜やお花を育てる",
    memorableEvents: "歌ったり、踊ったりしていつも可愛い",
    familyMemories: "いつも笑っている顔しか思い出せないほど、よく笑う人。",
    familyFeelings: "私も彼女を見習い、明るく前向きに歩んでいきたい。",
    travelAnniversaryEffort: "親子3代で行った、六甲や小倉、下関、博多旅行。どれもお誕生日月の10月に行った。",
    favoritePhrases: "人の悪口を言ってはいけない",
    valuedThings: "家族を大切にしていた",
  },
  writingRules: { season: "夏" },
});
const actualCompassPortrait = context.testHelpers.buildStableFamilyPortrait({}, actualCompassInputPrompt);
assert.notEqual(actualCompassPortrait, null);
assert.equal(actualCompassPortrait.closingNarration.includes("親子三代で六甲、小倉、下関、博多へ"), true);
assert.equal(actualCompassPortrait.closingNarration.includes("お誕生日月の十月"), true);
assert.equal(context.testHelpers.qualityCheckNarration(
  context.testHelpers.applyNameRule(actualCompassPortrait, actualCompassInputPrompt),
  actualCompassInputPrompt
).failures.length, 0);

const staffPlan = context.testHelpers.staffSelectedMemoryPlan({
  familyMemories: "家族で過ごした具体的な思い出。",
  hobbies: "手芸と花の世話。",
  travelAnniversaryEffort: "親子三代で出かけた旅行。",
  familyFeelings: "明るさを見習いたい。",
}, {
  opening: [
    { field: "familyMemories", label: "家族との思い出" },
    { field: "hobbies", label: "趣味" },
  ],
  closing: [
    { field: "travelAnniversaryEffort", label: "旅行" },
    { field: "familyFeelings", label: "家族の気持ち" },
  ],
});
assert.equal(staffPlan.selectedByStaff, true);
assert.deepEqual(
  [staffPlan.opening.anchor.field, ...staffPlan.opening.supports.map(card => card.field)],
  ["familyMemories", "hobbies"],
);
assert.deepEqual(
  [staffPlan.closing.anchor.field, ...staffPlan.closing.supports.map(card => card.field)],
  ["travelAnniversaryEffort", "familyFeelings"],
);

const studioPrompt = context.testHelpers.compactNarrationPrompt(`instructions
${JSON.stringify({
  workflowMode: "revision",
  revisionDraft: "【開式前ナレーション】下書き。\\n\\n【閉式後ナレーション】下書き。",
  revisionInstruction: "不自然な日本語だけを直す",
  hearingSheet: {
    deceasedName: "試験 花子",
    narrationName: "花子",
    age: "88",
    familyMemories: "家族で過ごした具体的な思い出。",
    hobbies: "手芸と花の世話。",
    travelAnniversaryEffort: "親子三代で出かけた旅行。",
    familyFeelings: "明るさを見習いたい。",
  },
  staffCompositionPlan: {
    opening: [{ field: "hobbies", label: "趣味" }],
    closing: [{ field: "travelAnniversaryEffort", label: "旅行" }],
  },
  writingRules: { season: "夏", theme: "家族愛", forbiddenWords: [] },
})}`);
assert.equal(studioPrompt.includes("スタッフが選んだ構成を守る校正"), true);
// The compact prompt serializes only the selected fact cards under sourceFacts;
// the internal plan marker is intentionally not sent to the model.
assert.equal(studioPrompt.includes('"sourceFacts"'), true);
assert.equal(studioPrompt.includes("不自然な日本語だけを直す"), true);

console.log("narration normalization tests passed");
