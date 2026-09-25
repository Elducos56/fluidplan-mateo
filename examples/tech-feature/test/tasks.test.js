process.env.NODE_ENV = 'test';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/db');
const migrate = require('../src/db/migrate');
const app = require('../src/server');

let server;
let base;

before(() => {
  migrate();
  db.prepare("INSERT INTO users (id, email, name) VALUES (1, 'ana@example.test', 'Ana')").run();
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const call = (method, url, body) => fetch(base + url, {
  method,
  headers: { 'content-type': 'application/json', 'x-user-id': '1' },
  body: body && JSON.stringify(body),
});

test('creates then lists a task', async () => {
  const created = await call('POST', '/api/tasks', { title: 'Pay the rent', dueDate: '2026-10-01' });
  assert.equal(created.status, 201);
  const list = await (await call('GET', '/api/tasks')).json();
  assert.deepEqual(list.map((t) => t.title), ['Pay the rent']);
});

test('rejects a malformed due date', async () => {
  const res = await call('POST', '/api/tasks', { title: 'Follow up with the client', dueDate: '01/10/2026' });
  assert.equal(res.status, 400);
});

test('returns 401 without a user', async () => {
  const res = await fetch(`${base}/api/tasks`);
  assert.equal(res.status, 401);
});
