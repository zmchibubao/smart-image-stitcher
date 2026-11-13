const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const PORT = 38992;
const fixturesDir = __dirname;

const server = http.createServer((req, res) => {
  if (req.method === 'GET') {
    const htmlPath = path.join(fixturesDir, 'generate.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    // 注入自动上传脚本
    html = html.replace('document.body.innerText = "DONE: " + Object.keys(results).length;', `
      fetch('/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(results)
      }).then(() => {
        document.body.innerText = "SAVED_ALL";
      });
    `);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(html);
  } else if (req.method === 'POST' && req.url === '/save') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const images = JSON.parse(body);
      for (const [name, dataUrl] of Object.entries(images)) {
        const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
        const filePath = path.join(fixturesDir, name);
        fs.writeFileSync(filePath, Buffer.from(base64Data, 'base64'));
        console.log('Saved test image:', filePath, 'Size:', fs.statSync(filePath).size);
      }
      res.writeHead(200);
      res.end('OK');

      setTimeout(() => {
        console.log('Test fixtures generated successfully!');
        process.exit(0);
      }, 500);
    });
  }
});

server.listen(PORT, () => {
  const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const url = `http://localhost:${PORT}/`;
  console.log(`Starting headless browser to generate images from ${url}`);
  exec(`"${edgePath}" --headless --disable-gpu "${url}"`, (err) => {
    if (err) console.error('Browser run error:', err);
  });
});
