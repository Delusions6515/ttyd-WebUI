const test = require('node:test');
const assert = require('node:assert/strict');
const PortManager = require('../../server/services/port-manager');

test('allocation serializes concurrent requests and does not reuse reserved ports', async () => {
  const checked = [];
  const manager = new PortManager({
    rangeStart: 8000,
    rangeEnd: 8002,
    checkPort: async (port) => {
      checked.push(port);
      await new Promise((resolve) => setTimeout(resolve, 2));
      return port !== 8000;
    },
  });

  const [first, second] = await Promise.all([
    manager.allocate(),
    manager.allocate(),
  ]);

  assert.deepEqual([first, second], [8001, 8002]);
  assert.equal(new Set([first, second]).size, 2);
  assert.ok(checked.includes(8000));
  await assert.rejects(manager.allocate(), /No available ports/);
});

test('release makes a port reusable only after its owner confirms exit', async () => {
  const available = new Set([9000]);
  const manager = new PortManager({
    rangeStart: 9000,
    rangeEnd: 9000,
    checkPort: async (port) => available.has(port),
  });

  const port = await manager.allocate();
  assert.equal(port, 9000);
  await assert.rejects(manager.allocate(), /No available ports/);
  manager.release(port);
  assert.equal(await manager.allocate(), 9000);
});

test('an externally occupied port is skipped', async () => {
  const manager = new PortManager({
    rangeStart: 9100,
    rangeEnd: 9101,
    checkPort: async (port) => port === 9101,
  });

  assert.equal(await manager.allocate(), 9101);
});

test('a real listener makes its port unavailable to the allocator', async (t) => {
  const occupied = require('node:net').createServer();
  await new Promise((resolve) => occupied.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => occupied.close(resolve)));
  const port = occupied.address().port;
  const manager = new PortManager({ rangeStart: port, rangeEnd: port });

  await assert.rejects(manager.allocate(), /No available ports/);
});
