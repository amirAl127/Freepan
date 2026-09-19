'use strict';

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();

const PORT = Number(process.env.PORT || 3000);
const PANEL_SECRET = process.env.PANEL_SECRET || '';
const PUBLIC_HOST = process.env.PUBLIC_HOST || 'localhost';
const PUBLIC_PORT = Number(process.env.PUBLIC_PORT || 443);
const WS_PATH = normalizeWsPath(process.env.WS_PATH || '/ws');
const SNI = process.env.SNI || PUBLIC_HOST;

const DATA_DIR = '/data';
const LOCAL_DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = fs.existsSync(DATA_DIR)
  ? path.join(DATA_DIR, 'users.json')
  : path.join(LOCAL_DATA_DIR, 'users.json');

function normalizeWsPath(value) {
  let p = String(value || '/ws').trim();

  if (!p.startsWith('/')) {
    p = '/' + p;
  }

  if (p.length > 128) {
    p = p.substring(0, 128);
  }

  return p;
}

function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, '[]', 'utf8');
  }
}

function loadUsers() {
  ensureDataFile();

  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf8');
    const users = JSON.parse(raw);

    return Array.isArray(users) ? users : [];
  } catch {
    return [];
  }
}

function saveUsers(users) {
  ensureDataFile();

  const temporaryFile = `${DATA_FILE}.tmp`;

  fs.writeFileSync(
    temporaryFile,
    JSON.stringify(users, null, 2),
    'utf8'
  );

  fs.renameSync(temporaryFile, DATA_FILE);
}

function generateUUID() {
  return crypto.randomUUID();
}

function sanitizeName(value) {
  return String(value || '')
    .trim()
    .replace(/[<>]/g, '')
    .replace(/\s+/g, ' ')
    .substring(0, 64);
}

function isValidUUID(uuid) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    uuid
  );
}

function auth(req, res, next) {
  if (!PANEL_SECRET) {
    return res.status(500).json({
      error: 'PANEL_SECRET is not configured'
    });
  }

  const token = req.headers.authorization;

  if (!token || token !== `Bearer ${PANEL_SECRET}`) {
    return res.status(401).json({
      error: 'Unauthorized'
    });
  }

  next();
}

function buildVlessLink(user) {
  const params = new URLSearchParams();

  params.set('encryption', 'none');
  params.set('security', 'tls');
  params.set('sni', SNI);
  params.set('type', 'ws');
  params.set('host', PUBLIC_HOST);
  params.set('path', WS_PATH);

  const name = encodeURIComponent(user.name);

  return `vless://${user.uuid}@${PUBLIC_HOST}:${PUBLIC_PORT}?${params.toString()}#${name}`;
}

app.disable('x-powered-by');

app.use(express.json({
  limit: '16kb'
}));

app.use(express.static(
  path.join(__dirname, 'public'),
  {
    index: 'index.html',
    maxAge: '1h'
  }
));

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'vless-panel',
    protocol: 'VLESS',
    transport: 'WebSocket',
    tls: true,
    udp: false
  });
});

app.get('/api/config', auth, (req, res) => {
  res.json({
    host: PUBLIC_HOST,
    port: PUBLIC_PORT,
    sni: SNI,
    wsPath: WS_PATH,
    protocol: 'VLESS',
    transport: 'WebSocket',
    security: 'TLS',
    udp: false
  });
});

app.get('/api/users', auth, (req, res) => {
  const users = loadUsers();

  res.json(
    users.map(user => ({
      ...user,
      vless: user.enabled ? buildVlessLink(user) : null
    }))
  );
});

app.post('/api/users', auth, (req, res) => {
  const name = sanitizeName(req.body?.name);

  if (!name) {
    return res.status(400).json({
      error: 'نام کاربر الزامی است'
    });
  }

  const users = loadUsers();

  const user = {
    id: crypto.randomUUID(),
    uuid: generateUUID(),
    name,
    createdAt: new Date().toISOString(),
    enabled: true
  };

  users.push(user);
  saveUsers(users);

  res.status(201).json({
    ...user,
    vless: buildVlessLink(user)
  });
});

app.patch('/api/users/:id', auth, (req, res) => {
  const users = loadUsers();

  const index = users.findIndex(
    user => user.id === req.params.id
  );

  if (index === -1) {
    return res.status(404).json({
      error: 'کاربر پیدا نشد'
    });
  }

  if (typeof req.body?.enabled !== 'boolean') {
    return res.status(400).json({
      error: 'enabled باید boolean باشد'
    });
  }

  users[index].enabled = req.body.enabled;

  saveUsers(users);

  const user = users[index];

  res.json({
    ...user,
    vless: user.enabled ? buildVlessLink(user) : null
  });
});

app.delete('/api/users/:id', auth, (req, res) => {
  const users = loadUsers();

  const index = users.findIndex(
    user => user.id === req.params.id
  );

  if (index === -1) {
    return res.status(404).json({
      error: 'کاربر پیدا نشد'
    });
  }

  users.splice(index, 1);

  saveUsers(users);

  res.status(204).end();
});

app.get('/api/xray/config', auth, (req, res) => {
  const users = loadUsers()
    .filter(user => user.enabled)
    .map(user => ({
      id: user.uuid,
      email: user.name
    }));

  res.json({
    log: {
      loglevel: 'warning'
    },

    inbounds: [
      {
        tag: 'vless-ws-tls',
        listen: '0.0.0.0',
        port: PUBLIC_PORT,

        protocol: 'vless',

        settings: {
          clients: users,
          decryption: 'none'
        },

        streamSettings: {
          network: 'ws',

          security: 'tls',

          wsSettings: {
            path: WS_PATH
          },

          tlsSettings: {
            serverName: SNI
          }
        }
      }
    ],

    outbounds: [
      {
        protocol: 'freedom',
        tag: 'direct'
      },

      {
        protocol: 'blackhole',
        tag: 'blocked'
      }
    ],

    routing: {
      domainStrategy: 'AsIs',

      rules: []
    }
  });
});

app.get('*', (req, res) => {
  res.sendFile(
    path.join(__dirname, 'public', 'index.html')
  );
});

app.use((err, req, res, next) => {
  console.error(err);

  res.status(500).json({
    error: 'Internal server error'
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`VLESS Panel listening on port ${PORT}`);
  console.log(`Public host: ${PUBLIC_HOST}`);
  console.log(`Public port: ${PUBLIC_PORT}`);
  console.log(`WebSocket path: ${WS_PATH}`);
});
