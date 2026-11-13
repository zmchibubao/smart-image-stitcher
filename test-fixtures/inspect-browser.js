import { spawn } from 'child_process';
import http from 'http';

const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const p = spawn(edgePath, [
  '--headless',
  '--remote-debugging-port=9225',
  '--enable-logging',
  'http://localhost:5202/smart-image-stitcher/test-fixtures/debug.html'
]);

p.stderr.on('data', d => console.log('Edge Stderr:', d.toString()));
p.stdout.on('data', d => console.log('Edge Stdout:', d.toString()));

setTimeout(async () => {
  try {
    const res = await fetch('http://localhost:9225/json');
    const targets = await res.json();
    console.log('Targets:', targets);
  } catch (e) {
    console.log('CDP error:', e.message);
  }
  p.kill();
  process.exit(0);
}, 6000);
