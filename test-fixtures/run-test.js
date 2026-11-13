import { createServer } from 'vite';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, '..');
const fixturesDir = __dirname;
const PORT = 5199;

async function start() {
  console.log('=== Starting SmartImageStitcher E2E Test Suite ===');

  let testReport = null;

  const server = await createServer({
    root: projectDir,
    server: { port: PORT, strictPort: true },
    plugins: [
      {
        name: 'test-api-plugin',
        configureServer(viteDevServer) {
          viteDevServer.middlewares.use((req, res, next) => {
            if (req.method === 'POST' && req.url.includes('/test-log')) {
              let body = '';
              req.on('data', chunk => body += chunk);
              req.on('end', () => {
                const data = JSON.parse(body);
                console.log('  [CLIENT-LOG]:', data.msg, data.data ? JSON.stringify(data.data) : '');
                res.writeHead(200);
                res.end();
              });
              return;
            }

            // 提供测试图片文件
            if (req.method === 'GET' && req.url.includes('/fixtures/')) {
              const fileName = path.basename(req.url);
              const filePath = path.join(fixturesDir, fileName);
              if (fs.existsSync(filePath)) {
                res.writeHead(200, { 'Content-Type': 'image/png' });
                fs.createReadStream(filePath).pipe(res);
                return;
              }
              res.writeHead(404);
              res.end('Not found');
              return;
            }

            // 接收测试日志与结果
            if (req.method === 'POST' && (req.url === '/test-result' || req.url.endsWith('/test-result'))) {
              let body = '';
              req.on('data', chunk => body += chunk);
              req.on('end', () => {
                testReport = JSON.parse(body);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true }));

                onTestComplete();
              });
              return;
            }

            next();
          });
        }
      }
    ]
  });

  await server.listen();
  console.log(`Vite Dev Server running on http://localhost:${PORT}/smart-image-stitcher/`);

  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const testUrl = `http://localhost:${PORT}/smart-image-stitcher/test-fixtures/verify-stitch.html`;

  console.log(`Launching Edge Headless to run test page: ${testUrl}`);
  exec(`"${edgePath}" --headless --disable-gpu "${testUrl}"`, (err) => {
    if (err) console.error('Edge execution notice:', err);
  });

  async function onTestComplete() {
    console.log('\n========================================');
    console.log('        TEST EXECUTION RESULTS          ');
    console.log('========================================');
    console.log('Status:           ', testReport.success ? '✅ PASSED' : '❌ FAILED');
    console.log('Engine Used:      ', testReport.engineUsed);
    console.log('Order Restored:   ', testReport.orderRestored ? '✅ YES' : '❌ NO');
    console.log('Final Order:      ', testReport.finalOrder?.join(' -> '));
    console.log('Final Canvas Size:', `${testReport.finalWidth} x ${testReport.finalHeight} px`);
    console.log('Errors:           ', testReport.errors?.length ? testReport.errors : 'None');

    console.log('\nPipeline Steps Log:');
    testReport.steps?.forEach(s => console.log('  ➜', s));

    if (testReport.dataUrl) {
      const outImgPath = path.join(fixturesDir, 'stitched_output.png');
      const base64Data = testReport.dataUrl.replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(outImgPath, Buffer.from(base64Data, 'base64'));
      const size = fs.statSync(outImgPath).size;
      console.log(`\n🎉 Stitched output image successfully generated: ${outImgPath} (${size} bytes)`);
    }

    await server.close();
    process.exit(testReport.success && testReport.orderRestored ? 0 : 1);
  }

  // 40 秒超时
  setTimeout(async () => {
    if (!testReport) {
      console.error('\n❌ Test timed out after 40 seconds');
      await server.close();
      process.exit(1);
    }
  }, 40000);
}

start();
