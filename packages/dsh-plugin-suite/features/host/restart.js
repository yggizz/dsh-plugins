/**
 * Refresh / restart — Host half.
 *
 * WHAT THE PAGE CANNOT DO
 * `location.reload()` is the page's own business (the Client calls it directly).
 * Restarting the application is not: the Host process is a *child* of the
 * Electron shell, so it cannot replace itself. Disposing it from inside makes
 * Electron observe a non-zero exit and show the crash report, and nothing in
 * the shell can be reached from here — `app.relaunch()` is main-process API,
 * and there is no desktop IPC that restarts the application.
 *
 * THE CHAIN
 *   1. The page POSTs this route.
 *   2. The executable is resolved and **must exist** before anything is killed;
 *      a miss answers 409 and leaves every process alone.
 *   3. A detached helper is spawned with the bundled Node runtime.
 *   4. The helper verifies its target, kills the application, waits for it to
 *      go, then starts it again.
 *
 * WHY THE TARGET IS THE PARENT PROCESS, NOT A NAME SEARCH
 * The first version enumerated processes with `tasklist /FI "IMAGENAME eq …"`.
 * That returned "Access denied" on this machine, so the helper found no pids,
 * killed nothing, and still launched a replacement — the failure this file is
 * built to make impossible. The Host does not need to search: it is spawned
 * directly by the Electron shell, so `process.ppid` *is* the application. The
 * helper confirms that pid really is the resolved executable before touching
 * it, and refuses to act when it cannot confirm.
 *
 * WHY KILL FIRST RATHER THAN WAIT FOR THE HOST TO EXIT
 * Measured on this machine (and recorded in dsh-purge's restart helper): if the
 * Host is allowed to die on its own, Electron notices the child failure and
 * raises the crash-report dialog before the helper can act. Killing the shell
 * first takes the Host down with it in the same orderly teardown. The helper
 * outlives both because it is detached, not because the Host stays alive.
 *
 * SECURITY
 * Same rule as every other route in this suite: only a loopback Host header is
 * answered, and the POST must be same-origin. Restarting is destructive, so a
 * LAN origin must never be able to drive it.
 */

import { existsSync, statSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { basename, dirname, join } from 'node:path'

/** Client-facing route: GET probes, POST restarts. */
const ROUTE_PATH = '/plugins/plugin-suite/restart'

/** The desktop executable's file name, per platform. */
const DESKTOP_NAMES = {
  win32: ['DeepSeek Harness.exe', 'DSH Desktop.exe'],
  darwin: ['DeepSeek Harness', 'DSH Desktop'],
  linux: ['deepseek-harness', 'dsh-desktop'],
}

/** Where the helper's own log lives; beside the other DSH temp files. */
function logPath() {
  const temp = process.env.TEMP ?? process.env.TMPDIR ?? process.env.TMP ?? '/tmp'
  return join(temp, 'dsh-plugin-suite-restart.log')
}

/* ---------------------------------------------------------------- HTTP ---- */

/** Send one JSON answer. */
function sendJson(response, status, value) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.setHeader('cache-control', 'no-store')
  response.end(JSON.stringify(value))
}

/** Whether a Host header names the socket this request arrived on. */
function hostIsLocal(request) {
  const host = request.headers.host
  if (typeof host !== 'string' || host.trim() === '') return false
  let hostname
  try {
    hostname = new URL(`http://${host}`).hostname
  } catch {
    return false
  }
  const bare = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  if (bare === 'localhost' || bare === '::1' || bare.endsWith('.localhost')) return true
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare)) return true
  const local = request.socket?.localAddress
  return typeof local === 'string' && local !== '' && (local === bare || `[${local}]` === hostname)
}

/**
 * Whether a POST came from this very page.
 *
 * A same-origin `fetch` always carries an `Origin`; a cross-site one carries a
 * different authority. A request with no Origin at all is not a page's request
 * and is refused.
 */
function originIsLocal(request) {
  const origin = request.headers.origin
  if (typeof origin !== 'string' || origin === '') return false
  try {
    return new URL(origin).host === request.headers.host
  } catch {
    return false
  }
}

/* ---------------------------------------------------------- executable ---- */

/** Whether one path is a regular file. */
function isFile(path) {
  try {
    return existsSync(path) && statSync(path).isFile()
  } catch {
    return false
  }
}

/** The same file path, normalised for comparison. */
function samePath(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false
  const norm = (value) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  return norm(left) === norm(right)
}

/**
 * Every existing candidate desktop executable, most specific first.
 *
 * The Host is started by the Electron shell, which exports the shell's own
 * executable to it as `DSH_NODE_EXECUTABLE`. That is the authoritative answer
 * when present; the layout walk below is the fallback for a plain `dsh web`
 * host, where the honest answer is usually "there is no desktop at all".
 * @returns {string[]} existing candidates, in preference order.
 */
