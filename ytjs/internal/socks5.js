'use strict';

const net = require('net');

async function connectSocks5(proxy, host, port, timeout = 30000) {
  return new Promise((resolve, reject) => {
    try {
      const socket = net.connect({ host: proxy.host, port: proxy.port });
      socket.setTimeout(timeout, () => { socket.destroy(new Error('Timeout')); });
      socket.once('error', reject);
      socket.once('connect', () => {
        // Greeting
        const methods = [0x00]; // no auth
        const creds = proxy.auth && proxy.auth.username;
        if (creds) methods.unshift(0x02); // username/password
        socket.write(Buffer.from([0x05, methods.length, ...methods]));
        socket.once('data', (res) => {
          if (res.length < 2 || res[0] !== 0x05) return reject(new Error('SOCKS5 invalid greeting'));
          const method = res[1];
          function sendConnect() {
            const hostBuf = Buffer.from(host);
            const req = Buffer.alloc(4 + 1 + hostBuf.length + 2);
            req[0] = 0x05; // ver
            req[1] = 0x01; // cmd=connect
            req[2] = 0x00; // rsv
            req[3] = 0x03; // atyp=domain
            req[4] = hostBuf.length;
            hostBuf.copy(req, 5);
            req.writeUInt16BE(port, 5 + hostBuf.length);
            socket.write(req);
            socket.once('data', (resp) => {
              if (resp.length < 2 || resp[1] !== 0x00) return reject(new Error('SOCKS5 connect failed'));
              resolve(socket);
            });
          }
          if (method === 0x02 && creds) {
            const u = Buffer.from(proxy.auth.username);
            const p = Buffer.from(proxy.auth.password || '');
            const buf = Buffer.concat([Buffer.from([0x01, u.length]), u, Buffer.from([p.length]), p]);
            socket.write(buf);
            socket.once('data', (authRes) => {
              if (authRes.length < 2 || authRes[1] !== 0x00) return reject(new Error('SOCKS5 auth failed'));
              sendConnect();
            });
          } else if (method === 0x00) {
            sendConnect();
          } else {
            return reject(new Error('SOCKS5 no acceptable auth'));
          }
        });
      });
    } catch (e) { reject(e); }
  });
}

module.exports = { connectSocks5 };

