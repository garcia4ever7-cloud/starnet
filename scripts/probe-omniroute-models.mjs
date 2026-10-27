#!/usr/bin/env node
/* scripts/probe-omniroute-models.mjs — measure which OmniRoute models can actually do TOOL CALLING.
 *
 * STATION_FIELD_NOTES §6 rule: never rank free models from their names. This sends one real
 * tool-use request per model through the local OmniRoute proxy and reports what came back.
 * Cloudflare Workers AI free tier on the owner's own account; no paid provider is contacted.
 *
 *   node scripts/probe-omniroute-models.mjs            # probe the default candidate list
 *   node scripts/probe-omniroute-models.mjs a/b c/d    # probe specific model ids
 */
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.OMNIROUTE_BASE_URL || 'http://127.0.0.1:20128/v1';
const KEY = process.env.OMNIROUTE_API_KEY
  || readFileSync(join(homedir(), '.omniroute', 'client_api_key.local'), 'utf8').trim();

const DEFAULT_CANDIDATES = [
  'cf/@cf/zai-org/glm-5.3',
  'cf/@cf/zai-org/glm-5.3-flash',
  'cf/@cf/zai-org/glm-5.2',
  'cf/@cf/zai-org/glm-4.7-flash',
  'cf/@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  'cf/@cf/meta/llama-4-scout-17b-16e-instruct',
  'cf/@cf/qwen/qwen3-30b-a3b-fp8',
  'cf/@cf/qwen/qwen2.5-coder-32b-instruct',
  'cf/@cf/qwen/qwen3.8-27b',
  'cf/@cf/google/gemma-4-26b-a4b-it',
  'cf/@cf/nvidia/nemotron-3-120b-a12b',
  'cf/@cf/deepseek-ai/deepseek-v4-flash-0731',
  'cf/@cf/deepseek-ai/deepseek-v4-pro-0813',
  'cf/@cf/deepseek-ai/deepseek-v4.1-flash-1017',
  'cf/@cf/openai/gpt-oss-120b',
  'cf/@cf/openai/gpt-oss-20b',
  'cf/@cf/mistralai/mistral-small-3.1-24b-instruct',
  'cf/@cf/moonshotai/kimi-k2.7-code',
  'cf/@cf/moonshotai/kimi-k2.6',
  'cf/@cf/meta/llama-3.1-8b-instruct-fp8',
];

const TOOL = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Get the current weather for a city.',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string', description: 'City name' } },
      required: ['city'],
    },
  },
};

async function probe(model) {
  const started = Date.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90_000);
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST',
      signal: ctl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${KEY}` },
      body: JSON.stringify({
        model,
        max_tokens: 256,
        messages: [
          { role: 'user', content: 'What is the weather in Paris? Use the get_weather tool.' },
        ],
        tools: [TOOL],
        tool_choice: 'auto',
      }),
    });
    const ms = Date.now() - started;
    const text = await res.text();
    if (!res.ok) {
      let why = text.slice(0, 160).replace(/\s+/g, ' ');
      return { model, ms, ok: false, tools: false, note: `http ${res.status} — ${why}` };
    }
    let body;
    try { body = JSON.parse(text); } catch { return { model, ms, ok: false, tools: false, note: 'non-json response' }; }
    const msg = body?.choices?.[0]?.message || {};
    const calls = msg.tool_calls || [];
    if (calls.length) {
      const fn = calls[0]?.function || {};
      let city = '';
      try { city = JSON.parse(fn.arguments || '{}').city || ''; } catch { /* arguments not json */ }
      const right = String(fn.name) === 'get_weather' && /paris/i.test(city);
      return { model, ms, ok: true, tools: true, note: right ? 'correct tool_call' : `tool_call ${fn.name}(${city || '?'})` };
    }
    return { model, ms, ok: true, tools: false, note: 'answered in prose, no tool_call' };
  } catch (e) {
    return { model, ms: Date.now() - started, ok: false, tools: false, note: e.name === 'AbortError' ? 'timeout 90s' : String(e.message || e).slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

const models = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_CANDIDATES;
const results = [];
for (const m of models) {
  const r = await probe(m);
  results.push(r);
  const mark = r.tools ? 'TOOLS' : (r.ok ? 'no-tools' : 'FAIL');
  console.log(`${mark.padEnd(9)} ${String(r.ms + 'ms').padStart(7)}  ${r.model}  — ${r.note}`);
}

const good = results.filter(r => r.tools).sort((a, b) => a.ms - b.ms);
console.log('\n=== TOOL-CAPABLE, fastest first ===');
for (const r of good) console.log(`  ${String(r.ms + 'ms').padStart(7)}  ${r.model}`);
console.log(`\n${good.length}/${results.length} tool-capable`);