function desktopCandidates() {
  const names = DESKTOP_NAMES[process.platform] ?? []
  const found = []
  const consider = (path) => {
    if (typeof path !== 'string' || path === '') return
    if (found.includes(path)) return
    if (!names.includes(basename(path))) return
    if (!isFile(path)) return
    found.push(path)
  }

  // Electron exports its own executable to the Host.
  consider(process.env.DSH_NODE_EXECUTABLE)

  // The packaged layout puts the shell one or more levels above the install
  // tree; walking up from that tree finds it without hard-coding a drive.
  const installDir = process.env.DSH_INSTALL_DIR
  if (typeof installDir === 'string' && installDir !== '') {
    let node = installDir
    for (let depth = 0; depth < 6; depth += 1) {
      const parent = dirname(node)
      if (parent === node) break
      for (const name of names) consider(join(parent, name))
      node = parent
    }
  }
  return found
}

/** The bundled Node runtime that can run the helper. */
function nodeExecutable() {
  const candidates = []
  const configured = process.env.DSH_PRIMARY_RUNTIME
  if (typeof configured === 'string' && configured !== '') {
    candidates.push(join(configured, 'dependencies', 'node', 'bin',
      process.platform === 'win32' ? 'node.exe' : 'node'))
  }
  const installDir = process.env.DSH_INSTALL_DIR
  if (typeof installDir === 'string' && installDir !== '') {
    let node = installDir
    for (let depth = 0; depth < 7; depth += 1) {
      candidates.push(join(node, 'runtime', 'primary-runtime', 'dependencies', 'node', 'bin',
        process.platform === 'win32' ? 'node.exe' : 'node'))
      const parent = dirname(node)
      if (parent === node) break
      node = parent
    }
  }
  // The Host's own interpreter, unless it is Electron (which would need a flag).
  if (process.env.ELECTRON_RUN_AS_NODE === undefined) candidates.push(process.execPath)
  for (const path of candidates) if (isFile(path)) return path
  return undefined
}

/* -------------------------------------------------------------- helper ---- */

/**
 * Source for the detached relaunch helper.
 *
 * A string rather than a file: `node -e` keeps the plugin package free of a
 * script that would have to survive the very process that spawned it, and the
 * facts it needs are baked in.
 *
 * The safety rule this script is built around: **verify, then act, and never
 * act on a target it could not verify.** A helper that kills nothing but starts
 * a replacement is worse than one that does nothing at all — it leaves two
 * applications fighting over one profile lock and logs nothing to say so.
 * @param exe - the desktop executable to relaunch.
 * @param appPid - the Electron shell's pid, as the Host sees it.
 * @returns the script text.
 */
function helperSource(exe, appPid) {
  return [
    "const { spawn, spawnSync } = require('node:child_process')",
    "const fs = require('node:fs')",
    `const exe = ${JSON.stringify(exe)}`,
    `const expectedPid = ${JSON.stringify(appPid)}`,
    `const logFile = ${JSON.stringify(logPath())}`,
    "const sleep = (ms) => new Promise((done) => setTimeout(done, ms))",
    "const note = (line) => { try { fs.appendFileSync(logFile, new Date().toISOString() + ' ' + line + '\\n') } catch {} }",
    "const dirOf = (path) => { const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\\\')); return cut > 0 ? path.slice(0, cut) : '.' }",
    "const norm = (value) => String(value || '').replace(/\\\\/g, '/').replace(/\\/+$/, '').toLowerCase()",
    "const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }",
    // The image path behind a pid. PowerShell is the one enumeration that works
    // without elevation on this platform; tasklist reports "Access denied" for
    // the same query, which is exactly the trap that let an earlier helper kill
    // nothing and relaunch anyway.
    "const imageOf = (pid) => {",
    "  try {",
    "    const script = '(Get-Process -Id ' + pid + ' -ErrorAction SilentlyContinue).Path'",
    "    const out = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 8000 })",
    "    const text = String(out.stdout || '').trim()",
    "    return text === '' ? null : text",
    "  } catch { return null }",
    "}",
    "const main = async () => {",
    "  note('helper up (pid ' + process.pid + ') for ' + exe)",
    // Step 1: the pid the Host handed over must really be this executable.
    "  if (!Number.isInteger(expectedPid) || expectedPid <= 1) { note('no usable application pid; refusing to act'); return }",
    "  const targetImage = imageOf(expectedPid)",
    "  note('application pid ' + expectedPid + ' image ' + String(targetImage))",
    "  if (targetImage === null) { note('could not read the image of pid ' + expectedPid + '; refusing to act'); return }",
    "  if (norm(targetImage) !== norm(exe)) { note('pid ' + expectedPid + ' is not ' + exe + '; refusing to act'); return }",
    // Step 2: kill that one application tree. Windows needs /T so the Host and
    // the renderers go with their parent instead of holding the profile lock.
    "  note('killing application tree ' + expectedPid)",
    "  if (process.platform === 'win32') {",
    "    try { spawnSync('taskkill', ['/PID', String(expectedPid), '/T', '/F'], { windowsHide: true, timeout: 15000 }) } catch (error) { note('taskkill threw: ' + error) }",
    "  } else {",
    "    try { process.kill(expectedPid, 'SIGTERM') } catch (error) { note('signal threw: ' + error) }",
    "  }",
    // Step 3: genuinely wait it out. Starting the replacement against a live
    // instance is the one outcome this script must not produce.
    "  const goneBy = Date.now() + 20000",
    "  while (Date.now() < goneBy && alive(expectedPid)) await sleep(150)",
    "  if (alive(expectedPid)) {",
    "    note('application still alive after 20s; forcing it down')",
    "    if (process.platform === 'win32') {",
    "      try { spawnSync('taskkill', ['/PID', String(expectedPid), '/F'], { windowsHide: true, timeout: 15000 }) } catch {}",
    "    } else {",
    "      try { process.kill(expectedPid, 'SIGKILL') } catch {}",
    "    }",
    "    await sleep(1000)",
    "  }",
    "  if (alive(expectedPid)) { note('could not stop the application; NOT launching a second instance'); return }",
    "  note('application gone; starting ' + exe)",
    // Step 4: relaunch. The shell was started with ELECTRON_RUN_AS_NODE present
    // in the Host's environment; inheriting it would run the app as a script.
    "  const env = Object.assign({}, process.env)",
    "  for (const key of Object.keys(env)) if (key.toUpperCase() === 'ELECTRON_RUN_AS_NODE') delete env[key]",
    "  try {",
    "    const out = fs.openSync(logFile, 'a')",
    "    const child = spawn(exe, [], { cwd: dirOf(exe), detached: true, stdio: ['ignore', out, out], env })",
    "    child.on('error', (error) => note('launch failed: ' + error))",
    "    child.unref()",
    "    note('relaunched (pid ' + child.pid + ')')",
    "  } catch (error) {",
    "    note('launch threw: ' + error)",
    "  }",
    "}",
    "process.on('uncaughtException', (error) => note('helper crashed: ' + (error && error.stack ? error.stack : error)))",
    "process.on('unhandledRejection', (error) => note('helper rejection: ' + (error && error.stack ? error.stack : error)))",
    "main()",
  ].join('\n')
}

