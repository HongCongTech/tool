/**
 * Supabase PostgreSQL Client for Node.js (Zero external dependencies)
 * Supports TLS connection & SCRAM-SHA-256 Authentication
 */
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

class DatabaseClient {
  constructor(config) {
    this.config = {
      host: config.host || '127.0.0.1',
      port: parseInt(config.port || '5432', 10),
      user: config.user || 'postgres',
      password: config.password || '',
      database: config.database || 'postgres'
    };
    this.socket = null;
    this.connected = false;
    this.isConnecting = false;
    this.queryQueue = [];
    this.currentQuery = null;
    this.buffer = Buffer.alloc(0);
    this.connectPromise = null;
  }

  async ensureConnected() {
    if (this.connected) return;
    if (this.isConnecting) return this.connectPromise;
    this.isConnecting = true;
    this.connectPromise = this.connect().finally(() => {
      this.isConnecting = false;
    });
    return this.connectPromise;
  }

  connect() {
    return new Promise((resolve, reject) => {
      try {
        if (this.socket) {
          try { this.socket.destroy(); } catch (e) {}
          this.socket = null;
        }

        const rawSocket = net.createConnection({
          host: this.config.host,
          port: this.config.port
        }, () => {
          // SSLRequest message: length 8, code 80877103 (1234.5679)
          const sslReq = Buffer.alloc(8);
          sslReq.writeInt32BE(8, 0);
          sslReq.writeInt32BE(80877103, 4);
          rawSocket.write(sslReq);
        });

        rawSocket.once('data', (data) => {
          if (String.fromCharCode(data[0]) !== 'S') {
            const err = new Error('Database server does not support SSL');
            return reject(err);
          }

          const tlsSocket = tls.connect({
            socket: rawSocket,
            rejectUnauthorized: false,
            servername: this.config.host
          }, () => {
            this.socket = tlsSocket;
            this.sendStartup();
          });

          tlsSocket.on('error', (err) => {
            console.error('[DB] TLS Socket Error:', err.message);
            this.connected = false;
            if (this.currentQuery) {
              const q = this.currentQuery;
              this.currentQuery = null;
              q.reject(err);
            }
          });

          tlsSocket.on('close', () => {
            this.connected = false;
            this.socket = null;
            console.log('[DB] Database connection closed.');
          });

          this.setupProtocol(tlsSocket, resolve, reject);
        });

        rawSocket.on('error', (err) => {
          console.error('[DB] Network Connection Error:', err.message);
          this.connected = false;
          reject(err);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  sendStartup() {
    const params = [
      'user', this.config.user,
      'database', this.config.database,
      'client_encoding', 'UTF8'
    ];
    const chunks = params.map(p => Buffer.from(p + '\0', 'utf8'));
    chunks.push(Buffer.from('\0'));
    const payload = Buffer.concat(chunks);
    const header = Buffer.alloc(8);
    header.writeInt32BE(payload.length + 8, 0);
    header.writeInt32BE(196608, 4); // Protocol 3.0
    this.socket.write(Buffer.concat([header, payload]));
  }

  createBuffer(type, payload) {
    const len = payload.length + 4;
    const buf = Buffer.alloc(len + 1);
    buf.writeUInt8(type.charCodeAt(0), 0);
    buf.writeInt32BE(len, 1);
    payload.copy(buf, 5);
    return buf;
  }

  setupProtocol(socket, onReady, onError) {
    let clientNonce = '';
    let clientFirstBare = '';
    let rowDesc = [];
    let queryRows = [];

    socket.on('data', (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);

      while (this.buffer.length >= 5) {
        const type = String.fromCharCode(this.buffer[0]);
        const len = this.buffer.readInt32BE(1);
        const totalMsgLen = 1 + len;

        if (this.buffer.length < totalMsgLen) {
          break; // Incomplete packet, wait for more data
        }

        const msg = this.buffer.slice(0, totalMsgLen);
        this.buffer = this.buffer.slice(totalMsgLen);

        if (type === 'R') {
          const authType = msg.readInt32BE(5);
          if (authType === 0) {
            // AuthenticationOk
          } else if (authType === 10) {
            // SASL Authentication
            clientNonce = crypto.randomBytes(18).toString('base64');
            clientFirstBare = `n=${this.config.user},r=${clientNonce}`;
            const clientFirst = `n,,${clientFirstBare}`;

            const mech = Buffer.from('SCRAM-SHA-256\0');
            const saslData = Buffer.from(clientFirst);
            const pBuf = Buffer.alloc(mech.length + 4 + saslData.length);
            mech.copy(pBuf, 0);
            pBuf.writeInt32BE(saslData.length, mech.length);
            saslData.copy(pBuf, mech.length + 4);

            socket.write(this.createBuffer('p', pBuf));
          } else if (authType === 11) {
            // SASLContinue
            const serverFirst = msg.slice(9).toString('utf8');
            const parts = {};
            serverFirst.split(',').forEach(p => {
              const k = p[0];
              const v = p.slice(2);
              parts[k] = v;
            });

            const serverNonce = parts['r'];
            const salt = Buffer.from(parts['s'], 'base64');
            const iterations = parseInt(parts['i'], 10);

            const clientFinalWithoutProof = `c=biws,r=${serverNonce}`;
            const authMessage = `${clientFirstBare},${serverFirst},${clientFinalWithoutProof}`;

            const saltedPassword = crypto.pbkdf2Sync(this.config.password, salt, iterations, 32, 'sha256');
            const clientKey = crypto.createHmac('sha256', saltedPassword).update('Client Key').digest();
            const storedKey = crypto.createHash('sha256').update(clientKey).digest();
            const clientSignature = crypto.createHmac('sha256', storedKey).update(authMessage).digest();
            const clientProof = Buffer.alloc(clientKey.length);
            for (let i = 0; i < clientKey.length; i++) {
              clientProof[i] = clientKey[i] ^ clientSignature[i];
            }

            const clientFinal = `${clientFinalWithoutProof},p=${clientProof.toString('base64')}`;
            socket.write(this.createBuffer('p', Buffer.from(clientFinal)));
          }
        } else if (type === 'Z') {
          // ReadyForQuery
          if (!this.connected) {
            this.connected = true;
            console.log('[DB] Successfully connected and authenticated to Supabase PostgreSQL!');
            onReady();
          } else if (this.currentQuery) {
            const cq = this.currentQuery;
            this.currentQuery = null;
            cq.resolve({ rows: queryRows });
            queryRows = [];
            rowDesc = [];
          }
          this.processNextQuery();
        } else if (type === 'T') {
          // RowDescription
          rowDesc = [];
          const numFields = msg.readInt16BE(5);
          let p = 7;
          for (let i = 0; i < numFields; i++) {
            let nameEnd = p;
            while (nameEnd < msg.length && msg[nameEnd] !== 0) nameEnd++;
            const name = msg.slice(p, nameEnd).toString('utf8');
            p = nameEnd + 1 + 18;
            rowDesc.push(name);
          }
        } else if (type === 'D') {
          // DataRow
          const numCols = msg.readInt16BE(5);
          let p = 7;
          const row = {};
          for (let i = 0; i < numCols; i++) {
            const colLen = msg.readInt32BE(p);
            p += 4;
            const colName = rowDesc[i] || `col_${i}`;
            if (colLen === -1) {
              row[colName] = null;
            } else {
              row[colName] = msg.slice(p, p + colLen).toString('utf8');
              p += colLen;
            }
          }
          queryRows.push(row);
        } else if (type === 'E') {
          // ErrorResponse
          let p = 5;
          let errMsg = '';
          while (p < msg.length - 1) {
            const fieldType = String.fromCharCode(msg[p++]);
            let end = p;
            while (end < msg.length && msg[end] !== 0) end++;
            const val = msg.slice(p, end).toString('utf8');
            if (fieldType === 'M') errMsg = val;
            p = end + 1;
          }
          const err = new Error(errMsg || 'PostgreSQL Error');
          if (!this.connected) {
            onError(err);
          } else if (this.currentQuery) {
            const cq = this.currentQuery;
            this.currentQuery = null;
            cq.reject(err);
          }
        }
      }
    });
  }

  async query(sql) {
    await this.ensureConnected();
    return new Promise((resolve, reject) => {
      this.queryQueue.push({ sql, resolve, reject });
      if (this.connected && !this.currentQuery) {
        this.processNextQuery();
      }
    });
  }

  processNextQuery() {
    if (this.queryQueue.length === 0 || this.currentQuery || !this.connected) return;
    this.currentQuery = this.queryQueue.shift();
    const buf = Buffer.from(this.currentQuery.sql + '\0', 'utf8');
    this.socket.write(this.createBuffer('Q', buf));
  }

  escapeSql(val) {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'number' || typeof val === 'boolean') return String(val);
    return "'" + String(val).replace(/'/g, "''") + "'";
  }
}

module.exports = DatabaseClient;
