// read-contract — reads a signed construction contract for the STB Orders page.
//
//   POST /functions/v1/read-contract      header  x-stb-token: <CONTRACT_TOKEN>
//   body  { pages: [{ n, text? , image? }], catalog: [ ... ] }
//   →     { ok: true, result: { house, categories, otherAllowances, warnings } }
//
// Pages with a text layer come in as `text`; photographed / scanned pages come in as a
// base64 JPEG in `image`. Claude reads them and returns the figures through a tool call, so
// the answer is always structured JSON. The page shows it for a person to check; nothing is
// saved by this function, and it never touches the database.
//
// Secrets (Edge Functions → Secrets):
//   ANTHROPIC_API_KEY   your Anthropic key
//   CONTRACT_TOKEN      any long random string; the Orders page sends it so strangers cannot
//                       spend your AI credits. Turn "Verify JWT" OFF for this function.
//   ANTHROPIC_MODEL     optional, defaults to claude-sonnet-5-5

const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-5-5';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, x-stb-token, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (obj: unknown, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });

const NUM = { type: ['number', 'null'] };
const STR = { type: ['string', 'null'] };

const TOOL = {
  name: 'record_contract',
  description: 'Record the figures read from the construction contract.',
  input_schema: {
    type: 'object',
    required: ['house', 'categories', 'otherAllowances', 'warnings'],
    properties: {
      house: {
        type: 'object',
        required: ['client', 'address', 'contractPrice'],
        properties: {
          client: STR, address: STR, legalDescription: STR,
          livingSqft: NUM, totalSqft: NUM, contractPrice: NUM, deposit: NUM, daysToBuild: NUM, contractDate: STR,
        },
      },
      categories: {
        type: 'array',
        description: 'One entry for EVERY category in the catalog, in catalog order.',
        items: {
          type: 'object',
          required: ['id', 'status', 'evidence', 'needs'],
          properties: {
            id: { type: 'string' },
            status: { type: 'string', enum: ['priced', 'not_mentioned', 'excluded'] },
            budgetType: { type: ['string', 'null'], enum: ['amount', 'percent', 'perUnit', 'perItem', 'open', null] },
            amount: NUM, percent: NUM, rate: NUM, qty: NUM,
            lines: {
              type: 'array',
              items: {
                type: 'object',
                required: ['item', 'basis'],
                properties: {
                  item: { type: 'string', description: 'Exactly one of the item names listed for this category.' },
                  basis: { type: 'string', enum: ['amount', 'unit', 'sqft'] },
                  rate: NUM, amount: NUM, qty: NUM, sqft: NUM, cap: NUM, note: STR,
                },
              },
            },
            evidence: { type: 'string', description: 'Short quote from the contract, with page number.' },
            needs: { type: 'array', items: { type: 'string' }, description: 'Numbers the contract does not give that a person must add (e.g. "number of doors").' },
          },
        },
      },
      otherAllowances: {
        type: 'array',
        description: 'Allowances in the contract that do not belong to any catalog category.',
        items: { type: 'object', required: ['label', 'detail'], properties: { label: { type: 'string' }, detail: { type: 'string' } } },
      },
      warnings: { type: 'array', items: { type: 'string' }, description: 'Anything odd, unreadable, conflicting or missing.' },
    },
  },
};

