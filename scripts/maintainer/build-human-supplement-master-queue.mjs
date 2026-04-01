#!/usr/bin/env node
/* eslint-disable no-console */
import fs from "node:fs/promises";
import path from "node:path";

import { normalizeText, normalizeLower } from "./lib/iherb-overlay-utils.mjs";
import { decideOfficialFetchPolicy } from "./lib/official-fetch-policy.mjs";

const ROOT = process.cwd();
const args = process.argv.slice(2);

const getArg = (name, fallback = null) => {
  const flag = `--${name}`;
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return fallback;
  return args[idx + 1];
};

const STAGING_PATH = getArg(
  "staging-json",
  path.join(
    ROOT,
    "output",
    "p0_p3_codeage_remaining_six_closure_20260317",
    "unified_wave",
    "staging_products.official_refreshed.sanitized.json",
  ),
);
const QUEUE_PATH = getArg(
  "queue-json",
  path.join(ROOT, "output", "iherb_overlay_execution_plan_full_p0p1_final", "active_priority_queue.json"),
);
const OUT_DIR = getArg(
  "out-dir",
  path.join(ROOT, "output", `scrapling_human_supplement_master_queue_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`),
);
const BRAND_FILTERS = (getArg("brands", "") || "")
  .split(",")
  .map((value) => normalizeText(value))
  .filter(Boolean);

const readJson = async (filePath) => JSON.parse(await fs.readFile(path.resolve(ROOT, filePath), "utf8"));
const toArray = (value) => (Array.isArray(value) ? value : []);

const slugify = (value) =>
  normalizeLower(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const writeJson = async (filePath, payload) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
};

const writeText = async (filePath, body) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, body, "utf8");
};

const buildStagingIndex = (rows) => {
  const byProductId = new Map();
  const byBarcode = new Map();
  for (const row of rows) {
    const productId = normalizeText(row?.productId ?? null);
    const barcode = normalizeText(row?.barcode_gtin14 ?? row?.barcode ?? null);
    if (productId) byProductId.set(productId, row);
    if (barcode) byBarcode.set(barcode, row);
  }
  return { byProductId, byBarcode };
};

const isOfficialProductUrl = (value) => /^https?:\/\/[^/]+\/products?\//i.test(String(value ?? ""));
const isIherbProductUrl = (value) => /^https?:\/\/([a-z0-9-]+\.)?(?:ca\.)?iherb\.com\/pr\//i.test(String(value ?? ""));

