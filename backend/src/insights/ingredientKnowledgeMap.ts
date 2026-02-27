const normalize = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const includesAny = (value: string, tokens: string[]): boolean => tokens.some((token) => value.includes(token));

type Rule = {
  tokens: string[];
  text: string;
};

const RULES: Rule[] = [
  // Vitamins and vitamin-like nutrients
  { tokens: ["vitamin d", "d3", "d2", "cholecalciferol", "ergocalciferol"], text: "Commonly used to support bone health and normal immune function." },
  { tokens: ["vitamin c", "ascorbic", "ester c"], text: "Commonly used to support antioxidant defenses and immune health." },
  { tokens: ["vitamin e", "tocopherol", "tocotrienol", "tocotrienols"], text: "Commonly used to support antioxidant protection." },
  { tokens: ["vitamin a", "retinol", "beta carotene", "retinyl"], text: "Commonly used to support vision and immune health." },
  { tokens: ["vitamin k", "k1", "k2", "phylloquinone", "menaquinone"], text: "Commonly used to support normal blood clotting and bone health." },
  { tokens: ["folate", "folic acid", "methylfolate", "vitamin b9"], text: "Commonly used to support healthy cell growth and red blood cell production." },
  { tokens: ["b12", "cobalamin", "methylcobalamin", "cyanocobalamin"], text: "Commonly used to support nerve function and red blood cell production." },
  { tokens: ["b6", "pyridox", "vitamin b6"], text: "Commonly used to support amino acid metabolism and nerve function." },
  { tokens: ["thiamin", "thiamine", "vitamin b1"], text: "Commonly used to support energy metabolism and nervous system function." },
  { tokens: ["riboflavin", "vitamin b2"], text: "Commonly used to support energy metabolism and antioxidant pathways." },
  { tokens: ["niacin", "niacinamide", "nicotinamide", "vitamin b3"], text: "Commonly used to support cellular energy metabolism." },
  { tokens: ["pantothenic acid", "vitamin b5", "pantothenate"], text: "Commonly used to support energy metabolism and adrenal-related pathways." },
  { tokens: ["biotin"], text: "Commonly used to support hair, skin, nail, and energy metabolism pathways." },
  { tokens: ["nicotinamide riboside", "nr"], text: "Commonly used to support NAD+ metabolism and cellular energy pathways." },
  { tokens: ["nicotinamide mononucleotide", "nmn"], text: "Commonly used to support NAD+ precursor pathways and healthy aging routines." },
  { tokens: ["citicoline", "cdp choline", "choline"], text: "Commonly used to support cognitive performance and methylation-related pathways." },

  // Minerals and trace elements
  { tokens: ["calcium"], text: "Commonly used to support bone and muscle function." },
  { tokens: ["magnesium"], text: "Commonly used to support muscle, nerve, and energy-related functions." },
  { tokens: ["zinc"], text: "Commonly used to support immune function and normal wound healing." },
  { tokens: ["iron", "ferrous"], text: "Commonly used to support oxygen transport and red blood cell production." },
  { tokens: ["selenium"], text: "Commonly used to support antioxidant enzymes and thyroid health." },
  { tokens: ["iodine"], text: "Commonly used to support thyroid hormone production." },
  { tokens: ["chromium"], text: "Commonly used to support normal glucose metabolism." },
  { tokens: ["potassium"], text: "Commonly used to support fluid balance and muscle function." },
  { tokens: ["copper"], text: "Commonly used to support connective tissue and antioxidant enzyme function." },
  { tokens: ["manganese"], text: "Commonly used to support connective tissue and antioxidant pathways." },
  { tokens: ["molybdenum"], text: "Commonly used to support sulfur amino acid and enzyme cofactor pathways." },
  { tokens: ["boron"], text: "Commonly used to support bone and mineral metabolism." },

  // Essential fats and lipid nutrients
  { tokens: ["omega 3", "omega-3", "epa", "dha", "fish oil", "krill"], text: "Commonly used to support cardiovascular and brain health." },
  { tokens: ["conjugated linoleic", "cla"], text: "Commonly used to support body composition goals alongside diet and training." },
  { tokens: ["red yeast rice"], text: "Commonly used to support healthy lipid profiles as part of diet and lifestyle care." },

  // Gut health and digestive support
  { tokens: ["probiotic", "probiotics", "lactobacillus", "bifidobacter"], text: "Commonly used to support digestive and gut microbiome health." },
  { tokens: ["bacillus coagulans"], text: "Commonly used as a shelf-stable probiotic strain for digestive support." },
  { tokens: ["prebiotic", "inulin", "fiber", "psyllium"], text: "Commonly used to support digestive regularity and gut health." },
  { tokens: ["galactooligosaccharides", "gos"], text: "Commonly used as a prebiotic fiber to support beneficial gut bacteria." },
  { tokens: ["partially hydrolyzed guar gum", "phgg", "guar gum"], text: "Commonly used to support bowel regularity and gentle prebiotic intake." },
  { tokens: ["resistant dextrin"], text: "Commonly used as a soluble fiber to support digestive comfort and regularity." },
  { tokens: ["resistant starch"], text: "Commonly used as a prebiotic carbohydrate to support gut microbiome balance." },
  { tokens: ["papain", "papaya enzyme"], text: "Commonly used as a digestive enzyme to support protein digestion." },
  { tokens: ["bromelain"], text: "Commonly used as a proteolytic enzyme for digestion and post-exertion comfort." },
  { tokens: ["serrapeptase"], text: "Commonly used as a systemic enzyme in recovery-focused supplement routines." },
  { tokens: ["dgl licorice", "deglycyrrhizinated licorice"], text: "Commonly used to support upper digestive comfort without glycyrrhizin." },

  // Performance and amino acid support
  { tokens: ["creatine"], text: "Commonly used to support high-intensity exercise performance." },
  { tokens: ["beta alanine"], text: "Commonly used to support training capacity during high-intensity exercise." },
  { tokens: ["betaine"], text: "Commonly used to support strength output and cellular hydration in training contexts." },
  { tokens: ["hmb", "hydroxy methyl butyrate"], text: "Commonly used to support muscle recovery and training adaptation." },
  { tokens: ["citrulline malate"], text: "Commonly used to support blood flow and exercise performance." },
  { tokens: ["arginine alpha ketoglutarate", "aakg"], text: "Commonly used in performance formulas to support nitric oxide pathways." },
  { tokens: ["l arginine", "arginine"], text: "Commonly used to support nitric oxide pathways and circulation." },
  { tokens: ["l methionine", "methionine"], text: "Commonly used to support methylation and sulfur amino acid pathways." },
  { tokens: ["l ornithine", "ornithine"], text: "Commonly used to support exercise recovery and nitrogen handling." },
  { tokens: ["l valine", "valine"], text: "Commonly used as a branched-chain amino acid in recovery-focused formulas." },
  { tokens: ["carnosine"], text: "Commonly used to support muscle buffering and cellular antioxidant defense." },
  { tokens: ["d ribose", "ribose"], text: "Commonly used to support cellular energy replenishment pathways." },
  { tokens: ["protein", "whey", "casein"], text: "Commonly used to support muscle recovery and daily protein intake." },
  { tokens: ["electrolyte"], text: "Commonly used to support hydration and mineral replenishment." },

  // Brain, mood, and sleep support
  { tokens: ["coq10", "coenzyme q10", "ubiquinone", "ubiquinol"], text: "Commonly used to support cellular energy production." },
  { tokens: ["alpha lipoic acid", "alpha-lipoic acid", "ala", "r lipoic acid"], text: "Commonly used to support antioxidant recycling and cellular energy metabolism." },
  { tokens: ["gaba"], text: "Commonly used to support relaxation and sleep readiness." },
  { tokens: ["melatonin"], text: "Commonly used to support sleep timing and onset." },
  { tokens: ["theanine", "l theanine"], text: "Commonly used to support calm focus." },
  { tokens: ["lavender"], text: "Commonly used to support relaxation and stress management." },
  { tokens: ["lemon balm", "melissa"], text: "Commonly used to support calm mood and sleep quality." },
  { tokens: ["passionflower", "passiflora"], text: "Commonly used to support relaxation and bedtime routines." },
  { tokens: ["chamomile", "matricaria"], text: "Commonly used to support calm digestion and bedtime comfort." },
  { tokens: ["valerian", "valeriana"], text: "Commonly used to support sleep quality and nighttime relaxation." },
  { tokens: ["st john", "hypericum"], text: "Commonly used to support mood balance; medication interaction screening is important." },
  { tokens: ["kava"], text: "Commonly used to support relaxation; use cautiously and follow safety guidance." },
  { tokens: ["saffron", "crocus sativus"], text: "Commonly used to support mood and stress resilience." },
  { tokens: ["same", "sam-e", "s adenosyl methionine"], text: "Commonly used to support mood and joint comfort in selected adults." },

  // Joint, connective tissue, and inflammatory response support
  { tokens: ["collagen", "collagen peptides"], text: "Commonly used to support connective tissue and skin structure." },
  { tokens: ["curcumin", "turmeric", "curcuma"], text: "Commonly used to support normal inflammatory response." },
  { tokens: ["glucosamine"], text: "Commonly used to support joint comfort and cartilage health." },
  { tokens: ["chondroitin"], text: "Commonly used to support joint structure and comfort." },
  { tokens: ["msm", "methylsulfonylmethane"], text: "Commonly used to support joint comfort and connective tissue function." },
  { tokens: ["boswellia"], text: "Commonly used to support joint comfort and inflammatory balance." },
  { tokens: ["quercetin"], text: "Commonly used for antioxidant support and seasonal immune comfort." },
  { tokens: ["resveratrol"], text: "Commonly used for antioxidant support and healthy aging routines." },
  { tokens: ["glutathione"], text: "Commonly used to support cellular antioxidant defense systems." },
  { tokens: ["n acetylcysteine", "nac"], text: "Commonly used to support antioxidant and glutathione-related pathways." },

  // Botanical and phytonutrient support
  { tokens: ["ashwagandha", "withania"], text: "Commonly used to support stress resilience and sleep quality." },
  { tokens: ["astragalus"], text: "Commonly used to support immune resilience and vitality." },
  { tokens: ["american ginseng", "panax quinquefolius", "ginseng"], text: "Commonly used to support energy and stress adaptation." },
  { tokens: ["ginger", "zingiber"], text: "Commonly used to support digestive comfort and nausea management." },
  { tokens: ["garlic", "allium sativum"], text: "Commonly used to support cardiovascular and immune health." },
  { tokens: ["olive leaf", "olea europaea"], text: "Commonly used to support antioxidant and immune pathways." },
  { tokens: ["grape seed", "vitis vinifera"], text: "Commonly used to support vascular and antioxidant health." },
  { tokens: ["green tea", "egcg", "camellia sinensis"], text: "Commonly used to support antioxidant metabolism and healthy weight routines." },
  { tokens: ["milk thistle", "silymarin"], text: "Commonly used to support liver antioxidant pathways." },
  { tokens: ["artichoke extract"], text: "Commonly used to support digestion and bile-related comfort." },
  { tokens: ["gymnema"], text: "Commonly used in metabolic support formulas for glucose-focused routines." },
  { tokens: ["pygeum"], text: "Commonly used to support prostate and urinary comfort." },
  { tokens: ["aloe vera"], text: "Commonly used to support digestive and skin comfort." },
  { tokens: ["slippery elm"], text: "Commonly used to support gastrointestinal and throat soothing comfort." },
  { tokens: ["royal jelly"], text: "Commonly used as a nutrient-dense bee-derived wellness supplement." },
  { tokens: ["turkey tail mushroom"], text: "Commonly used to support immune modulation and gut-immune balance." },
  { tokens: ["tribulus", "tribulus terrestris"], text: "Commonly used in performance and vitality-focused supplement routines." },
  { tokens: ["cinnamon extract", "cinnamon"], text: "Commonly used to support glucose metabolism in diet-focused plans." },

  // Specialty compounds and functional ingredients
  { tokens: ["spirulina"], text: "Commonly used as a nutrient-dense algae source for daily wellness support." },
  { tokens: ["chlorella"], text: "Commonly used as a green algae source for nutrient and antioxidant intake." },
  { tokens: ["zeaxanthin"], text: "Commonly used to support macular and visual antioxidant health." },
  { tokens: ["yeast beta glucan", "beta glucan"], text: "Commonly used to support immune readiness and resilience." },
  { tokens: ["colostrum"], text: "Commonly used to support gut barrier and immune function." },

  // Category-level catch-all support lines
  { tokens: ["multivitamin"], text: "Commonly used to fill potential micronutrient gaps in daily intake." },
  { tokens: ["multimineral"], text: "Commonly used to support broad micronutrient coverage." },
  { tokens: ["joint support"], text: "Commonly used to support joint comfort and mobility routines." },
  { tokens: ["sleep support"], text: "Commonly used to support sleep initiation and nighttime recovery." },
  { tokens: ["immune support"], text: "Commonly used to support day-to-day immune function." },
  { tokens: ["liver support"], text: "Commonly used to support liver antioxidant and detox pathways." },
  { tokens: ["eye health"], text: "Commonly used to support retinal and visual antioxidant pathways." },
  { tokens: ["brain support"], text: "Commonly used to support cognitive performance and mental clarity." },

  // Legacy high-use items
  { tokens: ["caffeine"], text: "Commonly used to support alertness and exercise performance." },
  { tokens: ["taurine"], text: "Commonly used to support exercise performance and cellular hydration." },
];

export const getIngredientFallbackText = (name: string): string => {
  const normalized = normalize(name);
  if (!normalized) {
    return "A common supplement ingredient. Scan Supplement Facts for specific analysis.";
  }

  for (const rule of RULES) {
    if (includesAny(normalized, rule.tokens)) return rule.text;
  }

  return "A common supplement ingredient. Scan Supplement Facts for specific analysis.";
};