function systemPrompt(catalog: unknown) {
  return `You read signed residential construction contracts for South Texas Builders and record the allowance figures so an office worker can check them. Accuracy matters more than completeness: these numbers drive budget alerts.

RULES
- Report only what the contract prints. Never guess, never use typical figures. If a number is not there, use null and say what is missing in "needs".
- Fill-in form fields (day, month, year, owner names, price, deposit, days to build) may appear as loose values in the text. Match each one to the blank it fills by its position in the page.
- The house facts often sit in the exhibit ("Exhibit A"), not in the contract body: street address, square footage, price breakdown. Take the physical street address, not the legal description.
- contractPrice is the final TOTAL contract price, not a component.
- A "% of sales price" or "% of contract price" allowance is budgetType "percent" with "percent" set (1.5 means 1.5%).
- One dollar figure for the whole category is "amount". A rate times a count ("$22 each") is "perUnit" with rate, and qty only if the contract states the count.
- When a category has no single figure but its lines are priced separately, use "perItem" and put each line in "lines". A category that has a percentage AND separately priced lines (for example plumbing: a percentage, plus toilets by the piece and a water heater) is "percent" with extra "lines".
- Line basis: "sqft" = a rate per square foot (set "cap" when the contract limits how many square feet it covers, e.g. "50 sq. ft."); "unit" = a rate each; "amount" = its own dollar figure.
- "Living area only" means the square footage is the living area figure in the document; you may use that stated figure as "sqft". Otherwise leave counts and areas null and list them in "needs".
- Use the category's "item" names EXACTLY as given in the catalog. If a price does not fit any listed item, put it in otherAllowances.
- status: "priced" = the contract gives a figure; "excluded" = the contract says it is not included / not applicable; "not_mentioned" = nothing about it (for example no garage door line).
- Some pages are photographs of paper and may be skewed or faint; read them carefully. If something is illegible, say so in warnings.
- Do not repeat personal data beyond client name, address and the requested numbers. Ignore signatures.

CATALOG (every category must appear in your answer):
${JSON.stringify(catalog)}

Answer only by calling record_contract.`;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);

  const expected = Deno.env.get('CONTRACT_TOKEN') ?? '';
  if (!expected || (req.headers.get('x-stb-token') ?? '') !== expected) return json({ error: 'Wrong or missing contract key.' }, 401);
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  if (!apiKey) return json({ error: 'ANTHROPIC_API_KEY is not set on the function.' }, 500);

  let body: any;
  try { body = await req.json(); } catch { return json({ error: 'Bad request body.' }, 400); }
  const pages = Array.isArray(body?.pages) ? body.pages : [];
  const catalog = Array.isArray(body?.catalog) ? body.catalog : [];
  if (!pages.length || !catalog.length) return json({ error: 'Send pages and catalog.' }, 400);
  if (pages.length > 30) return json({ error: 'Too many pages (30 max).' }, 400);

  const content: any[] = [];
  let images = 0;
  for (const p of pages) {
    const n = Number(p?.n) || 0;
    if (typeof p?.image === 'string' && p.image) {
      if (++images > 12) return json({ error: 'Too many photographed pages (12 max).' }, 400);
      if (p.image.length > 4_000_000) return json({ error: `Page ${n} image is too large.` }, 400);
      content.push({ type: 'text', text: `--- PAGE ${n} (photographed page) ---` });
      content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: p.image } });
    } else if (typeof p?.text === 'string' && p.text.trim()) {
      content.push({ type: 'text', text: `--- PAGE ${n} ---\n${p.text.slice(0, 20000)}` });
    }
  }
  content.push({ type: 'text', text: 'Read the contract above and call record_contract.' });

  let res: Response;
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: MODEL, max_tokens: 6000,
        system: systemPrompt(catalog),
        tools: [TOOL], tool_choice: { type: 'tool', name: 'record_contract' },
        messages: [{ role: 'user', content }],
      }),
    });
  } catch (e) { return json({ error: 'Could not reach the AI service: ' + (e as Error).message }, 502); }

  const out = await res.json().catch(() => null);
  if (!res.ok) return json({ error: 'The AI service said: ' + (out?.error?.message ?? res.status) }, 502);
  const tool = (out?.content ?? []).find((c: any) => c.type === 'tool_use' && c.name === 'record_contract');
  if (!tool?.input) return json({ error: 'The AI did not return the figures. Try again.' }, 502);
  return json({ ok: true, result: tool.input, model: MODEL, usage: out?.usage ?? null });
});
