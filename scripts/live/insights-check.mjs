// Live check of the insights model contract (pass 3, A6). NOT run in CI: it calls the real model.
//
//   LLM_API_KEY=... npx vite-node scripts/live/insights-check.mjs [--lang it] [--chat] [--raw]
//
// Env (same names the server uses): LLM_API_KEY (required), LLM_BASE_URL (default https://api.deepseek.com),
// LLM_MODEL (default deepseek-chat). The key is read from the environment only; nothing is written to disk.
//
// What it does, with synthetic owner-like data only (src/services/__fixtures__/ownerLike.js, never real history):
//   1. computes the opportunities and the v2 aggregates exactly as the Insights page does,
//   2. passes the request through the outbound privacy filter (aiOutbound.sanitizeBody) and the server's input schema,
//   3. calls the model with the production prompt, token limit and temperature (DeepSeek thinking stays disabled: api/_lib/llm.js),
//   4. runs the server's own checks (narrativeSchema + finalizeNarrative) and prints what was kept and what was dropped,
//   5. with --chat, does the same for the save_money and afford chat packs.
// Exit code 0 when the answer is usable and nothing invented survived; 1 otherwise.
import { ownerLike, TODAY } from '../../src/services/__fixtures__/ownerLike.js';
import { computeOpportunities } from '../../src/services/savingsOpportunities.js';
import { buildAggregates } from '../../src/services/insightsAggregates.js';
import { buildInsightsRequest } from '../../src/services/insightsApi.js';
import { buildEvidencePack, unsupportedFigures } from '../../src/services/evidencePack.js';
import { sanitizeBody } from '../../src/services/aiOutbound.js';
import { currentCyclePeriod, normalizeConfig } from '../../src/utils/payCycle.js';
import { inputSchema, narrativeSchema, finalizeNarrative, MAX_TOKENS } from '../../api/insights.js';
import { inputSchema as chatSchema } from '../../api/chat.js';
import { chat } from '../../api/_lib/llm.js';
import { loadPrompt, fillPrompt } from '../../api/_lib/prompts.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const language = opt('lang', 'en');

if (!process.env.LLM_API_KEY) {
    console.error('LLM_API_KEY is not set. Run: LLM_API_KEY=... npx vite-node scripts/live/insights-check.mjs');
    process.exit(2);
}
process.env.LLM_BASE_URL ||= 'https://api.deepseek.com';
process.env.LLM_MODEL ||= 'deepseek-chat';

const line = (title) => console.log(`\n=== ${title} ${'='.repeat(Math.max(0, 70 - title.length))}`);
let failed = false;
const fail = (msg) => {
    failed = true;
    console.log(`FAIL  ${msg}`);
};

const d = ownerLike();
const period = currentCyclePeriod(normalizeConfig(d.config), new Date(`${TODAY}T12:00:00Z`));
const opp = computeOpportunities({ ...d, period, dismissed: { 'subscription_review:spotify': '2026-11-01' } });
const aggregates = buildAggregates({ ...d, month: period, opportunities: opp.top, dismissed: opp.dismissed });
const sent = sanitizeBody('insights', buildInsightsRequest({ aggregates, language }));

line('1. request');
const parsedInput = inputSchema.safeParse(sent);
console.log(`period ${period.start}..${period.end} (today ${TODAY}), ${d.transactions.length} synthetic transactions, language ${language}`);
console.log(`aggregates: ${JSON.stringify(sent.aggregates).length} bytes, ${sent.aggregates.opportunities.length} opportunities, ${sent.aggregates.findings.length} findings, ${sent.aggregates.dismissed.length} dismissed`);
console.log(`server input schema: ${parsedInput.success ? 'ok' : `REJECTED ${JSON.stringify(parsedInput.error.issues)}`}`);
if (!parsedInput.success) fail('the request does not pass the server schema');
for (const o of sent.aggregates.opportunities) console.log(`  ${o.id} ${o.oppKind.padEnd(26)} ${String(o.merchant || o.category || "").padEnd(22)} ${String(o.monthlySaving).padStart(7)}/month  ${o.confidence}`);

