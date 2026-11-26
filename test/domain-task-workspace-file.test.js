/* node test/domain-task-workspace-file.test.js — a FILENAME that happens to end in a country-code TLD must
   not be read as a hostname, because that reading silently removes every delegation tool from the run.

   The incident: the Etsy chain's prompt said «read the file `etsy-creative-brief.md` in your own workspace».
   `.md` is Moldova, so DomainTask.classify returned a direct-domain policy, and sidecar/index.js's
   directDomainWithheld then stripped EVERY team.*, browser.*, web_search and web_request name out of BOTH the
   core and the deferred wire list. team_dispatch answered summary:"withheld" in 0 ms — before capability,
   consent or taint were ever consulted — and no error anywhere named the cause. The lead burned 19 turns and
   $0.53 and produced nothing. The same trap is armed for .sh (St Helena), .rs (Serbia), .pl (Poland),
   .py (Paraguay), .so (Somalia), .tf, .ps, .it, .in and .co.

   The fix is an INJECTED existence probe, so this module stays pure. What has to hold:
     1. a bare token that names a real workspace file does not classify  -> team.* survives
     2. a real hostname still classifies                                 -> the bounded-check feature is intact
     3. an EXPLICIT url still classifies even if a file shares its name  -> a typed host is never suppressed
     4. no probe, or a throwing/odd probe, behaves exactly as before      -> no new failure mode
   Test 2 is the one that matters most: a fix that simply stopped classifying would pass test 1 and quietly
   delete the feature. */
'use strict';
const A = require('./_assert.js');
const DomainTask = require('../sidecar/domain-task.js');

/* The real stripping predicate from sidecar/index.js, reproduced here so the test asserts the CONSEQUENCE
   (delegation is gone) rather than merely the classifier's return value. Source-locked below. */
const withheld = (policy, name) => !!policy
  && (/^team\./.test(name) || /^browser\./.test(name) || name === 'web_search' || name === 'web_request');

const WIRE = ['team.dispatch', 'team.subagents', 'browser.attach', 'web_search', 'web_request', 'fs.read'];
const advertised = (policy) => WIRE.filter(n => !withheld(policy, n));

/* the probe the host injects: these files "exist", nothing else does. */
const FILES = new Set(['etsy-creative-brief.md', 'build.sh', 'main.rs', 'notes.md', 'deploy.sh']);
const probe = (raw) => FILES.has(String(raw));

/* ---- 1. the regression: a real workspace file does NOT strip delegation ---- */
{
  const text = 'Before Stage 1, read the file `etsy-creative-brief.md` in your own workspace.';
  const before = DomainTask.classify(text);                           // no probe = the old behaviour
  A.ok(before && before.kind === 'direct-domain', 'without the probe this still classifies (the defect)');
  A.eq(before.host, 'etsy-creative-brief.md', 'and the "host" it found was the filename');
  A.eq(advertised(before).length, 1, 'which left exactly one advertised tool — fs.read');
  A.ok(!advertised(before).includes('team.dispatch'), 'team.dispatch was stripped — the live failure');

  const after = DomainTask.classify(text, { isWorkspaceFile: probe });
  A.eq(after, null, 'with the probe, a token naming a real file is not a host');
  A.eq(advertised(after).length, WIRE.length, 'so the whole wire list survives');
  A.ok(advertised(after).includes('team.dispatch'), 'team.dispatch is advertised again');
  A.ok(advertised(after).includes('web_search'), 'and so is web_search');
}

/* ---- 2. a bare *.md / *.sh / *.rs that exists is declined; one that does NOT exist still classifies ---- */
{
  const cases = [
    ['read the file notes.md in your workspace', 'notes.md'],
    ['inspect build.sh and report', 'build.sh'],
    ['review main.rs please', 'main.rs'],
    ['open deploy.sh and read it', 'deploy.sh']
  ];
  for (const [text, name] of cases) {
    A.eq(DomainTask.classify(text, { isWorkspaceFile: probe }), null, name + ' exists -> declined');
    A.ok(DomainTask.classify(text) !== null, name + ' classified before the fix (proves the case is live)');
  }
  // the probe is EXISTENCE, not extension: a .md that is not on disk is still treated as a host, because a
  // real Moldovan domain is a legitimate thing for the Commander to ask about.
  const ghost = DomainTask.classify('check absent-file.md and read its docs', { isWorkspaceFile: probe });
  A.ok(ghost && ghost.host === 'absent-file.md', 'a NON-existent .md token still classifies as a host');
}

