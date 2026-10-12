const { app, net } = require('electron');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApiFetch } = require('../dist/main/api-fetch.js');

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'taylos-api-network-check-'));
app.setPath('userData', profile);
const server = http.createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  response.writeHead(request.url === '/fail' ? 503 : 200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ body: Buffer.concat(chunks).toString(), type: request.headers['content-type'] }));
});
const deadline = setTimeout(() => { console.error('API network check timed out'); app.exit(1); }, 30000);

app.whenReady().then(async () => {
  let code = 0;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const errors = [];
    const request = createApiFetch((input, init) => net.fetch(input instanceof URL ? input.toString() : input, init),
      fetch, origin, error => errors.push(error));
    const form = new FormData();
    form.set('answers_json', '{"goal":"isolated QA only"}');
    const success = await request(`${origin}/draft`, { method: 'POST', body: form, signal: AbortSignal.timeout(5000) });
    const echo = await success.json();
    assert.match(echo.type, /multipart\/form-data; boundary=/);
    assert.match(echo.body, /isolated QA only/);
    assert.equal(errors.length, 0);
    assert.equal((await request(`${origin}/fail`)).status, 503);
    assert.equal(errors[0].status_code, 503);
    console.log('PASS: real Chromium fetch preserves onboarding multipart data and reports HTTP failures');
  } catch (error) {
    code = 1;
    console.error('FAIL: isolated Chromium network check', error);
  } finally {
    clearTimeout(deadline);
    server.close();
    app.exit(code);
  }
});
