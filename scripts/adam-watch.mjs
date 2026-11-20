#!/usr/bin/env node
// Adam watcher — makes the Adam consultation run by itself.
//
// Runs on the office computer (started at logon, see scripts/adam-watch-start.vbs).
// Every minute it asks the system for pending Adam requests; when one is
// waiting it starts Adam (Claude Code, headless, with the Claude-in-Chrome
// browser tools) on that request. Adam then works exactly as in
// docs/adam-bridge.md: takes the request, drafts, anonymizes, consults Yosef
// (ChatGPT) and Saeed (Gemini) in Chrome, merges, and sends the result back —
// with nobody typing "check the requests" in Claude.
//
//   node scripts/adam-watch.mjs            run the watcher (stays running)
//   node scripts/adam-watch.mjs --once     handle what is pending now, then exit
//   node scripts/adam-watch.mjs --once --only <id>   handle one request, then exit
//
// One request at a time. Logs: ~/adam-jobs/watch.log and ~/adam-jobs/<id>/run.log.
// Needs: the computer on, Chrome open and signed in to ChatGPT and Gemini, the
// Claude in Chrome extension, and Claude Code signed in.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const jobsDir = path.join(os.homedir(), 'adam-jobs');
const POLL_MS = 60_000;
const RUN_LIMIT_MS = 75 * 60_000; // a run that takes longer is stopped and reported
const once = process.argv.includes('--once');
// --only <id>: handle just this request (testing / re-running one request).
const onlyAt = process.argv.indexOf('--only');
const only = onlyAt > -1 ? process.argv[onlyAt + 1] : '';

fs.mkdirSync(jobsDir, { recursive: true });

