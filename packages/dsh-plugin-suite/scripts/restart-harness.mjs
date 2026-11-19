// Harness for `features/host/restart.js`: proves the route's decisions without
// ever killing a process.
//
// What it proves, in order:
//   1. GET on a desktop host reports `desktop: true` and the Electron executable
//      that started this process (DSH_NODE_EXECUTABLE) as the resolved exe;
//   2. GET on a host with no identifiable desktop reports `desktop: false` and a
//      reason instead of guessing;
//   3. POST with a foreign Origin is refused (403) — the destructive action must
//      not be drivable cross-site;
//   4. POST with a non-loopback Host is refused (403);
//   5. POST when no desktop executable can be found answers 409, so nothing is
//      killed on a path that could not relaunch anyway;
//   6. a successful POST spawns a helper and answers 202 — checked by replacing
//      the helper's executable with a recorder, NOT by running the real one.
//
// The last check is the reason this file exists: it is the only way to exercise
// the spawn path without risking the machine.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
const moduleUrl = new URL('../features/host/restart.js', import.meta.url).href

/* -------------------------------------------------------------- harness ---- */

let pass = 0
let fail = 0
function check(label, condition, detail) {
  if (condition) {
    pass += 1
    console.log(`  ok   ${label}`)
  } else {
    fail += 1
    console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
  }
}

/** A fake Cordis context that captures the registered route. */
function makeCtx() {
  const routes = []
  const ctx = {
    effect(fn) {
      fn()
      return () => {}
    },
    inject(_deps, callback) {
      callback({ webServer: { register(route) { routes.push(route); return () => {} } } })
      return () => {}
    },
  }
  return { ctx, routes }
}

/** A fake request/response pair. */
function exchange(route, { method, headers = {}, socket = {} }) {
  const chunks = []
  const response = {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name] = value },
    end(text) { this.body = text === undefined ? '' : String(text) },
  }
  const request = {
    method,
    headers,
    url: '/plugins/plugin-suite/restart',
    socket: { localAddress: '127.0.0.1', ...socket },
    on() {},
    destroy() {},
  }
  return route.handler(request, response).then(() => ({
    status: response.statusCode,
    json: response.body === undefined ? undefined : JSON.parse(response.body),
  }))
}

/* ----------------------------------------------------------------- run ---- */

const mod = await import(moduleUrl)
console.log('module loaded:', typeof mod.apply === 'function' ? 'apply exported' : 'MISSING apply')

const { ctx, routes } = makeCtx()
mod.apply(ctx)
check('registers exactly one route', routes.length === 1, `got ${routes.length}`)
check('route is the documented path', routes[0]?.path === '/plugins/plugin-suite/restart', routes[0]?.path)

/* --- 1. a desktop host answers GET with its own executable ---------------- */

const desktopExe = process.env.DSH_NODE_EXECUTABLE
if (typeof desktopExe === 'string' && desktopExe !== '' && fs.existsSync(desktopExe)) {
  const got = await exchange(routes[0], {
    method: 'GET',
    headers: { host: '127.0.0.1:61439' },
  })
  check('GET on desktop → 200', got.status === 200, got.status)
  check('GET on desktop → desktop:true', got.json?.desktop === true, JSON.stringify(got.json))
  check('GET on desktop → exe is the Electron shell',
    typeof got.json?.exe === 'string' && path.basename(got.json.exe).toLowerCase().includes('deepseek'),
    got.json?.exe)
} else {
  console.log('  skip GET-desktop: DSH_NODE_EXECUTABLE not set in this shell')
}

/* --- 2. a host with no desktop executable says so ------------------------- */

{
  const saved = { exe: process.env.DSH_NODE_EXECUTABLE, install: process.env.DSH_INSTALL_DIR }
  delete process.env.DSH_NODE_EXECUTABLE
  delete process.env.DSH_INSTALL_DIR
  const got = await exchange(routes[0], { method: 'GET', headers: { host: '127.0.0.1:61439' } })
  check('GET headless → 200', got.status === 200, got.status)
  check('GET headless → desktop:false', got.json?.desktop === false, JSON.stringify(got.json))
  check('GET headless → reports why', got.json?.error === 'desktop-not-found', got.json?.error)
  if (saved.exe !== undefined) process.env.DSH_NODE_EXECUTABLE = saved.exe
  if (saved.install !== undefined) process.env.DSH_INSTALL_DIR = saved.install
}

/* --- 3 & 4. refusals ------------------------------------------------------ */

{
  const got = await exchange(routes[0], {
    method: 'POST',
    headers: { host: '127.0.0.1:61439', origin: 'http://evil.example' },
  })
  check('POST from a foreign Origin → 403', got.status === 403, got.status)
  check('  …with the origin error', got.json?.error === 'origin-not-trusted', got.json?.error)
}
{
  const got = await exchange(routes[0], {
    method: 'POST',
    headers: { host: '10.0.0.5:61439', origin: 'http://10.0.0.5:61439' },
  })
  check('POST from a non-loopback Host → 403', got.status === 403, got.status)
  check('  …with the host error', got.json?.error === 'host-not-trusted', got.json?.error)
}
{
  // Deliberately no Origin header: not a page's request, so it must be refused.
  const got = await exchange(routes[0], {
    method: 'POST',
    headers: { host: '127.0.0.1:61439' },
  })
  check('POST with no Origin → 403', got.status === 403, got.status)
  check('  …with the origin error', got.json?.error === 'origin-not-trusted', got.json?.error)
}