const rankKnownUrl = (value) => {
  const url = String(value ?? "");
  if (!/^https?:\/\//i.test(url)) return 999;
  if (isIherbProductUrl(url)) return 0;
  if (isOfficialProductUrl(url)) return 1;
  return 50;
};

const chooseKnownUrls = (row) =>
  [...new Set([
    ...toArray(row?.sourceSummary?.sourceUrls),
    row?.link,
  ].filter((value) => /^https?:\/\//i.test(String(value ?? ""))))]
    .sort((left, right) => rankKnownUrl(left) - rankKnownUrl(right))
    .filter((value) => rankKnownUrl(value) < 999);

const POSITIVE_TITLE_PATTERNS = [
  /\b(capsule|capsules|tablet|tablets|softgel|softgels|gummy|gummies|packet|packets|powder|chewable|chewables)\b/i,
  /\b(\d+\s*(mg|mcg|g|iu|cfu))\b/i,
];

const POSITIVE_CATEGORY_PATTERNS = [
  /supplement/i,
  /probiotic/i,
  /multivitamin/i,
  /vitamin/i,
  /mineral/i,
  /omega/i,
  /gut health/i,
  /sports supplements/i,
  /protein/i,
  /creatine/i,
  /melatonin/i,
  /magnesium/i,
];

const EXPLICIT_PET_PATTERNS = [
  /\bpet\b/i,
  /\bdog\b/i,
  /\bdogs\b/i,
  /\bcat\b/i,
  /\bcats\b/i,
  /\bfor dogs\b/i,
  /\bfor cats\b/i,
  /\bcanine\b/i,
  /\bfeline\b/i,
];

const EXPLICIT_TOPICAL_PATTERNS = [
  /\bshower steamers?\b/i,
  /\bdiaper rash\b/i,
  /\bskin protectant\b/i,
  /\bointment\b/i,
  /\bdraw salve\b/i,
  /\bbubble bath\b/i,
  /\bbody bars?\b/i,
  /\bbody scrub\b/i,
  /\bhair gel\b/i,
  /\bhair therapy\b/i,
  /\bhair (?:&|and) scalp spray\b/i,
  /\bconditioner\b/i,
  /\bconditioner bar\b/i,
  /\beye gels?\b/i,
  /\bexfoliating pads?\b/i,
  /\bfirst aid gel\b/i,
  /\baloe vera gel\b/i,
  /\bcleansing bar\b/i,
  /\bfertility lubricant\b/i,
  /\bscent booster\b/i,
  /\bblender bottle\b/i,
  /\bbug (?:&|and) insect repellents?\b/i,
  /\bmosquitoes?\b/i,
  /\bticks?\b/i,
  /\btoothpaste\b/i,
  /\boral care\b/i,
  /\bbath & personal care\b/i,
  /\bbeauty\b/i,
  /\bmakeup\b/i,
  /\bcosmetic\b/i,
  /\bshampoo\b/i,
  /\bsoap\b/i,
  /\bcleanser\b/i,
  /\bmoisturizer\b/i,
  /\bserum\b/i,
  /\bcream\b/i,
  /\blotion\b/i,
  /\bbalm\b/i,
  /\bdeodorant\b/i,
  /\bfacial\b/i,
  /\bbody care\b/i,
  /\bskin care\b/i,
  /\bskin treatment\b/i,
  /\btreatments? & serums?\b/i,
  /\bface scrubs? & exfoliators?\b/i,
  /\bcleansers?\b/i,
  /\bface mist\b/i,
  /\bmagnesium oil\b/i,
  /\bmen'?s shaving\b/i,
  /\bmen'?s grooming\b/i,
  /\bbaby (?:&|and) kids sunscreen\b/i,
  /\bbath minerals? & salts?\b/i,
  /\bbath soaks?\b/i,
  /\bbath flakes?\b/i,
  /\bmassage oils?\b/i,
  /\bessential oils?\b/i,
  /\bdiffuser\b/i,
  /\baromatherapy\b/i,
  /\bbaby powder\b/i,
  /\bshave bar\b/i,
  /\bpoison ivy\/oak bar\b/i,
  /\bsunstick\b/i,
  /\bspf\b/i,
  /\bprotection bar\b/i,
  /\btint\b/i,
  /\bfinishing powder\b/i,
  /\beyeliner\b/i,
  /\bmascara\b/i,
  /\beye shadow\b/i,
  /\beyeshadow\b/i,
  /\bblush\b/i,
  /\bbronzer\b/i,
  /\bhighlighter\b/i,
  /\bfoundation\b/i,
  /\bconcealer\b/i,
  /\blip(?:stick| gloss| balm| oil| liner)?\b/i,
  /\bbrow\b/i,
  /\bcushion\b/i,
  /\bnail\b/i,
  /\bpalette\b/i,
  /\beye drops\b/i,
  /\btopical\b/i,
  /\bexternal use\b/i,
  /\bmagnesium oils?\b/i,
  /\bmagnesium chloride flakes\b/i,
  /\bprogesterone creams?\b/i,
];

const EXPLICIT_NON_ORAL_MEDICAL_PATTERNS = [
  /\bvaginal\b/i,
  /\bsuppositor(?:y|ies)\b/i,
  /\brectal\b/i,
  /\bpessary\b/i,
];

const EXPLICIT_FOOD_PATTERNS = [
  /\bready-to-eat meals?\b/i,
  /\bpackaged (?:&|and) prepared foods?\b/i,
  /\bfreeze-?dried\b/i,
  /\bcoffee\b/i,
  /\bground coffee\b/i,
  /\btea bags?\b/i,
  /\btea & beverages\b/i,
  /\bherbal tea\b/i,
  /\bgreen tea\b/i,
  /\bblack tea\b/i,
  /\biced tea\b/i,
  /\bflou?r\b/i,
  /\bcake mix\b/i,
  /\bbrownie mix\b/i,
  /\bcornbread\b/i,
  /\bpancake\b/i,
  /\bwaffle\b/i,
  /\bpie crust\b/i,
  /\bbaking mix\b/i,
  /\bgluten[- ]?free\b/i,
  /\bk-cup\b/i,
  /\bbeverage\b/i,
  /\bhot drink\b/i,
  /\bghee\b/i,
  /\bclarified butter\b/i,
  /\bsauce\b/i,
  /\brice\b/i,
  /\bnoodles\b/i,
  /\bcurry\b/i,
  /\bpaste\b/i,
  /\bsoup\b/i,
  /\bsatay\b/i,
  /\bgrocery\b/i,
  /\bhoney & sweeteners\b/i,
  /\bcoconut oil\b/i,
  /\bseasonings?\b/i,
  /\bspices?\b/i,
  /\bblack pepper\b/i,
  /\bcoarse grind\b/i,
  /\bgarlic powder\b/i,
  /\bonion powder\b/i,
  /\bpaprika\b/i,
  /\bcumin\b/i,
  /\bturmeric powder\b/i,
  /\bbaharat\b/i,
  /\ball-purpose seasoning\b/i,
  /\bchocolate\b/i,
  /\btruffles?\b/i,
  /\bcocoa\b/i,
  /\bcandy\b/i,
  /\bchocolate & candy\b/i,
  /\bsnack bars?\b/i,
  /\bsnacks\b/i,
  /\boat bars?\b/i,
  /\boatmeal bars?\b/i,
  /\bchutney\b/i,
  /\bpesto\b/i,
  /\baioli\b/i,
  /\bqueso\b/i,
  /\bjam\b/i,
  /\bjelly\b/i,
  /\bmarmalade\b/i,
  /\bpreserves?\b/i,
  /\bfruit spread\b/i,
  /\bapple butter\b/i,
  /\bbutter spread\b/i,
  /\bsesame butter\b/i,
  /\bbread spread\b/i,
  /\bsweetener\b/i,
  /\bstevia\b/i,
  /\bmonk fruit\b/i,
  /\bagave\b/i,
  /\bcane sugar\b/i,
  /\bturbinado\b/i,
  /\bginger chews?\b/i,
  /\bhoney crystals\b/i,
  /\bcreamer\b/i,
  /\bhoney\b/i,
  /\bsalsa\b/i,
  /\bmustard\b/i,
  /\brelish\b/i,
  /\bketchup\b/i,
  /\bdip\b/i,
  /\bmarinade\b/i,
  /\bmarinara\b/i,
  /\bdressing\b/i,
  /\bmayonnaise\b/i,
  /\bpopcorn\b/i,
  /\btrail mix\b/i,
  /\bbridge mix\b/i,
  /\bbanana chips\b/i,
  /\bchocolate almonds\b/i,
  /\bcookies?\b/i,
  /\bbrownies?\b/i,
  /\bgranola\b/i,
  /\bcereal\b/i,
  /\bbreakfast\b/i,
  /\bcrackers?\b/i,
  /\bchips?\b/i,
  /\bnuts?\b/i,
  /\balmonds?\b/i,
  /\bcashews?\b/i,
  /\bpistachios?\b/i,
  /\bpecans?\b/i,
  /\bwalnuts?\b/i,
  /\bdried fruit\b/i,
  /\bdried apricots?\b/i,
  /\bdried figs?\b/i,
  /\bdried mango(?:es)?\b/i,
  /\bdried mulberr(?:y|ies)\b/i,
  /\bdried persimmons?\b/i,
  /\bdried plums?\b/i,
  /\bpitted dates?\b/i,
  /\btart cherries\b/i,
  /\bportion packs?\b/i,
  /\btuna\b/i,
  /\bsalmon\b/i,
  /\bclams?\b/i,
  /\bsardines?\b/i,
  /\banchovies?\b/i,
  /\bmackerel\b/i,
  /\bseafood\b/i,
  /\bchicken of the sea\b/i,
  /\bprotein bars?\b/i,
  /\bmini bars?\b/i,
  /\benergy chews?\b/i,
  /\benergy gels?\b/i,
  /\bperformance food\b/i,
  /\bseaweed snack\b/i,
  /\bjerky\b/i,
  /\bprotein donuts?\b/i,
  /\bnutritional shake\b/i,
  /\bpuree\b/i,
  /\bfruit (?:&|and) vegetable puree\b/i,
  /\bfruit puree\b/i,
  /\bvegetable puree\b/i,
  /\bteething wafers?\b/i,
  /\bsandwich bar\b/i,
  /\bmac (?:&|and) cheese\b/i,
  /\blasagn(?:e|a)\b/i,
  /\bfusilli\b/i,
  /\borzo\b/i,
  /\bpasta\b/i,
  /\bbeans?\b/i,
  /\bgarbanzo\b/i,
  /\bkidney beans?\b/i,
  /\bblack eyed peas?\b/i,
  /\bchickpeas?\b/i,
  /\bquinoa\b/i,
  /\b3-?seed blend\b/i,
  /\bchia seeds?\b/i,
  /\bartichoke hearts?\b/i,
  /\bhearts? of palm\b/i,
  /\bpepitas\b/i,
  /\bwheat berries\b/i,
  /\begg wraps?\b/i,
  /\b6\+\s*months\b/i,
  /\bshelled pumpkin seeds?\b/i,
  /\borganic goji berries\b/i,
  /\braw sesame seeds?\b/i,
  /\bsun-dried tomatoes?\b/i,
  /\bsprouting mix\b/i,
  /\bolive snack\b/i,
  /\bpitted kalamata olives?\b/i,
  /\bgarlic stuffed green olives?\b/i,
  /\bwater lily seeds?\b/i,
  /\bhimalayan pink salt\b/i,
  /\bturmeric garlic\b/i,
  /\bgummy bears?\b/i,
  /\bprotein-rich shake\b/i,
  /\bready-to-drink protein\b/i,
  /\binfant formula\b/i,
  /\btoddler formula\b/i,
  /\bbaby food\b/i,
  /\bsoy candle\b/i,
  /\bbeef (?:&|and) (?:elk|ostrich) stick\b/i,
  /\bostrich stick\b/i,
  /\belk stick\b/i,
];

const EXPLICIT_NON_SUPPLEMENT_UTILITY_PATTERNS = [
  /\blaundry\b/i,
  /\bdetergent\b/i,
  /\blaundry pouches?\b/i,
  /\blaundry pods?\b/i,
  /\bcandles?\b/i,
  /\bhome fragrance\b/i,
  /\bgreener cleaner\b/i,
];

const EXPLICIT_FOOD_BRAND_PATTERNS = [
  /\bashapops\b/i,
  /\bancient harvest\b/i,
  /\bstonewall kitchen\b/i,
  /\burban accents\b/i,
  /\bbuddy fruits?\b/i,
  /\bbuldak\b/i,
  /\bbionaturae\b/i,
  /\bbob'?s red mill\b/i,
  /\bchomps\b/i,
  /\bdate lady\b/i,
  /\beden foods?\b/i,
  /\bfinn crisp\b/i,
  /\bgoodsam\b/i,
  /\bjoi\b/i,
  /\bprobar\b/i,
  /\bsnap dynasty\b/i,
  /\btru fru\b/i,
  /\bamore\b/i,
  /\batkins\b/i,
  /\bsunny fruit\b/i,
  /\benchomps?\b/i,
  /\bostrim\b/i,
  /\bpure indian foods\b/i,
  /\bthe tao of tea\b/i,
  /\benfamil\b/i,
  /\bearth'?s best\b/i,
  /\bgood start\b/i,
  /\bgerber\b/i,
  /\bhappy family organics\b/i,
  /\bsprout organics\b/i,
  /\byumearth\b/i,
  /\bbjornqorn\b/i,
  /\bclio\b/i,
  /\bbragg\b/i,
  /\bcarrington farms\b/i,
  /\bceltic sea salt\b/i,
  /\bdr\.? john'?s healthy sweets\b/i,
  /\bjennies macaroons\b/i,
  /\bmadegood\b/i,
  /\bmontebello\b/i,
  /\boat mama\b/i,
  /\bsunbutter\b/i,
  /\btao kae noi\b/i,
  /\bthe ginger people\b/i,
  /\byang cheng brand\b/i,
  /\bzollipops\b/i,
  /\bfrontier co-?op\b/i,
  /\bstarwest botanicals\b/i,
  /\bepic bar\b/i,
  /\bmade in nature\b/i,
  /\bnugo nutrition\b/i,
  /\bcountry house\b/i,
  /\bcrisp power\b/i,
  /\bfiber gourmet\b/i,
  /\bfoods alive\b/i,
  /\bgo raw\b/i,
  /\bhippeas\b/i,
  /\bkuli kuli\b/i,
  /\bmaine coast sea vegetables\b/i,
  /\bnavitas organics\b/i,
  /\bolyra\b/i,
  /\bseasnax\b/i,
  /\bsimply organic\b/i,
  /\bsprout living\b/i,
  /\bsunfood\b/i,
  /\bthat'?s it\b/i,
  /\busimplyseason\b/i,
  /\bhimalania\b/i,
  /\bkevala\b/i,
  /\bjiva organics\b/i,
  /\bnature'?s turn\b/i,
  /\bbee (?:&|and) you\b/i,
  /\bbulletproof\b/i,
  /\bwilderness poets\b/i,
  /\bharney (?:&|and) sons\b/i,
  /\bstarbucks\b/i,
  /\bpickle juice\b/i,
  /\blily of the desert\b/i,
  /\bcitrus magic\b/i,
  /\bnumi tea\b/i,
  /\bpomona'?s universal pectin\b/i,
  /\bcrofter'?s organic\b/i,
  /\bgaea\b/i,
  /\bposhi\b/i,
];

const EXPLICIT_TOPICAL_BRAND_PATTERNS = [
  /\babra therapeutics\b/i,
  /\bamish origins\b/i,
  /\baquaphor\b/i,
  /\baussie\b/i,
  /\bavalon organics\b/i,
  /\balba botanica\b/i,
  /\bartnaturals\b/i,
  /\balikay naturals\b/i,
  /\bphysicians formula\b/i,
  /\bmrs\.? meyer'?s clean day\b/i,
  /\btree hut\b/i,
  /\bsheamoisture\b/i,
  /\bsoftymo\b/i,
  /\bnellie'?s\b/i,
  /\bxylident\b/i,
  /\bzion health\b/i,
  /\bzum\b/i,
  /\bbelif\b/i,
  /\bblack radiance\b/i,
  /\bbriogeo\b/i,
  /\bcantu\b/i,
  /\bcovergirl\b/i,
  /\bderma e\b/i,
  /\bdove\b/i,
  /\bdr\.? teal'?s\b/i,
  /\belizavecca\b/i,
  /\bhadalabo\b/i,
  /\bhince\b/i,
  /\bkitsch\b/i,
  /\bl\'oréal\b/i,
  /\blavons\b/i,
  /\bmielle\b/i,
  /\bmissha\b/i,
  /\bmizon\b/i,
  /\bnot your mother'?s\b/i,
  /\brimmel london\b/i,
  /\bskinfood\b/i,
  /\bsoapbox\b/i,
  /\btonymoly\b/i,
  /\btree hut\b/i,
  /\bunleashia\b/i,
  /\bokay pure naturals\b/i,
  /\baroma naturals\b/i,
  /\banti monkey butt\b/i,
  /\beco style\b/i,
  /\bqueen helene\b/i,
  /\btoppik\b/i,
  /\bors\b/i,
  /\b2an\b/i,
  /\bb\.fresh\b/i,
  /\bsky organics\b/i,
  /\bsuavecito\b/i,
  /\bskin1004\b/i,
  /\breviva labs\b/i,
  /\brenpure\b/i,
  /\bmaria nila\b/i,
  /\bmarc anthony\b/i,
  /\bmaree\b/i,
  /\bm3\b/i,
  /\bmedicine mama\b/i,
  /\bsummer'?s eve\b/i,
  /\bonyx professional\b/i,
  /\bnair\b/i,
  /\bhappy elephant\b/i,
  /\badvanced clinicals\b/i,
  /\basutra\b/i,
  /\bearth'?s care\b/i,
  /\bembryolisse\b/i,
  /\bclarityrx\b/i,
  /\bcliganic\b/i,
  /\bcurls\b/i,
  /\bgold bond\b/i,
  /\bhi pro pac\b/i,
  /\binstanatural\b/i,
  /\bj\.?r\.? liggett'?s\b/i,
  /\bmild by nature\b/i,
  /\bnexxus\b/i,
  /\bpoo-?pourri\b/i,
  /\brainbow research\b/i,
  /\btressemmé\b/i,
  /\breplenix\b/i,
  /\bterrasil\b/i,
  /\bwhite egret\b/i,
  /\bseven minerals\b/i,
  /\bcosnori\b/i,
  /\bheritage store\b/i,
  /\bearth mama\b/i,
  /\bjason wu\b/i,
  /\btig[i|l]\b/i,
];

const EXPLICIT_NON_ORAL_DELIVERY_PATTERNS = [
  /\bpatch(?:es)?\b/i,
  /\btransdermal\b/i,
  /\btopical patch\b/i,
];

const EXPLICIT_OTC_MEDICAL_PATTERNS = [
  /\bhomeopathic\b/i,
  /\bcold\s*(?:\+|&|and)\s*flu\b/i,
  /\bcough\b/i,
  /\ballergy\b/i,
  /\bsinus\b/i,
  /\bexpectorant\b/i,
  /\bantacid\b/i,
  /\blaxative\b/i,
  /\bstool softener\b/i,
  /\bpain relief\b/i,
  /\bheartburn\b/i,
  /\bindigestion\b/i,
  /\bdiarrhea\b/i,
  /\bnasal\b/i,
  /\bdrowsy\b/i,
  /\bsleep aid\b/i,
  /\bmouth sore\b/i,
  /\bmedicated\b/i,
  /\bacetaminophen\b/i,
  /\bibuprofen\b/i,
  /\bdextromethorphan\b/i,
  /\bguaifenesin\b/i,
  /\bomeprazole\b/i,
  /\badvil\b/i,
  /\baleve\b/i,
  /\bclaritin\b/i,
  /\bmucinex\b/i,
  /\btylenol\b/i,
  /\bdulcolax\b/i,
  /\bdramamine\b/i,
  /\bunisom\b/i,
  /\bzantac\b/i,
  /\bxyzal\b/i,
  /\bzicam\b/i,
  /\balka-seltzer\b/i,
  /\bcoricidin\b/i,
  /\bvicks\b/i,
  /\bgoody'?s\b/i,
  /\becotrin\b/i,
  /\bbufferin\b/i,
  /\btums\b/i,
  /\bprilosec\b/i,
  /\btagamet\b/i,
  /\bnasacort\b/i,
  /\bphazyme\b/i,
];

const EXPLICIT_OTC_BRAND_PATTERNS = [
  /\bboiron\b/i,
  /\bhyland'?s naturals\b/i,
  /\bbayer\b/i,
  /\bpepto bismol\b/i,
  /\bmedinatura\b/i,
  /\bmiralax\b/i,
  /\bgravol\b/i,
  /\bcortizone 10\b/i,
  /\balli\b/i,
  /\bazo\b/i,
  /\bvivarin\b/i,
  /\bmylicon\b/i,
  /\bmidnite\b/i,
  /\boptimel\b/i,
  /\bsominex\b/i,
  /\bgenexa\b/i,
  /\bpre-seed\b/i,
  /\bphillip'?s\b/i,
  /\bbach\b/i,
  /\bmonistat\b/i,
];

const EXPLICIT_NON_SUPPLEMENT_UTILITY_BRAND_PATTERNS = [
  /\bdreft\b/i,
  /\bezy dose\b/i,
  /\bmolly'?s suds\b/i,
  /\bthe unscented company\b/i,
  /\bgrab green\b/i,
  /\bseventh generation\b/i,
  /\blight mountain\b/i,
  /\bpawfy\b/i,
  /\bspunky pup\b/i,
  /\bfryaway\b/i,
  /\biherb goods\b/i,
  /\bventure pal\b/i,
  /\bcrayola\b/i,
];

const MIXED_BRAND_TITLE_EXCLUSION_RULES = [
  {
    brandPattern: /\bcalifornia gold nutrition\b/i,
    titlePatterns: [/\bfreeze-?dried\b/i, /\b3-?seed blend\b/i, /\bchia seeds?\b/i, /\bparsley\b/i, /\bsaigon cinnamon\b/i],
    reason: "excluded_food_pantry",
  },
  {
    brandPattern: /\bnow foods\b/i,
    titlePatterns: [/\bcitric acid\b/i, /\bsprouting mix\b/i, /^now foods,\s+real food,/i],
    reason: "excluded_food_pantry",
  },
  {
    brandPattern: /\borgain\b/i,
    titlePatterns: [/\bnutritional shake\b/i],
    reason: "excluded_food_pantry",
  },
];

const classifyHumanSupplement = ({ brandName = null, title, categories = [], dosageForm = null }) => {
  const corpus = [
    normalizeText(brandName),
    normalizeText(title),
    normalizeText(dosageForm),
    ...toArray(categories).map((value) => normalizeText(value)),
  ].join(" | ");
  const brand = normalizeText(brandName);

  if (brand === "NOW Foods" && /\breal food\b/i.test(corpus)) {
    return { include: false, reason: "excluded_food_pantry", confidence: "high" };
  }

  for (const pattern of EXPLICIT_PET_PATTERNS) {
    if (pattern.test(corpus)) {
      return { include: false, reason: "excluded_pet", confidence: "high" };
    }
  }
  for (const pattern of EXPLICIT_TOPICAL_PATTERNS) {
    if (pattern.test(corpus)) {
      return { include: false, reason: "excluded_topical_personal_care", confidence: "high" };
    }
  }
  for (const pattern of EXPLICIT_TOPICAL_BRAND_PATTERNS) {
    if (pattern.test(corpus)) {
      return { include: false, reason: "excluded_topical_personal_care", confidence: "high" };
    }
  }
  for (const pattern of EXPLICIT_NON_ORAL_MEDICAL_PATTERNS) {
    if (pattern.test(corpus)) {
      return { include: false, reason: "excluded_non_oral_medical", confidence: "high" };
    }
  }
  for (const pattern of EXPLICIT_NON_ORAL_DELIVERY_PATTERNS) {
    if (pattern.test(corpus)) {
      return { include: false, reason: "excluded_non_oral_delivery", confidence: "high" };
    }
  }
  for (const pattern of EXPLICIT_OTC_MEDICAL_PATTERNS) {
    if (pattern.test(corpus)) {
      return { include: false, reason: "excluded_otc_medicine", confidence: "high" };
    }
  }
  for (const pattern of EXPLICIT_OTC_BRAND_PATTERNS) {
    if (pattern.test(corpus)) {
      return { include: false, reason: "excluded_otc_medicine", confidence: "high" };
    }
  }
  for (const pattern of EXPLICIT_NON_SUPPLEMENT_UTILITY_PATTERNS) {
    if (pattern.test(corpus)) {
      return { include: false, reason: "excluded_ambiguous_non_supplement", confidence: "high" };
    }
  }
  for (const pattern of EXPLICIT_NON_SUPPLEMENT_UTILITY_BRAND_PATTERNS) {
    if (pattern.test(corpus)) {
      return { include: false, reason: "excluded_ambiguous_non_supplement", confidence: "high" };
    }
  }
  for (const rule of MIXED_BRAND_TITLE_EXCLUSION_RULES) {
    if (!rule.brandPattern.test(corpus)) continue;
    if (rule.titlePatterns.some((pattern) => pattern.test(corpus))) {
      return { include: false, reason: rule.reason, confidence: "high" };
    }
  }
  for (const pattern of EXPLICIT_FOOD_PATTERNS) {
    if (pattern.test(corpus)) {
      return { include: false, reason: "excluded_food_pantry", confidence: "high" };
    }
  }
  for (const pattern of EXPLICIT_FOOD_BRAND_PATTERNS) {
    if (pattern.test(corpus)) {
      return { include: false, reason: "excluded_food_pantry", confidence: "high" };
    }
  }

  const hasPositiveTitleSignal = POSITIVE_TITLE_PATTERNS.some((pattern) => pattern.test(corpus));
  const hasPositiveCategorySignal = POSITIVE_CATEGORY_PATTERNS.some((pattern) => pattern.test(corpus));
  if (hasPositiveTitleSignal || hasPositiveCategorySignal) {
    return { include: true, reason: "human_supplement_signal_present", confidence: "medium" };
  }

  return { include: false, reason: "excluded_ambiguous_non_supplement", confidence: "low" };
};

const sortRows = (rows) =>
  [...rows].sort((left, right) => {
    const brandCmp = normalizeText(left.brandName).localeCompare(normalizeText(right.brandName));
    if (brandCmp !== 0) return brandCmp;
    return normalizeText(left.title).localeCompare(normalizeText(right.title));
  });

const main = async () => {
  const [stagingRaw, queue] = await Promise.all([
    readJson(STAGING_PATH),
    readJson(QUEUE_PATH),
  ]);
  const stagingRows = Array.isArray(stagingRaw) ? stagingRaw : (Array.isArray(stagingRaw?.products) ? stagingRaw.products : []);
  const index = buildStagingIndex(stagingRows);

  const included = [];
  const excluded = [];
  const exclusionCounts = {};

  for (const entry of Array.isArray(queue) ? queue : []) {
    const brandName = normalizeText(entry?.brandName ?? null);
    if (BRAND_FILTERS.length > 0 && !BRAND_FILTERS.some((brand) => normalizeLower(brand) === normalizeLower(brandName))) {
      continue;
    }

    const productId = normalizeText(entry?.productId ?? null);
    const barcode = normalizeText(entry?.barcode_gtin14 ?? null);
    const staged =
      (productId && index.byProductId.get(productId)) ||
      (barcode && index.byBarcode.get(barcode)) ||
      null;
    const title = normalizeText(staged?.title ?? entry?.title ?? null);
    const dosageForm = normalizeText(staged?.dosageForm ?? staged?.dosage_form ?? null) || null;
    const categories = toArray(staged?.categories);
    const knownProductUrls = chooseKnownUrls(staged);
    const humanScope = classifyHumanSupplement({ brandName, title, categories, dosageForm });

    if (!humanScope.include) {
      exclusionCounts[humanScope.reason] = (exclusionCounts[humanScope.reason] ?? 0) + 1;
      excluded.push({
        productId: entry?.productId ?? null,
        barcode_gtin14: entry?.barcode_gtin14 ?? null,
        brandName,
        title,
        coreMissingFields: entry?.coreMissingFields ?? [],
        sourceTypes: entry?.sourceTypes ?? [],
        categories,
        dosageForm,
        knownProductUrls,
        exclusionReason: humanScope.reason,
      });
      continue;
    }

    if (knownProductUrls.length === 0) {
      exclusionCounts.no_known_product_url = (exclusionCounts.no_known_product_url ?? 0) + 1;
      excluded.push({
        productId: entry?.productId ?? null,
        barcode_gtin14: entry?.barcode_gtin14 ?? null,
        brandName,
        title,
        coreMissingFields: entry?.coreMissingFields ?? [],
        sourceTypes: entry?.sourceTypes ?? [],
        categories,
        dosageForm,
        knownProductUrls,
        exclusionReason: "no_known_product_url",
      });
      continue;
    }

    const policy = decideOfficialFetchPolicy({
      knownProductUrls,
      coreMissingFields: entry?.coreMissingFields,
      sourceTypes: entry?.sourceTypes,
      hasUsIherbPage: entry?.hasUsIherbPage,
      highConfidenceUsProductPageReady: entry?.highConfidenceUsProductPageReady,
    });
    if (policy.mode === "manual_only" || policy.mode === "reader_only") {
      exclusionCounts[`excluded_policy_${policy.mode}`] = (exclusionCounts[`excluded_policy_${policy.mode}`] ?? 0) + 1;
      excluded.push({
        productId: entry?.productId ?? null,
        barcode_gtin14: entry?.barcode_gtin14 ?? null,
        brandName,
        title,
        coreMissingFields: entry?.coreMissingFields ?? [],
        sourceTypes: entry?.sourceTypes ?? [],
        categories,
        dosageForm,
        knownProductUrls,
        exclusionReason: `excluded_policy_${policy.mode}`,
      });
      continue;
    }

    included.push({
      ...entry,
      title,
      brandName,
      categories,
      dosageForm,
      knownProductUrls,
      humanScopeReason: humanScope.reason,
      humanScopeConfidence: humanScope.confidence,
      recommendedMode: policy.mode,
      policyReasons: policy.reasons,
    });
  }

  const sortedIncluded = sortRows(included);
  const brandRollup = Object.entries(
    sortedIncluded.reduce((acc, row) => {
      const brandName = normalizeText(row.brandName);
      if (!acc[brandName]) {
        acc[brandName] = {
          brandName,
          total: 0,
          missingFieldCounts: {},
        };
      }
      acc[brandName].total += 1;
      for (const field of toArray(row.coreMissingFields)) {
        const key = normalizeText(field);
        acc[brandName].missingFieldCounts[key] = (acc[brandName].missingFieldCounts[key] ?? 0) + 1;
      }
      return acc;
    }, {}),
  )
    .map(([, value]) => value)
    .sort((left, right) => right.total - left.total || left.brandName.localeCompare(right.brandName));

  const report = {
    schemaVersion: "scrapling_human_supplement_master_queue.v1",
    generatedAt: new Date().toISOString(),
    inputs: {
      stagingPath: STAGING_PATH,
      queuePath: QUEUE_PATH,
      brandFilters: BRAND_FILTERS,
    },
    summary: {
      totalQueueRows: Array.isArray(queue) ? queue.length : 0,
      includedRows: sortedIncluded.length,
      excludedRows: excluded.length,
      distinctBrands: [...new Set(sortedIncluded.map((row) => row.brandName))].length,
      exclusionCounts,
    },
    brandRollup,
    rows: sortedIncluded,
  };

  const reportPath = path.join(OUT_DIR, "human_supplement_master_queue.json");
  const rowsPath = path.join(OUT_DIR, "human_supplement_master_queue.rows.json");
  const excludedPath = path.join(OUT_DIR, "human_supplement_master_queue.excluded.json");
  const summaryMdPath = path.join(OUT_DIR, "human_supplement_master_queue.md");

  await writeJson(reportPath, report);
  await writeJson(rowsPath, sortedIncluded);
  await writeJson(excludedPath, sortRows(excluded));

  const md = [
    "# Human Supplement Master Queue",
    "",
    `- generatedAt: ${report.generatedAt}`,
    `- stagingPath: ${STAGING_PATH}`,
    `- queuePath: ${QUEUE_PATH}`,
    `- includedRows: ${report.summary.includedRows}`,
    `- excludedRows: ${report.summary.excludedRows}`,
    `- distinctBrands: ${report.summary.distinctBrands}`,
    "",
    "## Exclusion Counts",
    "",
    ...Object.entries(exclusionCounts)
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .map(([reason, count]) => `- ${reason}: ${count}`),
    "",
    "## Brand Rollup",
    "",
    ...brandRollup.map((brand) => {
      const missing = Object.entries(brand.missingFieldCounts)
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
        .map(([field, count]) => `${field}=${count}`)
        .join(", ");
      return `- ${brand.brandName}: total=${brand.total}${missing ? ` | missing=${missing}` : ""}`;
    }),
    "",
  ].join("\n");
  await writeText(summaryMdPath, `${md}\n`);

  console.log(
    JSON.stringify(
      {
        ok: true,
        outputs: {
          reportPath,
          rowsPath,
          excludedPath,
          summaryMdPath,
        },
        summary: report.summary,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
