const net = require('node:net');

function isPortAvailable(port, host = '127.0.0.1') {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (error) => {
      if (error.code === 'EADDRINUSE' || error.code === 'EACCES') {
        resolve(false);
      } else {
        reject(error);
      }
    });
    server.once('listening', () => {
      server.close((error) => {
        if (error) reject(error);
        else resolve(true);
      });
    });
    server.listen(port, host);
  });
}

class PortManager {
  constructor({ rangeStart = 7681, rangeEnd = 7780, checkPort = isPortAvailable } = {}) {
    if (!Number.isInteger(rangeStart) || !Number.isInteger(rangeEnd) || rangeStart < 1 || rangeEnd > 65535 || rangeStart > rangeEnd) {
      throw new RangeError('Invalid port range');
    }
    this.rangeStart = rangeStart;
    this.rangeEnd = rangeEnd;
    this.checkPort = checkPort;
    this.usedPorts = new Set();
    this.allocationTail = Promise.resolve();
  }

  allocate() {
    const allocation = this.allocationTail.then(() => this.allocateAvailablePort());
    this.allocationTail = allocation.then(() => undefined, () => undefined);
    return allocation;
  }

  async allocateAvailablePort() {
    for (let port = this.rangeStart; port <= this.rangeEnd; port += 1) {
      if (this.usedPorts.has(port)) continue;
      if (await this.checkPort(port, '127.0.0.1')) {
        this.usedPorts.add(port);
        return port;
      }
    }
    throw new Error('No available ports in range');
  }

  release(port) {
    return this.usedPorts.delete(port);
  }
}

module.exports = PortManager;