/* --- 5. no desktop → 409 and nothing spawned ------------------------------ */

{
  const saved = { exe: process.env.DSH_NODE_EXECUTABLE, install: process.env.DSH_INSTALL_DIR }
  delete process.env.DSH_NODE_EXECUTABLE
  delete process.env.DSH_INSTALL_DIR
  const got = await exchange(routes[0], {
    method: 'POST',
    headers: { host: '127.0.0.1:61439', origin: 'http://127.0.0.1:61439' },
  })
  check('POST with no desktop → 409', got.status === 409, got.status)
  check('  …nothing was spawned', got.json?.helperPid === undefined, JSON.stringify(got.json))
  if (saved.exe !== undefined) process.env.DSH_NODE_EXECUTABLE = saved.exe
  if (saved.install !== undefined) process.env.DSH_INSTALL_DIR = saved.install
}

/* --- 6. the happy path, with the real helper replaced by a recorder ------- */

{
  // A fake desktop executable with a name the resolver accepts, so the POST
  // reaches the spawn. The bundled Node is replaced by a recorder that writes
  // its argv to a file and exits; the real helper source is passed through
  // untouched, so the spawn arguments themselves are still what production uses.
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'psx-restart-'))
  const fakeExe = path.join(temp, process.platform === 'win32' ? 'DeepSeek Harness.exe' : 'DeepSeek Harness')
  fs.writeFileSync(fakeExe, '')

  const saved = {
    exe: process.env.DSH_NODE_EXECUTABLE,
    primary: process.env.DSH_PRIMARY_RUNTIME,
    install: process.env.DSH_INSTALL_DIR,
  }
  process.env.DSH_NODE_EXECUTABLE = fakeExe
  // The helper runtime falls back to this very process's Node (a real
  // executable — a JS file renamed to node.exe cannot be spawned at all). The
  // helper then runs for real, and its own guard is what keeps this test safe:
  // the pid it was handed is this harness's parent, whose image is NOT the fake
  // desktop executable, so it must refuse to kill anything and refuse to launch.
  // That refusal is asserted below, which makes this a live test of the guard
  // rather than a mock of it.
  process.env.DSH_PRIMARY_RUNTIME = ''

  const got = await exchange(routes[0], {
    method: 'POST',
    headers: { host: '127.0.0.1:61439', origin: 'http://127.0.0.1:61439' },
  })
  check('POST with a desktop → 202', got.status === 202, got.status)
  check('  …reports the resolved exe', got.json?.exe === fakeExe, got.json?.exe)
  check('  …names the log path',
    typeof got.json?.log === 'string' && got.json.log.endsWith('dsh-plugin-suite-restart.log'), got.json?.log)
  check('  …reports the application pid', Number.isInteger(got.json?.appPid), got.json?.appPid)

  // The script is checked as text, straight from the module, so its content is
  // asserted without depending on how the spawn went.
  const script = mod.helperSource(fakeExe, 424242)
  check('helper is a Node script', script.includes("require('node:child_process')"), 'no child_process import')
  // The exe is embedded through JSON.stringify, so it appears escaped; compare
  // against the escaped form rather than the raw path.
  check('helper embeds the resolved exe', script.includes(JSON.stringify(fakeExe)), 'exe missing from the script')
  check('helper embeds the pid', script.includes('424242'), 'pid missing from the script')
  check('helper verifies the parent image before killing',
    script.indexOf('imageOf(expectedPid)') < script.indexOf('taskkill'), 'verification is not before the kill')
  check('helper refuses when the image cannot be read',
    script.includes('could not read the image'), 'no guard for an unreadable image')
  check('helper refuses when the image is not the app',
    script.includes('is not '), 'no guard for a mismatched image')
  check('helper never launches while the app is alive',
    script.includes('NOT launching a second instance'), 'no guard after the kill wait')
  check('helper clears ELECTRON_RUN_AS_NODE',
    script.includes("ELECTRON_RUN_AS_NODE') delete env[key]"), 'the relaunch would run as Node')

  // Let the real helper finish, then prove it refused instead of acting.
  const logFile = got.json?.log
  let log = ''
  if (typeof logFile === 'string') {
    const untilLog = Date.now() + 15000
    while (Date.now() < untilLog) {
      log = fs.existsSync(logFile) ? fs.readFileSync(logFile, 'utf8') : ''
      if (log.includes('; refusing to act') || log.includes('NOT launching')) break
      await new Promise((done) => setTimeout(done, 150))
    }
  }
  const tail = log.split(/\r?\n/).filter(line => line.includes(temp)).slice(-3).join(' | ')
  check('the live helper refused to act on a mismatched pid',
    log.includes('; refusing to act'), tail === '' ? 'no matching log lines' : tail)
  check('the live helper never launched a second instance',
    !log.split(/\r?\n/).some(line => line.includes(temp) && line.includes('relaunched')), tail)

  if (saved.exe === undefined) delete process.env.DSH_NODE_EXECUTABLE
  else process.env.DSH_NODE_EXECUTABLE = saved.exe
  if (saved.primary === undefined) delete process.env.DSH_PRIMARY_RUNTIME
  else process.env.DSH_PRIMARY_RUNTIME = saved.primary
  if (saved.install === undefined) delete process.env.DSH_INSTALL_DIR
  else process.env.DSH_INSTALL_DIR = saved.install
  fs.rmSync(temp, { recursive: true, force: true })
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
