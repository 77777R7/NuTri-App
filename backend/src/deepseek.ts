
const PROMPT_EFFICACY = `
You are NuTri-AI. Analyze ONLY the EFFICACY of this supplement based on the search results.
OUTPUT JSON ONLY. NO MARKDOWN.
Structure:
{
  "score": 0-10,
  "verdict": "Short punchy verdict (max 10 words)",
  "benefits": ["Benefit 1", "Benefit 2"],
  "activeIngredients": [{"name": "string", "amount": "string"}],
  "mechanisms": [{"name": "string", "amount": "string", "fill": 0-100}]
}
Keep it concise. If dosage is missing, state it.
`;

const PROMPT_SAFETY = `
You are NuTri-AI. Analyze ONLY the SAFETY of this supplement based on the search results.
OUTPUT JSON ONLY. NO MARKDOWN.
Structure:
{
  "score": 0-10,
  "verdict": "Short safety verdict",
  "risks": ["Risk 1", "Risk 2"],
  "redFlags": ["Severe Warning 1"],
  "recommendation": "General safety advice"
}
Be strict about allergens and proprietary blends.
`;

const PROMPT_USAGE = `
You are NuTri-AI. Analyze ONLY the USAGE, VALUE, and SOCIAL perception.
OUTPUT JSON ONLY. NO MARKDOWN.
Structure:
{
  "usage": {
    "summary": "How to take",
    "timing": "Best time",
    "withFood": boolean
  },
  "value": {
    "score": 0-10,
    "verdict": "Value verdict",
    "analysis": "Price/quality analysis"
  },
  "social": {
    "score": 0-5,
    "summary": "Social perception"
  }
}
If price is missing, do not guess specific numbers.
`;

export async function fetchAnalysisSection(
  section: 'efficacy' | 'safety' | 'usage',
  context: string,
  model: string,
  apiKey: string
) {
  let systemPrompt = "";
  if (section === 'efficacy') systemPrompt = PROMPT_EFFICACY;
  if (section === 'safety') systemPrompt = PROMPT_SAFETY;
  if (section === 'usage') systemPrompt = PROMPT_USAGE;

  try {
    const response = await fetch("https://api.deepseek.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: model, // 务必使用 deepseek-chat (V3)
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: context }
        ],
        temperature: 0.3,
        stream: false,
        max_tokens: 600 // 限制每个分段的长度，保证速度
      })
    });

    if (!response.ok) throw new Error(`DeepSeek API error: ${response.status}`);

    const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content || "{}";

    // 简单的 JSON 提取逻辑
    const jsonStr = content.replace(/```json/g, "").replace(/```/g, "").trim();
    return JSON.parse(jsonStr);

  } catch (error) {
    console.error(`Error fetching ${section}:`, error);
    return null; // 返回 null 让前端显示 fallback 或骨架
  }
}
