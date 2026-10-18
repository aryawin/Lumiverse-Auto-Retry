// Broken replies of the kinds a model writes when it falls apart, against
// replies a character writes on purpose that look close to them.
//
// Each check has a list it must catch and a list it must leave alone. A reply
// re-rolled by mistake costs the reader the reply they were reading, so the
// second list matters as much as the first.
//
// Every example is made up for this file.
//
// Run with: bun test

import { expect, test, describe } from "bun:test";
import { __testing } from "../src/frontend";

const { soupVerdict, switchVerdict, leakVerdict, loopVerdict, garbledVerdict, replyProblem } = __testing as any;
const cfg = { ...(__testing as any).CONFIG };

const scene =
  "Tamsin pulled the cart into the lee of the barn and climbed down. The mule shook the rain from its ears and " +
  "stood with its head low. Inside, the lamp was already lit, and Orrin sat by the stove mending a strap with " +
  "an awl and a length of waxed thread. He looked up when the door opened, then went back to his work. " +
  "\"You took the long road,\" he said. \"The bridge was out,\" she answered, and hung her coat on the peg. ";

describe("broken characters", () => {
  const broken: Array<[string, string]> = [
    [
      "text read with the wrong encoding",
      scene +
        "She said itâ€™s fine, the cafÃ© was closed, Ã¢â‚¬Å“weâ€™ll go tomorrowâ€\u009d, and the rÃ©sumÃ© " +
        "lay on the table beside the Ã©clair and the piÃ±ata, and nobody knew whatâ€™s next.",
    ],
    ["replacement characters and control characters", scene + "��\u0001 the �� lamp \u0002���\u0003 went �� out."],
  ];
  const fine: Array<[string, string]> = [
    ["one slip in a reply that reads", scene + "She said itâ€™s fine."],
    ["French with its accents", scene + "\"Très bien, à demain,\" said Élodie. \"Ça va? Le café était déjà fermé.\""],
    ["Spanish punctuation", scene + "\"¿Dónde está el señor?\" asked Inés. \"¡Allí, junto a la puerta!\""],
    ["a redacted file", scene + "The report read: Subject ████████ was moved to ██████ on the third night."],
  ];
  for (const [label, text] of broken) test("caught: " + label, () => expect(soupVerdict(text)).toBe(true));
  for (const [label, text] of fine) test("left alone: " + label, () => expect(soupVerdict(text)).toBe(false));
});

describe("a switch to another alphabet for the rest of the reply", () => {
  const russianTail =
    "Затем дорога ушла вниз к реке, и никто не знал, куда идти дальше, потому что мост был сломан и вода поднималась.";
  const chineseTail = "然后道路向下延伸到河边，没有人知道该往哪里走，因为桥已经断了，水还在不断上涨，天也越来越黑。";
  test("caught: English that turns into Russian and never comes back", () => {
    expect(switchVerdict(scene + scene + russianTail)).toBe(true);
  });
  test("caught: English that turns into Chinese and never comes back", () => {
    expect(switchVerdict(scene + scene + chineseTail + chineseTail)).toBe(true);
  });
  test("left alone: the same words said by a character, in quotation marks", () => {
    expect(switchVerdict(scene + scene + "She whispered, \"" + russianTail + "\"")).toBe(false);
  });
  test("left alone: a line in Russian with English after it", () => {
    expect(switchVerdict(scene + russianTail + " " + scene)).toBe(false);
  });
  test("left alone: a reply written in Russian from the start", () => {
    expect(switchVerdict(russianTail + " " + russianTail + " " + russianTail)).toBe(false);
  });
  test("left alone: a short phrase at the end", () => {
    expect(switchVerdict(scene + scene + "Спасибо, друг.")).toBe(false);
  });
  test("left alone: a letter in Russian after a colon", () => {
    expect(switchVerdict(scene + scene + "She unfolded the note. It read:\n\n" + russianTail)).toBe(false);
  });
  test("left alone: a passage in Russian set in italics", () => {
    expect(switchVerdict(scene + scene + "He sang under his breath. *" + russianTail)).toBe(false);
  });
  test("left alone: a passage in Russian in a quoted block", () => {
    expect(switchVerdict(scene + scene + "\n> " + russianTail)).toBe(false);
  });
});

describe("the prompt's format leaked into the reply", () => {
  const broken: Array<[string, string]> = [
    ["an instruction marker and card data", scene + "Here. [/INST] [Character(\"Pell\")][Occupation(\"miller\")] Backstory: Pell grew up by the weir."],
    ["a system marker", scene + "<<SYS>> You are Pell, a miller who speaks little. <</SYS>>"],
    ["an Alpaca heading", scene + "\n\n### Instruction:\nContinue the story as Pell."],
    ["the next turn started by the model", scene + "<|im_start|>user\nI take the strap from him."],
    ["two lines of card data", scene + "[Name(\"Pell\")] [Mind(\"patient\" + \"wry\")] and then the weir."],
  ];
  const fine: Array<[string, string]> = [
    ["a tracker in brackets", scene + "[Health: 8/10] [Mood: tired] [Location: the barn]"],
    ["one bracketed line that looks like code", scene + "On the slate he had chalked [Order(\"flour\")] and nothing else."],
    ["the markers inside a code block", scene + "\n```\n[INST] example [/INST]\n<<SYS>>\n```\n"],
    ["a turn marker that opens the reply", "<|im_start|>assistant\n" + scene],
    ["a heading that is part of the story", scene + "\n\n### Chapter Two\nThe weir was quiet."],
  ];
  for (const [label, text] of broken) test("caught: " + label, () => expect(leakVerdict(text, cfg)).toBe(true));
  for (const [label, text] of fine) test("left alone: " + label, () => expect(leakVerdict(text, cfg)).toBe(false));
});