line('2. model');
const started = Date.now();
const result = await chat({
    messages: [
        { role: 'system', content: fillPrompt(loadPrompt('insights'), { LANGUAGE: language }) },
        { role: 'user', content: `Aggregates (json):\n${JSON.stringify(sent.aggregates)}` },
    ],
    json: true,
    maxTokens: MAX_TOKENS,
    temperature: 0.3,
});
console.log(`model ${result.model}, ${Date.now() - started} ms, tokens ${JSON.stringify(result.usage)}`);
if (flag('raw')) console.log(JSON.stringify(result.data, null, 2));
if (result.usage?.completionTokens >= MAX_TOKENS) fail(`the answer used the whole token limit (${MAX_TOKENS}): it was probably cut off`);

line('3. server checks');
const parsed = narrativeSchema.safeParse(result.data);
if (!parsed.success) {
    fail(`the answer does not match the output schema: ${JSON.stringify(parsed.error.issues)}`);
} else {
    const { payload, dropped } = finalizeNarrative(parsed.data, sent.aggregates);
    console.log(`verdict   ${payload.verdict ?? '(dropped)'}`);
    console.log(`summary   ${payload.summary ?? '(dropped or none)'}`);
    for (const o of payload.opportunities) console.log(`${o.id}  ${o.explanation}\n    -> ${o.howTo ?? '(no how-to)'}`);
    for (const w of payload.wins) console.log(`win   [${w.ref ?? '-'}] ${w.text}`);
    for (const w of payload.watchouts) console.log(`watch [${w.ref ?? '-'}] ${w.text}`);
    for (const q of payload.questions) console.log(`ask   ${q}`);
    console.log(`\ndropped by the server: ${dropped.length}`);
    for (const x of dropped) console.log(`  ${x.where}: ${x.reason}${x.figures ? ` (${x.figures.join(', ')})` : ''}`);
    const missing = sent.aggregates.opportunities.filter((o) => !payload.opportunities.some((p) => p.id === o.id)).map((o) => o.id);
    if (!payload.verdict) fail('no usable verdict');
    if (missing.length) fail(`no usable explanation for ${missing.join(', ')}`);
    const text = JSON.stringify(payload).toLowerCase();
    if (/spotify/.test(text)) fail('a dismissed suggestion (Spotify) was brought up again');
    if (/(affitto|rent|enel)[^.]{0,60}(subscription|abbonament)/.test(text)) fail('a fixed cost was called a subscription');
}

if (flag('chat')) {
    for (const question of ['Where can I cut this period?', 'Can I afford 200?', 'What do I spend on groceries per cycle on average?']) {
        line(`chat: ${question}`);
        const { pack } = buildEvidencePack({ ...d, period, question });
        const body = sanitizeBody('chat', { evidence: pack, messages: [{ role: 'user', content: question }], language });
        const ok = chatSchema.safeParse(body);
        console.log(`intent ${pack.intent}, ${pack.facts.length} facts, server schema ${ok.success ? 'ok' : `REJECTED ${JSON.stringify(ok.error.issues)}`}`);
        if (!ok.success) {
            fail(`chat request for "${question}" does not pass the server schema`);
            continue;
        }
        const out = await chat({
            messages: [
                { role: 'system', content: fillPrompt(loadPrompt('chat-evidence'), { LANGUAGE: language }) },
                { role: 'system', content: `Evidence pack (json, read-only; every number was computed by the app):\n${JSON.stringify(body.evidence)}` },
                { role: 'user', content: question },
            ],
            json: true,
            maxTokens: 1500,
            temperature: 0.2,
        });
        console.log(out.data?.answer);
        console.log(`citations ${JSON.stringify(out.data?.citations)}  action ${JSON.stringify(out.data?.suggestedAction)}`);
        const invented = unsupportedFigures(out.data?.answer || '', pack);
        if (invented.length) fail(`figures not in the facts: ${invented.join(', ')}`);
        if (!Array.isArray(out.data?.citations) || out.data.citations.length === 0) fail('no citations');
    }
}

line(failed ? 'RESULT: FAILED' : 'RESULT: OK');
process.exit(failed ? 1 : 0);