/* ---- 3. real hostnames must still classify — the feature is not deleted ---- */
{
  const hosts = [
    ['check example.com and read its docs', 'example.com'],
    ['visit docs.anthropic.com', 'docs.anthropic.com'],
    ['open https://etsy.com/legal/creativity and read it', 'etsy.com'],
    ['inspect nonexistent-host.invalid', 'nonexistent-host.invalid'],
    ['review the site openrouter.ai documentation', 'openrouter.ai']
  ];
  for (const [text, host] of hosts) {
    const p = DomainTask.classify(text, { isWorkspaceFile: probe });
    A.ok(p && p.kind === 'direct-domain', 'still classifies: ' + host);
    A.eq(p.host, host, 'host is ' + host);
    A.eq(p.workerMaxTools, DomainTask.WORKER_MAX_TOOLS, 'the worker bounds ride along unchanged');
  }
  // a probe that says EVERYTHING exists must not be able to kill a real host typed as a URL (see 4) but it
  // IS allowed to decline a bare one — that is the conservative direction, by design.
  const all = () => true;
  A.eq(DomainTask.classify('check example.com and read its docs', { isWorkspaceFile: all }), null,
    'a bare host the probe claims is a file is declined — false negatives are the safe direction');
}

/* ---- 4. an EXPLICIT url is never suppressed by a file of the same name ---- */
{
  const all = () => true;
  for (const text of [
    'check https://etsy-creative-brief.md/docs and read it',
    'open http://notes.md and review it',
    'read https://example.com/x'
  ]) {
    const p = DomainTask.classify(text, { isWorkspaceFile: all });
    A.ok(p && p.kind === 'direct-domain', 'explicit URL still classifies: ' + text);
  }
  A.eq(DomainTask.classify('check https://notes.md/x and read it', { isWorkspaceFile: all }).host, 'notes.md',
    'and it keeps the typed host');
}

/* ---- 5. the probe may not introduce a new failure mode ---- */
{
  const text = 'read the file notes.md in your workspace';
  const old = DomainTask.classify(text);
  const same = (opts, why) => A.eq(JSON.stringify(DomainTask.classify(text, opts)), JSON.stringify(old), why);
  same(undefined, 'no opts -> identical to the pre-fix behaviour');
  same({}, 'empty opts -> identical');
  same({ isWorkspaceFile: null }, 'null probe -> identical');
  same({ isWorkspaceFile: 'nope' }, 'non-function probe -> identical');
  same({ isWorkspaceFile: () => { throw new Error('boom'); } }, 'a throwing probe cannot break classification');
  // only a strict `true` vetoes: a truthy non-boolean (a stat object, a Promise) must not silently decline.
  same({ isWorkspaceFile: () => ({ isFile: true }) }, 'a truthy OBJECT does not veto');
  same({ isWorkspaceFile: () => Promise.resolve(true) }, 'a Promise does not veto');
  same({ isWorkspaceFile: () => 1 }, 'the number 1 does not veto');
  A.eq(DomainTask.classify(text, { isWorkspaceFile: () => true }), null, 'strict true does veto');

  // hostsOf keeps its own signature working both ways
  A.eq(JSON.stringify(DomainTask.hostsOf('check notes.md')), JSON.stringify(['notes.md']), 'hostsOf() unchanged');
  A.eq(JSON.stringify(DomainTask.hostsOf('check notes.md', { isWorkspaceFile: probe })), '[]',
    'hostsOf(text, opts) honours the probe');
  A.notThrows(() => DomainTask.classify(null, { isWorkspaceFile: probe }), 'null text does not throw');
  A.notThrows(() => DomainTask.hostsOf(undefined, { isWorkspaceFile: probe }), 'undefined text does not throw');
}

/* ---- 6. source locks — the test asserts a consequence, so it must prove it still mirrors the host ---- */
{
  const fs = require('fs'), path = require('path');
  const idx = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');
  A.ok(idx.includes("const directDomainWithheld = (name) => !!directDomainTask && (/^team\\./.test(name)"),
    'the real stripping predicate still begins with the team.* family this test mirrors');
  A.ok(idx.includes('const coreNames = resolved.tools.filter(n => !deferredNames.has(n) && !directDomainWithheld(n))'),
    'the wire list is still resolved.tools MINUS directDomainWithheld');
  A.ok(idx.includes('isWorkspaceFile: workspaceFileProbe(agentId)'),
    'the host injects the probe into classify — without this the fix is inert in production');
  A.ok(idx.includes('function workspaceFileProbe(agentId)'), 'and the probe itself is defined in the host');
  const orch = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'tools', 'builtin', 'orchestration.js'), 'utf8');
  A.ok(/boundedDomainTask\(job\.prompt, isWorkspaceFile\)/.test(orch),
    'the second classify call site (worker bounding) is wired too');
}

A.report('domain-task: a workspace filename is not a hostname');
