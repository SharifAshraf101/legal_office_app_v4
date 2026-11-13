#!/usr/bin/env node
// Adam bridge — Adam's side (the server side is worker/src/adam.ts).
//
// Run from the project folder (Claude Code / Claude desktop with a shell):
//   node scripts/adam-bridge.mjs list                 pending requests
//   node scripts/adam-bridge.mjs take <id>            mark "working", save the package
//   node scripts/adam-bridge.mjs progress <id> "<note>"   status line shown in the app
//   node scripts/adam-bridge.mjs result <id> <file.json>  send the finished result
//   node scripts/adam-bridge.mjs fail <id> "<reason>"     report a failure
//   node scripts/adam-bridge.mjs ask <id> <questions.json> ask the lawyer (a form opens in the app)
//   node scripts/adam-bridge.mjs wait <id> [minutes]       wait for the lawyer's answers (default 30)
//   node scripts/adam-bridge.mjs show <id>            print a request / result
//
// The worker URL comes from ADAM_WORKER_URL or .env.local
// (NEXT_PUBLIC_WORKER_URL); the token from ADAM_TOKEN or worker/wrangler.v4.toml
// (APP_TOKEN). Packages are saved OUTSIDE the project, in ~/adam-jobs/<id>/,
// because they hold client data.
//
// result.json shape:
// {
//   "draft": "Draft B — the merged draft, with the real names",
//   "summary": "a short note to the lawyer",
//   "comparison": [{ "claim": "", "adam": "", "yosef": "", "saeed": "", "assessment": "", "recommendation": "" }],
//   "disputes": [{ "point": "", "adam": "", "yosef": "", "saeed": "" }],
//   "yosef": "Yosef's answer (anonymized, as received)",
//   "saeed": "Saeed's answer (anonymized, as received)",
//   "toVerify": ["items to complete / citations not verified"],
//   "devilsAdvocate": "the strongest argument of the other side, and the answer"
// }

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readFile(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}

function workerUrl() {
  if (process.env.ADAM_WORKER_URL) return process.env.ADAM_WORKER_URL.replace(/\/$/, '');
  const m = readFile(path.join(root, '.env.local')).match(/^\s*NEXT_PUBLIC_WORKER_URL\s*=\s*(\S+)/m);
  if (!m) throw new Error('Worker URL not found (set ADAM_WORKER_URL).');
  return m[1].replace(/["']/g, '').replace(/\/$/, '');
}

function token() {
  if (process.env.ADAM_TOKEN) return process.env.ADAM_TOKEN;
  const m = readFile(path.join(root, 'worker', 'wrangler.v4.toml')).match(/^\s*APP_TOKEN\s*=\s*"([^"]+)"/m);
  if (!m) throw new Error('Token not found (set ADAM_TOKEN).');
  return m[1].split(',')[0].trim();
}

async function call(method, p, body) {
  const res = await fetch(workerUrl() + p, {
    method,
    headers: { Authorization: 'Bearer ' + token(), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text };
  }
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(data)}`);
  return data;
}

const jobsDir = path.join(os.homedir(), 'adam-jobs');

const [, , cmd, id, arg] = process.argv;
try {
  if (cmd === 'list') {
    const { jobs } = await call('GET', '/api/adam/jobs?status=pending');
    if (!jobs.length) console.log('No pending requests.');
    for (const j of jobs) console.log(`${j.id}\t${j.caseId}\t${j.title}\t${j.createdAt}`);
  } else if (cmd === 'take' && id) {
    const { job } = await call('POST', `/api/adam/jobs/${id}/status`, { status: 'working', note: 'אדם קיבל את הבקשה' });
    const dir = path.join(jobsDir, id);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'package.json');
    fs.writeFileSync(file, JSON.stringify(job.package, null, 2), 'utf8');
    console.log('Saved: ' + file);
    console.log(JSON.stringify(job.package, null, 2));
  } else if (cmd === 'progress' && id && arg) {
    await call('POST', `/api/adam/jobs/${id}/status`, { status: 'working', note: arg });
    console.log('ok');
  } else if (cmd === 'result' && id && arg) {
    const result = JSON.parse(fs.readFileSync(path.resolve(arg), 'utf8'));
    await call('POST', `/api/adam/jobs/${id}/result`, { result });
    console.log('Result sent — it now shows in the case-brain screen.');
  } else if (cmd === 'fail' && id) {
    await call('POST', `/api/adam/jobs/${id}/status`, { status: 'error', note: arg || '' });
    console.log('ok');
  } else if (cmd === 'ask' && id && arg) {
    // questions.json: ["question", …] or [{ "q": "question", "hint": "example / format" }, …]
    const questions = JSON.parse(fs.readFileSync(path.resolve(arg), 'utf8'));
    await call('POST', `/api/adam/jobs/${id}/questions`, { questions, note: 'ממתין לתשובות עו"ד שריף' });
    console.log('Questions sent — a form is open in the case-brain screen. Run: wait ' + id);
  } else if (cmd === 'wait' && id) {
    const minutes = Number(arg) > 0 ? Number(arg) : 30;
    const until = Date.now() + minutes * 60_000;
    let job;
    for (;;) {
      ({ job } = await call('GET', `/api/adam/jobs/${id}`));
      if (job.status !== 'question') break;
      if (Date.now() > until) {
        console.log('Still waiting — no answers yet. Run wait again, or ask in the chat.');
        process.exit(2);
      }
      await new Promise((r) => setTimeout(r, 10_000));
    }
    if (job.status !== 'answered') {
      console.log('Request is now: ' + job.status);
      process.exit(3);
    }
    await call('POST', `/api/adam/jobs/${id}/status`, { status: 'working', note: 'אדם קיבל את התשובות וממשיך' });
    const dir = path.join(jobsDir, id);
    fs.mkdirSync(dir, { recursive: true });
    const qa = (job.questions || []).map((q) => ({ q: q.q, a: (job.answers || {})[q.id] || '' }));
    fs.writeFileSync(path.join(dir, 'answers.json'), JSON.stringify(qa, null, 2), 'utf8');
    for (const x of qa) console.log(`ש: ${x.q}
ת: ${x.a || '(לא נענה)'}
`);
  } else if (cmd === 'show' && id) {
    const { job } = await call('GET', `/api/adam/jobs/${id}`);
    console.log(JSON.stringify(job, null, 2));
  } else {
    console.log('Usage: list | take <id> | progress <id> "<note>" | ask <id> <questions.json> | wait <id> [min] | result <id> <file.json> | fail <id> "<reason>" | show <id>');
    process.exitCode = 1;
  }
} catch (e) {
  console.error('Error: ' + (e && e.message ? e.message : e));
  process.exitCode = 1;
}
