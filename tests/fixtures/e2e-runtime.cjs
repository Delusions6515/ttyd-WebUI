const { spawn } = require('node:child_process');
const path = require('node:path');
const { createRuntime } = require('./runtime.cjs');

const mode = process.argv[2];
if (!['development', 'production'].includes(mode)) throw new Error('Choose development or production runtime mode');
const repositoryRoot = path.resolve(__dirname, '../..');
const frontendRoot = path.join(repositoryRoot, 'frontend');
const appPort = mode === 'production'
  ? Number(process.env.E2E_PRODUCTION_PORT || 4179)
  : 0;
const vitePort = Number(process.env.E2E_VITE_PORT || 5179);
const viteOrigin = mode === 'development' ? `http://127.0.0.1:${vitePort}` : undefined;
let runtime;
let vite;
let stopping = false;
let viteOutput = '';

async function waitForHttp(url, child) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (child?.exitCode !== null && child?.exitCode !== undefined) {
      throw new Error(`Vite exited before becoming ready: ${viteOutput}`);
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Retry while the local server starts.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${url}${viteOutput ? `: ${viteOutput}` : ''}`);
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  if (vite && vite.exitCode === null) {
    vite.kill('SIGTERM');
    await new Promise((resolve) => vite.once('exit', resolve));
  }
  await runtime?.close();
}

async function start() {
  runtime = await createRuntime({ port: appPort, viteOrigin });
  let origin = runtime.origin;
  if (mode === 'development') {
    const vitePackage = require.resolve('vite/package.json', { paths: [frontendRoot] });
    const viteEntry = path.resolve(path.dirname(vitePackage), require(vitePackage).bin.vite);
    vite = spawn(process.execPath, [viteEntry, '--host', '127.0.0.1', '--port', String(vitePort), '--strictPort'], {
      cwd: frontendRoot,
      env: {
        ...process.env,
        VITE_API_PROXY_TARGET: runtime.origin,
        VITE_ORIGIN: viteOrigin,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    vite.stdout.on('data', (chunk) => { viteOutput += chunk.toString(); });
    vite.stderr.on('data', (chunk) => { viteOutput += chunk.toString(); });
    origin = viteOrigin;
    await waitForHttp(origin, vite);
  } else {
    await waitForHttp(origin);
  }
  console.log(`E2E ${mode} runtime ready at ${origin}`);
}

async function handleShutdownSignal() {
  try {
    await shutdown();
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => { void handleShutdownSignal(); });
process.once('SIGTERM', () => { void handleShutdownSignal(); });

start().catch(async (error) => {
  console.error(error);
  await shutdown().catch((cleanupError) => console.error(cleanupError));
  process.exitCode = 1;
});