/* -------------------------------------------------------------- plugin ---- */

/**
 * The relaunch helper's source.
 *
 * Exported so a harness can assert its content without spawning it. Nothing else
 * in the plugin imports it: the route below is its only caller.
 */
export { helperSource }

/**
 * Register the Host half.
 * @param ctx - the plugin's Cordis context.
 */
export function apply(ctx) {
  ctx.inject(['webServer'], webCtx => {
    ctx.effect(() => webCtx.webServer.register({
      kind: 'exact',
      path: ROUTE_PATH,
      handler: async (request, response) => {
        if (!hostIsLocal(request)) return sendJson(response, 403, { ok: false, error: 'host-not-trusted' })

        if (request.method === 'GET') {
          const candidates = desktopCandidates()
          return sendJson(response, 200, {
            ok: true,
            desktop: candidates.length > 0,
            exe: candidates[0] ?? null,
            platform: process.platform,
            error: candidates.length > 0 ? undefined : 'desktop-not-found',
          })
        }

        if (request.method !== 'POST') return sendJson(response, 405, { ok: false, error: 'method-not-allowed' })
        if (!originIsLocal(request)) return sendJson(response, 403, { ok: false, error: 'origin-not-trusted' })

        const candidates = desktopCandidates()
        // Nothing is killed on this path: resolving first is the whole point.
        if (candidates.length === 0) return sendJson(response, 409, { ok: false, error: 'desktop-not-found' })
        const node = nodeExecutable()
        if (node === undefined) return sendJson(response, 409, { ok: false, error: 'node-not-found' })

        // The Electron shell spawned this Host, so its pid is the application.
        // The helper re-verifies that pid's image before touching anything; this
        // route only refuses the case where there is no parent to speak of.
        const appPid = process.ppid
        if (!Number.isInteger(appPid) || appPid <= 1) {
          return sendJson(response, 409, { ok: false, error: 'no-application-parent' })
        }
        // A parent that is demonstrably something else is not the application.
        if (!samePath(process.env.DSH_NODE_EXECUTABLE, candidates[0])
          && process.env.DSH_NODE_EXECUTABLE !== undefined && process.env.DSH_NODE_EXECUTABLE !== '') {
          return sendJson(response, 409, { ok: false, error: 'parent-not-desktop' })
        }
        const exe = candidates[0]

        let helper
        try {
          helper = spawn(node, ['-e', helperSource(exe, appPid)], {
            detached: true,
            stdio: 'ignore',
            windowsHide: true,
            env: process.env,
          })
          helper.unref()
        } catch (error) {
          return sendJson(response, 500, {
            ok: false,
            error: 'spawn-failed',
            detail: error instanceof Error ? error.message : String(error),
          })
        }

        // Answer before the teardown starts: the page wants to show「正在重启…」
        // and this process is about to be killed by the helper.
        sendJson(response, 202, { ok: true, helperPid: helper.pid ?? null, appPid, exe, log: logPath() })
      },
    }), 'refresh-restart: restart route')
  })
}
