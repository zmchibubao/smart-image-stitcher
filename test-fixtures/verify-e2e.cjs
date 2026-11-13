const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn, exec } = require('child_process');

const VITE_PORT = 5179;
const projectDir = path.resolve(__dirname, '..');
const fixturesDir = __dirname;

async function run() {
  console.log('--- Step 1: Starting Vite Dev Server for E2E Test ---');

  let testReport = null;

  // 启动辅助收集测试结果的 HTTP 服务 (端口 38993)
  const reportServer = http.createServer((req, res) => {
    // 允许跨域
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url.startsWith('/fixtures/')) {
      const fileName = path.basename(req.url);
      const filePath = path.join(fixturesDir, fileName);
      if (fs.existsSync(filePath)) {
        res.writeHead(200, { 'Content-Type': 'image/png' });
        fs.createReadStream(filePath).pipe(res);
        return;
      }
      res.writeHead(404);
      res.end();
      return;
    }

    if (req.method === 'POST' && req.url === '/test-result') {
      let body = '';
      req.on('data', chunk => body += chunk);
      req.on('end', () => {
        testReport = JSON.parse(body);
        res.writeHead(200);
        res.end('OK');

        console.log('\n=== E2E Test Result Received ===');
        console.log('Success:', testReport.success);
        console.log('Engine Used:', testReport.engineUsed);
        console.log('Order Restored:', testReport.orderRestored);
        console.log('Final Order:', testReport.finalOrder);
        console.log('Final Canvas Size:', `${testReport.finalWidth}x${testReport.finalHeight}`);
        console.log('Errors:', testReport.errors);
        console.log('\nPipeline Steps:');
        testReport.steps.forEach(s => console.log('  ', s));

        if (testReport.dataUrl) {
          const outImgPath = path.join(fixturesDir, 'stitched_output.png');
          const base64Data = testReport.dataUrl.replace(/^data:image\/png;base64,/, '');
          fs.writeFileSync(outImgPath, Buffer.from(base64Data, 'base64'));
          console.log('\n Stitched output image saved to:', outImgPath, `(${fs.statSync(outImgPath).size} bytes)`);
        }

        cleanupAndExit(testReport.success && testReport.orderRestored ? 0 : 1);
      });
    }
  });

  await new Promise(r => reportServer.listen(38993, r));
  console.log('Test helper server listening on port 38993');

  // 启动 Vite
  const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const viteProcess = spawn(npxCmd, ['vite', '--port', String(VITE_PORT), '--strictPort'], {
    cwd: projectDir,
    shell: true,
    stdio: 'pipe'
  });

  viteProcess.stdout.on('data', d => {
    const msg = d.toString();
    if (msg.includes('Local:')) {
      console.log('Vite Server Ready:', msg.trim());
      launchEdge();
    }
  });

  viteProcess.stderr.on('data', d => {
    // console.error('Vite err:', d.toString());
  });

  function launchEdge() {
    const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
    const testPageUrl = `http://localhost:${VITE_PORT}/test-fixtures/verify-stitch.html`;
    console.log(`--- Step 2: Launching Headless Edge to execute pipeline: ${testPageUrl} ---`);
    exec(`"${edgePath}" --headless --disable-gpu "${testPageUrl}"`, (err) => {
      if (err) console.error('Edge execution error:', err);
    });
  }

  function cleanupAndExit(code) {
    try { viteProcess.kill(); } catch (e) {}
    try { reportServer.close(); } catch (e) {}
    setTimeout(() => process.exit(code), 500);
  }

  // 25秒超时防护
  setTimeout(() => {
    if (!testReport) {
      console.error('Test timed out after 25s without result');
      cleanupAndExit(1);
    }
  }, 25000);
}

run();
