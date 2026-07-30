const { spawn } = require('child_process');
const fs   = require('fs');
const path = require('path');
const db   = require('./database');

const hostedDir = path.join(__dirname, '..', 'hosted');
if (!fs.existsSync(hostedDir)) fs.mkdirSync(hostedDir, { recursive: true });

const processes  = new Map(); // recordId → ChildProcess
const restarts   = new Map(); // recordId → { count, timer }

const MAX_RESTARTS    = 10;
const MAX_CONCURRENT  = 5;  // 동시 실행 가능한 최대 호스팅 수
const RESTART_DELAY   = 4_000;  // 4s
const STABLE_AFTER    = 30_000; // 30s 이상 살아있으면 카운터 리셋

const LANG_CONFIG = {
  javascript: { filename: 'index.js',  cmd: 'node',    label: 'JavaScript', emoji: '🟨' },
  python:     { filename: 'main.py',   cmd: 'python3', label: 'Python',     emoji: '🐍' },
};

// ── Core hosting ──────────────────────────────────────────────────────────

async function startHosting(recordId) {
  // 이미 실행 중인 recordId는 재시작이므로 카운터 제외
  if (!processes.has(recordId) && processes.size >= MAX_CONCURRENT) {
    throw new Error(
      `서버 용량 부족 — 현재 ${processes.size}/${MAX_CONCURRENT}개 실행 중입니다. 다른 호스팅을 먼저 중지해주세요.`
    );
  }
  restarts.delete(recordId); // 수동 시작 시 카운터 초기화
  return _launch(recordId);
}

// ── Library auto-reinstall (Render 재시작 후 파일시스템 초기화 대응) ──────────

async function _ensureLibraries(recordId, language) {
  const libs = await db.getLibraries(recordId);
  if (!libs.length) return;

  const dir = path.join(hostedDir, recordId);
  let needsReinstall = false;

  if (language === 'javascript') {
    for (const lib of libs) {
      const pkgDir = path.join(dir, 'node_modules', lib.name.split('@')[0].split('/').pop() || lib.name);
      if (!fs.existsSync(pkgDir)) { needsReinstall = true; break; }
    }
  } else if (language === 'python') {
    const sitePkgs = path.join(dir, 'site-packages');
    if (!fs.existsSync(sitePkgs) || fs.readdirSync(sitePkgs).length === 0) {
      needsReinstall = true;
    }
  }

  if (!needsReinstall) return;

  console.log(`[Launch] ${recordId.slice(0, 8)} 라이브러리 재설치 중 (${libs.length}개)...`);
  for (const lib of libs) {
    try {
      const pkg = lib.name + (lib.version ? `@${lib.version}` : '');
      await installLibrary(recordId, pkg);
      console.log(`[Launch] ✅ ${lib.name} 재설치 완료`);
    } catch (err) {
      console.error(`[Launch] ❌ ${lib.name} 재설치 실패: ${err.message}`);
    }
  }
}

