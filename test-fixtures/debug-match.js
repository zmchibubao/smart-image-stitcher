import { createServer } from 'vite';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(__dirname, '..');
const fixturesDir = __dirname;
const PORT = 5202;

async function start() {
  const server = await createServer({
    root: projectDir,
    server: { port: PORT, strictPort: true },
    plugins: [
      {
        name: 'test-api-plugin',
        configureServer(viteDevServer) {
          viteDevServer.middlewares.use((req, res, next) => {
            if (req.method === 'GET' && req.url.startsWith('/fixtures/')) {
              const fileName = path.basename(req.url);
              const filePath = path.join(fixturesDir, fileName);
              if (fs.existsSync(filePath)) {
                res.writeHead(200, { 'Content-Type': 'image/png' });
                fs.createReadStream(filePath).pipe(res);
                return;
              }
            }
            if (req.method === 'POST' && req.url === '/debug-log') {
              let body = '';
              req.on('data', chunk => body += chunk);
              req.on('end', () => {
                console.log('\n[SCAN RESULT]:', JSON.parse(body));
                res.writeHead(200);
                res.end();
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

  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const testUrl = `http://localhost:${PORT}/smart-image-stitcher/test-fixtures/debug.html`;
  exec(`"${edgePath}" --headless --disable-gpu "${testUrl}"`);

  setTimeout(async () => {
    await server.close();
    process.exit(0);
  }, 25000);
}

start();
