// run-agent.mjs <agentId> <provider> <model> <promptFile> <outNdjson> <limitUsd>
// One interactive StarNet run (the agent's OWN roster provider/model — nothing changed), stream saved to a file. Spend watchdog:
// sums the run's agent.cost events (lead run AND any worker) and aborts the request past <limitUsd> — the station cancels a run
// whose client disconnects. Token from the env (never printed).
import fs from 'node:fs';
const [agentId, provider, model, promptFile, out, limitArg] = process.argv.slice(2);
const limit = Number(limitArg);
const token = process.env.STARNET_API_TOKEN;
const ac = new AbortController();
const body = { agentId, provider, model, isTask: true, messages: [{ role: 'user', content: fs.readFileSync(promptFile, 'utf8') }] };
const w = fs.createWriteStream(out);
const perTurn = new Map();   // runId -> last cumulative-ish sum of agent.cost usd
let spent = 0, ended = null, aborted = false, buf = '';
const t0 = Date.now();
try {
  const r = await fetch('http://127.0.0.1:8787/api/run', { method: 'POST', signal: ac.signal,
    headers: { 'Content-Type': 'application/json', 'x-starnet-token': token, Origin: 'http://127.0.0.1:8787' }, body: JSON.stringify(body) });
  console.log('HTTP', r.status);
  for await (const chunk of r.body) {
    const s = Buffer.from(chunk).toString('utf8'); w.write(s); buf += s;
    let i; while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i); buf = buf.slice(i + 1); if (!line.trim()) continue;
      let e; try { e = JSON.parse(line); } catch (_) { continue; }
      const p = e.payload || {};
      if (e.name === 'agent.cost' && Number.isFinite(Number(p.usd))) {
        spent += Number(p.usd); perTurn.set(p.runId, (perTurn.get(p.runId) || 0) + Number(p.usd));
        if (spent > limit && !aborted) { aborted = true; console.log('WATCHDOG: $' + spent.toFixed(3) + ' > $' + limit + ' — aborting the run'); ac.abort(); }
      }
      if (e.name === 'agent.tool_call' && p.runId) console.log('  tool', p.agentId, p.name, String(p.argsSummary || '').slice(0, 90));
      if (e.name === 'agent.run.end' && p.agentId === agentId && !p.parentRunId) ended = p;
    }
  }
} catch (err) { if (!aborted) console.log('stream error', String(err && err.message || err)); }
w.end();
console.log('END', JSON.stringify(ended), '| summed agent.cost $' + spent.toFixed(4), '| per run', JSON.stringify(Object.fromEntries([...perTurn].map(([k, v]) => [String(k).slice(0, 8), +v.toFixed(4)]))), '|', Math.round((Date.now() - t0) / 1000) + 's', aborted ? '| ABORTED BY WATCHDOG' : '');