async function _launch(recordId) {
  const record = await db.getHostingRecord(recordId);
  if (!record) throw new Error('호스팅 기록을 찾을 수 없습니다.');

  const config = LANG_CONFIG[record.language];
  if (!config) throw new Error(`지원하지 않는 언어: ${record.language}`);

  _kill(recordId);

  const dir = path.join(hostedDir, recordId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Render 재시작 후 파일시스템이 초기화되면 라이브러리를 자동으로 재설치
  await _ensureLibraries(recordId, record.language);

  // Python: sys.path injection for installed packages
  let codeToWrite = record.code;
  if (record.language === 'python') {
    const sitePkgs = path.join(dir, 'site-packages');
    if (!fs.existsSync(sitePkgs)) fs.mkdirSync(sitePkgs, { recursive: true });
    codeToWrite = `import sys as _sys\n_sys.path.insert(0, r'${sitePkgs}')\n` + record.code;
  }

  fs.writeFileSync(path.join(dir, config.filename), codeToWrite, 'utf8');

  const logStream = fs.createWriteStream(path.join(dir, 'output.log'), { flags: 'a' });

  const env = { ...process.env };
  if (record.language === 'javascript') {
    env.NODE_PATH = path.join(dir, 'node_modules');
  }

  const proc = spawn(config.cmd, [path.join(dir, config.filename)], {
    cwd: dir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  });

  const startedAt = Date.now();

  proc.stdout.pipe(logStream);
  proc.stderr.pipe(logStream);

  proc.on('exit', async (code, signal) => {
    processes.delete(recordId);

    // 정상 종료(code 0)이면 중지 처리
    if (code === 0) {
      await db.updateHostingStatus(recordId, 'stopped', null).catch(() => {});
      restarts.delete(recordId);
      return;
    }

    // SIGTERM: stopHosting()이 이미 DB를 'stopped'으로 업데이트했거나,
    // Render 재시작 등 외부 신호인 경우엔 DB를 그대로 두어
    // 다음 부팅 시 recoverRunningProcesses()가 복구할 수 있도록 함
    if (signal === 'SIGTERM') {
      restarts.delete(recordId);
      return;
    }

    // 키 만료 여부 확인
    try {
      const rec = await db.getHostingRecord(recordId);
      if (!rec) { restarts.delete(recordId); return; }

      const key = await db.getKeyById(rec.key_id);
      if (!key?.is_active || (key.expires_at && Date.now() > Number(key.expires_at))) {
        await db.updateHostingStatus(recordId, 'stopped', null).catch(() => {});
        restarts.delete(recordId);
        return;
      }
    } catch (_) {}

    // 30초 이상 살아있었으면 카운터 리셋 (안정적인 프로세스였음)
    const lived = Date.now() - startedAt;
    let info = restarts.get(recordId) || { count: 0 };
    if (lived > STABLE_AFTER) info = { count: 0 };

    if (info.count >= MAX_RESTARTS) {
      console.log(`[AutoRestart] ${recordId.slice(0, 8)} 최대 재시작 횟수 초과 — 중지`);
      await db.updateHostingStatus(recordId, 'stopped', null).catch(() => {});
      restarts.delete(recordId);
      return;
    }

    info.count += 1;
    restarts.set(recordId, info);

    console.log(`[AutoRestart] ${recordId.slice(0, 8)} 크래시 감지 → ${RESTART_DELAY / 1000}s 후 재시작 (${info.count}/${MAX_RESTARTS})`);

    // 잠시 후 재시작
    const timer = setTimeout(async () => {
      try {
        await _launch(recordId);
        console.log(`[AutoRestart] ${recordId.slice(0, 8)} 재시작 성공`);
      } catch (err) {
        console.error(`[AutoRestart] ${recordId.slice(0, 8)} 재시작 실패: ${err.message}`);
        await db.updateHostingStatus(recordId, 'stopped', null).catch(() => {});
        restarts.delete(recordId);
      }
    }, RESTART_DELAY);

    // timer 저장 (stopHosting 시 취소 가능하게)
    restarts.set(recordId, { ...info, timer });
  });

  processes.set(recordId, proc);
  await db.updateHostingStatus(recordId, 'running', proc.pid);

  return proc.pid;
}

function stopHosting(recordId) {
  // 대기 중인 재시작 타이머 취소
  const info = restarts.get(recordId);
  if (info?.timer) clearTimeout(info.timer);
  restarts.delete(recordId);

  _kill(recordId);
  db.updateHostingStatus(recordId, 'stopped', null).catch(() => {});
}

function _kill(recordId) {
  const proc = processes.get(recordId);
  if (proc && !proc.killed) {
    try { proc.kill('SIGTERM'); } catch (_) {}
    processes.delete(recordId);
  }
}

function isRunning(recordId) {
  const proc = processes.get(recordId);
  return !!(proc && !proc.killed);
}

function getLog(recordId, lines = 30) {
  const logPath = path.join(hostedDir, recordId, 'output.log');
  if (!fs.existsSync(logPath)) return '(로그 없음)';
  const content = fs.readFileSync(logPath, 'utf8');
  const all = content.split('\n').filter(Boolean);
  return all.slice(-lines).join('\n') || '(로그 없음)';
}

// ── Library management ────────────────────────────────────────────────────

async function installLibrary(recordId, packageName) {
  const record = await db.getHostingRecord(recordId);
  if (!record) throw new Error('호스팅 기록을 찾을 수 없습니다.');

  const dir = path.join(hostedDir, recordId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  return new Promise((resolve, reject) => {
    let cmd, args;

    if (record.language === 'python') {
      const sitePkgs = path.join(dir, 'site-packages');
      if (!fs.existsSync(sitePkgs)) fs.mkdirSync(sitePkgs, { recursive: true });
      cmd  = 'pip3';
      args = ['install', '--target', sitePkgs, '--quiet', packageName];
    } else {
      cmd  = 'npm';
      args = ['install', '--prefix', dir, '--save', '--quiet', packageName];
    }

    let output = '';
    const proc = spawn(cmd, args, { cwd: dir, stdio: ['ignore', 'pipe', 'pipe'] });
    proc.stdout.on('data', d => { output += d.toString(); });
    proc.stderr.on('data', d => { output += d.toString(); });

    proc.on('exit', async (code) => {
      if (code !== 0)
        return reject(new Error(output.slice(-800) || `${cmd} 종료 코드: ${code}`));

      let version = null;
      try {
        if (record.language === 'python') {
          const sitePkgs = path.join(dir, 'site-packages');
          const entries  = fs.readdirSync(sitePkgs);
          const pkgNorm  = packageName.toLowerCase().replace(/[-_.]+/g, '_');
          const distInfo = entries.find(e =>
            e.toLowerCase().replace(/[-_.]+/g, '_').startsWith(pkgNorm + '-') &&
            e.endsWith('.dist-info')
          );
          if (distInfo) {
            const meta = fs.readFileSync(path.join(sitePkgs, distInfo, 'METADATA'), 'utf8');
            const m = meta.match(/^Version:\s*(.+)$/m);
            if (m) version = m[1].trim();
          }
        } else {
          const pkgJson = path.join(dir, 'node_modules', packageName, 'package.json');
          if (fs.existsSync(pkgJson))
            version = JSON.parse(fs.readFileSync(pkgJson, 'utf8')).version || null;
        }
      } catch (_) {}

      const normName = packageName.split('@')[0].split('==')[0].trim();
      await db.addLibrary({ recordId, name: normName, version });
      resolve({ name: normName, version });
    });
  });
}

async function uninstallLibrary(recordId, packageName) {
  const record = await db.getHostingRecord(recordId);
  if (!record) throw new Error('호스팅 기록을 찾을 수 없습니다.');

  const dir = path.join(hostedDir, recordId);

  if (record.language === 'python') {
    const sitePkgs = path.join(dir, 'site-packages');
    if (fs.existsSync(sitePkgs)) _removePythonPackageFiles(sitePkgs, packageName);
    await db.removeLibraryByName(recordId, packageName);
    return;
  }

  await new Promise((resolve, reject) => {
    const proc = spawn('npm', ['uninstall', '--prefix', dir, packageName], {
      cwd: dir, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { out += d.toString(); });
    proc.on('exit', (code) => { code !== 0 ? reject(new Error(out.slice(-400))) : resolve(); });
  });

  await db.removeLibraryByName(recordId, packageName);
}

function _removePythonPackageFiles(sitePkgs, packageName) {
  if (!fs.existsSync(sitePkgs)) return;
  const norm = (s) => s.toLowerCase().replace(/[-_.]+/g, '_');
  const pkgNorm = norm(packageName.split('==')[0].trim());
  try {
    for (const entry of fs.readdirSync(sitePkgs)) {
      const en = norm(entry);
      if (en === pkgNorm || en.startsWith(pkgNorm + '-') || en.startsWith(pkgNorm + '.')) {
        const full = path.join(sitePkgs, entry);
        try {
          fs.statSync(full).isDirectory()
            ? fs.rmSync(full, { recursive: true, force: true })
            : fs.unlinkSync(full);
        } catch (_) {}
      }
    }
  } catch (_) {}
}

// ── Recovery & Expiry ─────────────────────────────────────────────────────

async function recoverRunningProcesses() {
  try {
    const records = await db.getRunningRecords();
    if (!records.length) return;
    console.log(`[Recovery] ${records.length}개 호스팅 자동 복구 시작...`);
    for (const record of records) {
      try {
        const pid = await _launch(record.id);
        console.log(`[Recovery] ✅ ${record.id.slice(0, 8)} (${record.language}) — PID ${pid}`);
      } catch (err) {
        console.error(`[Recovery] ❌ ${record.id.slice(0, 8)} 실패: ${err.message}`);
        await db.updateHostingStatus(record.id, 'stopped', null);
      }
    }
    console.log('[Recovery] 복구 완료');
  } catch (err) {
    console.error('[Recovery] 오류:', err.message);
  }
}

async function startExpiryWatcher() {
  setInterval(async () => {
    try {
      const expiredIds = await db.getExpiredKeyIds();
      if (!expiredIds.length) return;
      const records = await db.getRunningRecordsByKeyIds(expiredIds);
      for (const r of records) {
        stopHosting(r.id);
        console.log(`[ExpiryWatcher] 만료로 중지: ${r.id.slice(0, 8)}`);
      }
      for (const id of expiredIds) await db.deactivateKey(id);
    } catch (err) {
      console.error('[ExpiryWatcher]', err.message);
    }
  }, 60_000);
}

module.exports = {
  startHosting, stopHosting, isRunning, getLog,
  installLibrary, uninstallLibrary,
  LANG_CONFIG, recoverRunningProcesses, startExpiryWatcher,
};