describe("stuck repeating or rambling", () => {
  const runOn = Array.from({ length: 170 }, (_, i) => ["quiet", "still", "settled", "calm", "resting", "steady", "level", "even"][i % 8] + (i % 3 ? "" : "ly")).join(" ");
  const broken: Array<[string, string]> = [
    ["a phrase repeated to the end", scene + "the lantern is the lantern is ".repeat(14) + "the lan"],
    ["one word repeated to the end", scene + "Not here, here, " + "here, ".repeat(80)],
    ["a sentence repeated to the end", scene + "She looked at the door and waited for him. ".repeat(12)],
    ["a short pattern repeated hundreds of times", scene + "The total was 3." + "1.".repeat(120) + " as a fraction."],
    ["words running on with no punctuation to the end", scene + runOn],
  ];
  const fine: Array<[string, string]> = [
    ["a chant with the scene carrying on after it", scene + "\"Run, run, run, run, run, run!\" Tamsin shouted, and they ran for the trees."],
    ["a stammer", scene + "\"I-I-I didn't mean it,\" he said."],
    ["a scream held long", scene + "\"Noooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooooo!\""],
    ["a divider line", scene + "\n" + "=-".repeat(80) + "\n" + scene],
    [
      "a long sentence with commas",
      scene +
        "They went past the mill, over the weir, along the bank where the reeds grew thick, under the willows " +
        "that leaned out over the water, through the gate that never shut, across the lower field where the " +
        "sheep stood in a huddle, up the lane between the hedges, past the chapel with its broken bell, and " +
        "on toward the ridge, where the road turned to stone and the wind came hard off the hills, until at " +
        "last, tired and soaked and arguing about nothing, they saw the lamp in the window of the inn.",
    ],
    ["lines written out as a punishment, ending the reply", scene + "On the board she wrote:\n" + "I will not feed the mule from the table. ".repeat(6)],
    ["a laugh held long", scene + "\"Ha" + "ha".repeat(70) + "!\" He could not stop."],
    ["a long reply in Thai, which has no punctuation", Array.from({ length: 200 }, (_, i) => ["ฝนตก", "ทะเล", "ปลา", "แมว"][i % 4] + i).join(" ")],
    ["a poem with no punctuation, one short line each", scene + Array.from({ length: 60 }, (_, i) => ["the reeds bend low", "the water runs on", "the heron waits", "the light goes gray"][i % 4]).join("\n")],
    ["a refrain sung three times", scene + "\"Down by the water, down by the water,\" she sang. \"Down by the water we go.\""],
  ];
  for (const [label, text] of broken) test("caught: " + label, () => expect(loopVerdict(text)).toBe(true));
  for (const [label, text] of fine) test("left alone: " + label, () => expect(loopVerdict(text)).toBe(false));
});

describe("a breakdown that outweighs a good English start", () => {
  const jumble =
    "然后system拒绝了道路data处理 lanternQ 心理model训练集准确率 windowFRS 桥已经断了 harborTL 没有人知道 rope路径 " +
    "kettleRMB 数据集验证结果为 gateLWN 他们的mapping继续 stoveQ 水还在不断上涨 shelfTRV 天也越来越黑 matrixFRN 结果 " +
    "没有人知道该往哪里走因为桥已经断了水还在不断上涨天也越来越黑 ";
  test("caught: English that breaks into a mostly Chinese jumble", () => {
    const text = scene + jumble.repeat(4);
    // Mostly Chinese by letter count, so only the English start decides it.
    const latin = (text.match(/\p{Script=Latin}/gu) || []).length;
    expect(latin / (latin + (text.match(/\p{Script=Han}/gu) || []).length)).toBeLessThan(0.7);
    expect(garbledVerdict(text)).toBe(true);
  });
  test("left alone: a reply written in Chinese from the start, with an English name in it", () => {
    const zh = "她把车停在谷仓旁边，下了车。骡子抖了抖耳朵上的雨水。屋里灯已经亮了，Orrin坐在炉子旁边修皮带。";
    expect(garbledVerdict(zh.repeat(8))).toBe(false);
  });
});

describe("each check has its switch, and they are on by default", () => {
  const leak = scene + "Here. [/INST] [Character(\"Pell\")][Occupation(\"miller\")]";
  const loop = scene + "the lantern is the lantern is ".repeat(14);
  test("a leak is retried as a leak", () => expect(replyProblem(leak, "", cfg)).toBe("leaked the prompt's format"));
  test("and not with its switch off", () => expect(replyProblem(leak, "", { ...cfg, retryOnLeak: false })).not.toBe("leaked the prompt's format"));
  test("a loop is retried as a loop", () => expect(replyProblem(loop, "", cfg)).toBe("stuck repeating or rambling"));
  test("and not with its switch off", () => expect(replyProblem(loop, "", { ...cfg, retryOnLoop: false })).not.toBe("stuck repeating or rambling"));
  test("broken characters count as garbled", () => {
    expect(replyProblem(scene + "��\u0001 the �� lamp \u0002���\u0003 went �� out.", "", cfg)).toBe("garbled");
  });
  test("all of them are on by default", () => {
    expect(cfg.retryOnGarbled && cfg.retryOnLeak && cfg.retryOnLoop).toBe(true);
  });
});
