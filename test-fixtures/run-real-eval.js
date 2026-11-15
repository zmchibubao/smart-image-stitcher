import { createServer } from 'vite';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, '..');
const fixturesDir = __dirname;
const realSamplesDir = path.join(fixturesDir, 'real-samples');
const PORT = 5402;

async function start() {
  console.log('=== Starting Real Images E2E Test Suite ===');

  let testReport = null;

  const server = await createServer({
    root: projectDir,
    server: { port: PORT, strictPort: true },
    plugins: [
      {
        name: 'test-real-plugin',
        configureServer(viteDevServer) {
          viteDevServer.middlewares.use((req, res, next) => {
            if (req.method === 'POST' && req.url.includes('/test-log')) {
              let body = '';
              req.on('data', chunk => body += chunk);
              req.on('end', () => {
                const data = JSON.parse(body);
                console.log('  [REAL-LOG]:', data.msg, data.data ? JSON.stringify(data.data) : '');
                res.writeHead(200);
                res.end();
              });
              return;
            }

            if (req.method === 'GET' && req.url.includes('/real-img/')) {
              const fileName = path.basename(req.url);
              const filePath = path.join(realSamplesDir, fileName);
              if (fs.existsSync(filePath)) {
                res.writeHead(200, { 'Content-Type': 'image/jpeg' });
                fs.createReadStream(filePath).pipe(res);
                return;
              }
              res.writeHead(404);
              res.end('Not found');
              return;
            }

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
  const testUrl = `http://localhost:${PORT}/smart-image-stitcher/test-fixtures/verify-real.html`;

  console.log(`Launching Edge Headless to run test page: ${testUrl}`);
  exec(`"${edgePath}" --headless --disable-gpu "${testUrl}"`, (err) => {
    if (err) console.error('Edge execution notice:', err);
  });

  async function onTestComplete() {
    console.log('\n========================================');
    console.log('      REAL IMAGES TEST RESULTS          ');
    console.log('========================================');
    console.log('Status:           ', testReport.ok ? '✅ FINISHED' : (testReport.success ? '✅ FINISHED' : '❌ FAILED'));
    if (testReport.pairs) {
      console.log('Top Pairs:');
      testReport.pairs.slice(0, 15).forEach(p => {
        console.log(`  ${p.upper} -> ${p.lower}: z=${p.z}, overlap=${p.overlap}, dx=${p.dx}`);
      });
    }
    console.log('Engine Used:      ', testReport.engineUsed);
    console.log('Groups Count:     ', testReport.groups?.length);
    testReport.groups?.forEach((g, idx) => {
      console.log(`  Group ${idx} (id: ${g.id}): [${g.imageIds.join(' -> ')}]`);
    });
    console.log('Pairs Evaluated:  ', testReport.pairMatches?.length || 0);
    testReport.pairMatches?.forEach(p => {
      console.log(`  ${p.a} <-> ${p.b}: dir=${p.direction}, score=${p.score?.toFixed(3)}, overlapH=${p.overlapH}, inliers=${p.inlierCount}, conf=${p.confidence}`);
    });
    console.log('Borders Detected:');
    testReport.borders?.forEach(b => {
      console.log(`  ${b.id}: top=${b.top}, bottom=${b.bottom}, left=${b.left}, right=${b.right}, size=${b.w}x${b.h}`);
    });

    console.log('Dark rows count: ', testReport.darkRowsCount);
    console.log('Quality Report:  ', JSON.stringify(testReport.qualityReport));
    if (testReport.canvases && testReport.canvases.length > 0) {
      testReport.canvases.forEach((c, idx) => {
        const outImgPath = path.join(fixturesDir, `real_stitched_group_${idx}.png`);
        const base64Data = c.dataUrl.replace(/^data:image\/png;base64,/, '');
        fs.writeFileSync(outImgPath, Buffer.from(base64Data, 'base64'));
        console.log(`  Saved group ${idx} canvas: ${outImgPath} (${c.w}x${c.h} px, ${base64Data.length} bytes)`);
      });
    }

    server.close();
    process.exit(0);
  }
}

start();