function readFile(p) {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return '';
  }
}
function log(msg) {
  const line = new Date().toISOString() + '  ' + msg;
  console.log(line);
  try {
    fs.appendFileSync(path.join(jobsDir, 'watch.log'), line + '\n', 'utf8');
  } catch {}
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
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

/** Where Claude Code is on this computer: { cmd, pre } (pre = args before ours).
 *  1. ADAM_CLAUDE_EXE   2. the native install (~/.local/bin)
 *  3. the Node-based npm install (versions up to 2.1.112 — for computers whose
 *     CPU cannot run the native build): run its cli.js with this Node. */
function claudeCmd() {
  if (process.env.ADAM_CLAUDE_EXE) return { cmd: process.env.ADAM_CLAUDE_EXE, pre: [], found: true };
  const win = process.platform === 'win32';
  const local = path.join(os.homedir(), '.local', 'bin', win ? 'claude.exe' : 'claude');
  if (fs.existsSync(local)) return { cmd: local, pre: [], found: true };
  // An npm install: the native build (bin/claude.exe) or, in old versions, cli.js.
  const fromPackage = (pkgDir) => {
    const exe = path.join(pkgDir, 'bin', win ? 'claude.exe' : 'claude');
    if (fs.existsSync(exe)) return { cmd: exe, pre: [], found: true };
    const cli = path.join(pkgDir, 'cli.js');
    if (fs.existsSync(cli)) return { cmd: process.execPath, pre: [cli], found: true };
    return null;
  };
  const npmRoots = [
    process.env.APPDATA && path.join(process.env.APPDATA, 'npm', 'node_modules'),
    path.join(path.dirname(process.execPath), 'node_modules'),
    path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules'),
  ].filter(Boolean);
  for (const r of npmRoots) {
    const hit = fromPackage(path.join(r, '@anthropic-ai', 'claude-code'));
    if (hit) return hit;
  }
  // Anywhere on PATH (winget and other installers).
  for (const dir of String(process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    const exe = path.join(dir, win ? 'claude.exe' : 'claude');
    if (fs.existsSync(exe)) return { cmd: exe, pre: [], found: true };
    if (win && fs.existsSync(path.join(dir, 'claude.cmd'))) {
      const hit = fromPackage(path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code'));
      if (hit) return hit;
    }
  }
  return { cmd: 'claude', pre: [], found: false };
}
function claudeExe() {
  const c = claudeCmd();
  return c.pre.length ? c.pre[0] : c.cmd;
}

/** The instructions Adam gets for one request (he also loads his own skill). */
function promptFor(id) {
  return [
    `יש בקשה חדשה ממערכת המשרד: ${id}. אתה אדם. הפעל את המיומנות adam-paralegal וקרא את docs/adam-bridge.md, ואז טפל בבקשה הזאת מתחילתה ועד סופה לפי "שלבי העבודה של אדם על בקשה".`,
    '',
    'מצב אוטומטי – אין אף אחד מול המסך:',
    `1. התחל ב: node scripts/adam-bridge.mjs take ${id}`,
    '2. אל תשאל שאלות בצ\'אט ואל תמתין לאישור בצ\'אט – אף אחד לא יענה. עו"ד שריף הורה מראש שההתייעצות תתבצע אוטומטית, ולכן אין צורך להציג לו את החבילה המותממת לאישור. ההתממה עצמה נשארת חובה מוחלטת: ליוסף ולסעיד נשלח רק תוכן מותמם.',
    '3. אם חסרות עובדות שבלעדיהן אי אפשר להתקדם – שאל רק דרך המערכת: ask ואחריו wait (כמתואר במסמך). אם wait הסתיים בלי תשובה, המשך עם מה שיש וסמן את החסר ב-toVerify.',
    '4. התייעץ עם יוסף (הפרויקט "יוסף" ב-chatgpt.com) ועם סעיד (ה-Gem "סעיד" ב-gemini.google.com) בדפדפן Chrome, בכלי Claude in Chrome. עבוד בלשונית חדשה, והמתן עד שהתשובה מסתיימת לפני הקריאה. אם אחד מהם לא זמין (דורש התחברות, שגיאה, מגבלה) – נסה שוב פעם אחת; אם עדיין לא, המשך עם השני, כתוב זאת במפורש ב-summary והשאר את השדה שלו ריק.',
    '5. עדכן שורת מצב בכל שלב: progress (מכין טיוטה / מתייעץ עם יוסף / מתייעץ עם סעיד / משלב ומשווה).',
    '6. שמירה ב-Google Drive (בכלי Google Drive המחובר לחשבון), לפני שליחת התוצאה – לפי הסעיף "שמירה ב-Google Drive" במסמך: תיקיית האב "התייעצויות בין אדם ויוסף וסעיד", בתוכה תיקייה על שם הלקוח (clientName), ובתוכה תיקייה על שם מהות התיק (caseTitle). אם תיקייה כבר קיימת – להשתמש בה ולא ליצור כפולה. לשמור שם את מסמכי ההתייעצות הזאת, ולכתוב את הקישור לתיקייה בסוף ה-summary. אם Google Drive לא זמין – לא לעצור: לכתוב זאת ב-summary ולהמשיך.',
    `7. בסיום כתוב את ~/adam-jobs/${id}/result.json ושלח: node scripts/adam-bridge.mjs result ${id} <הקובץ>. התוצאה היא התשובה הסופית אחרי ההתייעצות בין שלושתכם.`,
    `8. אם נכשלת ואי אפשר להשלים – דווח: node scripts/adam-bridge.mjs fail ${id} "<הסיבה בקצרה>". אל תסיים בלי result או fail.`,
    '',
    'חיסיון: קבצי העבודה נשמרים רק ב-~/adam-jobs. אל תדפיס את ה-token ואל תשנה קבצים בפרויקט.',
  ].join('\n');
}

/** Start PowerShell once and wait for it to exit, so it is "warm" when Adam
 *  needs it. On a computer without Git Bash, Claude Code runs every command —
 *  the bridge commands included — through PowerShell, and gives a cold
 *  PowerShell only 5 seconds to start ("pwsh timed out after 5000ms"). After the
 *  computer has been idle the first start takes longer than that, so the run
 *  could not execute a single command and ended without a result; the same
 *  request sent again then worked, because PowerShell was by then in memory. */
function warmShell() {
  if (process.platform !== 'win32') return Promise.resolve();
  const one = (exe) =>
    new Promise((resolve) => {
      const t0 = Date.now();
      let done = false;
      const end = (how) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(`${exe} ${how} ${Date.now() - t0}ms`);
      };
      let child;
      try {
        child = spawn(exe, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', 'exit'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      } catch {
        return resolve(`${exe} not started`);
      }
      const timer = setTimeout(() => {
        try {
          child.kill();
        } catch {}
        end('still starting after');
      }, 90_000);
      child.on('error', () => end('missing'));
      child.on('close', () => end('ready in'));
    });
  // Both editions: Claude Code uses pwsh (PowerShell 7) when it is installed,
  // Windows PowerShell otherwise. Twice — the second start shows the warm time.
  return (async () => {
    const out = [];
    for (const exe of ['pwsh.exe', 'powershell.exe']) {
      out.push(await one(exe));
      out.push(await one(exe));
    }
    return out.join(', ');
  })();
}

function runAdam(id) {
  return new Promise((resolve) => {
    const dir = path.join(jobsDir, id);
    fs.mkdirSync(dir, { recursive: true });
    const out = fs.createWriteStream(path.join(dir, 'run.log'), { flags: 'a' });
    const args = [
      '-p',
      promptFor(id),
      '--chrome',
      '--add-dir',
      jobsDir,
      '--permission-mode',
      'acceptEdits',
      '--allowedTools',
      'Skill',
      'ToolSearch',
      'Read',
      'Write',
      'Edit',
      'Glob',
      'Grep',
      'WebSearch',
      'WebFetch',
      'mcp__claude-in-chrome',
      'mcp__claude_ai_2',
      // read the request's document (docLink) from the office Dropbox
      'mcp__claude_ai_Dropbox',
      // keep each consultation's documents in the client's Google Drive folder
      'mcp__claude_ai_Google_Drive',
      'Bash(node scripts/adam-bridge.mjs:*)',
      // a computer without Git Bash runs the same command through PowerShell
      'PowerShell(node scripts/adam-bridge.mjs:*)',
      'PowerShell(node scripts\\adam-bridge.mjs:*)',
      '--max-turns',
      '400',
    ];
    const cc = claudeCmd();
    const child = spawn(cc.cmd, [...cc.pre, ...args], {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      // The watcher pins the installed version: an auto-update could replace a
      // Node-based install with a build this computer's CPU cannot run.
      env: { ...process.env, DISABLE_AUTOUPDATER: '1' },
    });
    child.stdout.pipe(out, { end: false });
    child.stderr.pipe(out, { end: false });
    const timer = setTimeout(() => {
      log(`${id}: run exceeded ${RUN_LIMIT_MS / 60000} min — stopping`);
      child.kill();
    }, RUN_LIMIT_MS);
    child.on('error', (e) => {
      clearTimeout(timer);
      out.end();
      resolve({ code: -1, error: String(e && e.message ? e.message : e) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      out.end();
      resolve({ code });
    });
  });
}

async function handle(id) {
  log(`${id}: starting Adam`);
  try {
    await call('POST', `/api/adam/jobs/${id}/status`, { status: 'working', note: 'אדם התחיל לעבוד (אוטומטי)' });
  } catch (e) {
    log(`${id}: could not mark working — ${e.message}`);
  }
  try {
    log(`${id}: PowerShell warm-up — ${await warmShell()}`);
  } catch (e) {
    log(`${id}: PowerShell warm-up failed — ${e && e.message ? e.message : e}`);
  }
  const r = await runAdam(id);
  log(`${id}: Adam finished (exit ${r.code}${r.error ? ', ' + r.error : ''})`);
  // Never leave a request hanging: if Adam ended without a result, report it.
  try {
    const { job } = await call('GET', `/api/adam/jobs/${id}`);
    if (job && (job.status === 'working' || job.status === 'pending' || job.status === 'answered')) {
      await call('POST', `/api/adam/jobs/${id}/status`, {
        status: 'error',
        note: 'אדם לא השלים את הבקשה (הריצה האוטומטית נעצרה). אפשר לשלוח שוב.',
      });
      log(`${id}: marked as error (no result)`);
    } else {
      log(`${id}: status is ${job && job.status}`);
    }
  } catch (e) {
    log(`${id}: could not read final status — ${e.message}`);
  }
}

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const { jobs } = await call('GET', '/api/adam/jobs?status=pending');
    // Oldest first, one at a time.
    const queue = (jobs || []).slice().sort((x, y) => String(x.createdAt).localeCompare(String(y.createdAt)));
    for (const j of queue) if (!only || j.id === only) await handle(j.id);
  } catch (e) {
    log('poll failed — ' + (e && e.message ? e.message : e));
  } finally {
    busy = false;
  }
}

// --check: verify this computer is ready (no request is started).
const checkOnly = process.argv.includes('--check');
if (checkOnly) {
  let ok = true;
  const say = (good, msg) => {
    if (!good) ok = false;
    console.log((good ? '[OK]   ' : '[FAIL] ') + msg);
  };
  const cc = claudeCmd();
  say(cc.found, 'Claude Code: ' + (cc.found ? claudeExe() : 'not installed (run the Claude Code installer, then run this file again)'));
  try {
    const { jobs } = await call('GET', '/api/adam/jobs?status=pending');
    say(true, 'System reachable. Pending requests: ' + (jobs || []).length);
  } catch (e) {
    say(false, 'System not reachable: ' + (e && e.message ? e.message : e));
  }
  const skills = path.join(os.homedir(), '.claude', 'skills', 'synced');
  // Either bundled with this folder (.claude/skills) or synced from the account.
  let hasAdam = fs.existsSync(path.join(root, '.claude', 'skills', 'adam-paralegal', 'SKILL.md'));
  try {
    if (!hasAdam) hasAdam = fs.readdirSync(skills).some((d) => fs.existsSync(path.join(skills, d, 'adam-paralegal', 'SKILL.md')));
  } catch {}
  say(hasAdam, 'Adam skill (adam-paralegal) available on this computer');
  console.log('Package version: 6');
  console.log(ok ? 'READY' : 'NOT READY');
  process.exitCode = ok ? 0 : 1;
} else {

log(`watcher started (${once ? 'once' : 'every ' + POLL_MS / 1000 + 's'}) on ${os.hostname()} — ${claudeExe()}`);
await tick();
if (!once) setInterval(tick, POLL_MS);
}
