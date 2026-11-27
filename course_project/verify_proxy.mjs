// Run from the repo root: node course_project/verify_proxy.mjs
// Requires the mock API on :8000 and original editor on :7180.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(new URL('../editor-web/package.json', import.meta.url));
const { createServer } = await import(pathToFileURL(require.resolve('vite')).href);
const { STLLoader } = await import(pathToFileURL(require.resolve('three/addons/loaders/STLLoader.js')).href);
const root = fileURLToPath(new URL('../editor-web/', import.meta.url));
const server = await createServer({ root, server: { port: 0, host: '127.0.0.1', open: false } });
try {
  assert.equal(server.config.server.proxy['/api/v1'].target, 'http://127.0.0.1:8000');
  assert.equal(server.config.server.proxy['/api'], 'http://127.0.0.1:7180');
  assert.equal(server.config.server.proxy['/ws'].target, 'ws://127.0.0.1:7180');
  assert.equal(server.config.server.proxy['/ws'].ws, true);
  await server.listen();
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  const workspace = await fetch(`${base}/api/workspace`);
  assert.equal(workspace.status, 200);
  assert.ok(Array.isArray((await workspace.json()).notebooks));
  for (const endpoint of ['generate', 'rebuild']) {
    const body = endpoint === 'generate' ? { prompt: 'mock preview' } :
      JSON.parse(await readFile(new URL('./mock/model_spec.json', import.meta.url), 'utf8'));
    const response = await fetch(`${base}/api/v1/${endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.cad_mode, 'mock');
    const step = await fetch(`${base}${data.files.step}`);
    assert.equal(step.status, 200);
    assert.ok((await step.text()).includes('ISO-10303-21'));
    const stl = await fetch(`${base}${data.files.stl}`);
    assert.equal(stl.status, 200);
    const geometry = new STLLoader().parse(await stl.arrayBuffer());
    geometry.computeBoundingBox();
    assert.equal(geometry.attributes.position.count, 36);
    const box = geometry.boundingBox;
    assert.deepEqual([box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z], [100, 60, 10]);
    geometry.dispose();
  }
  console.log('PASS: real Vite config routes original editor, generate/rebuild and STEP/STL downloads; Three.js loads 12 triangles at 100x60x10 mm.');
} finally {
  await server.close();
}
