import express from 'express';
import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY;

if (!API_KEY) {
  console.error('Missing API_KEY env variable');
  process.exit(1);
}

const app = express();
app.use(express.json());

// Track live connections and last known relay states per MAC.
const clients = new Map();          // mac -> Set<WebSocket>
const lastRelays = new Map();       // mac -> [relay1, relay2, relay3, relay4]

function pushRelayState(mac, relays) {
  lastRelays.set(mac, relays);
  const set = clients.get(mac);
  if (!set || set.size === 0) {
    return;
  }
  const payload = JSON.stringify({ type: 'relay_update', relays });
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) {
      ws.send(payload);
    }
  }
}

app.post('/relay', (req, res) => {
  const auth = req.header('x-api-key');
  if (auth !== API_KEY) {
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  const { mac, relays } = req.body || {};
  if (typeof mac !== 'string' || !Array.isArray(relays) || relays.length !== 4) {
    return res.status(400).json({ success: false, message: 'Invalid payload' });
  }

  pushRelayState(mac.toUpperCase(), relays.map((v) => (v ? 1 : 0)));
  return res.json({ success: true });
});

const server = app.listen(PORT, () => {
  console.log(`Relay push service listening on ${PORT}`);
});

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '', `http://${req.headers.host}`);
  const mac = (url.searchParams.get('mac') || '').toUpperCase();
  const token = url.searchParams.get('token');

  if (token !== API_KEY || !/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac)) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  const id = randomUUID();
  if (!clients.has(mac)) {
    clients.set(mac, new Set());
  }
  clients.get(mac).add(ws);
  console.log(`WS connected: ${mac} (${clients.get(mac).size})`);

  // Push the last known state immediately.
  const cached = lastRelays.get(mac);
  if (cached) {
    ws.send(JSON.stringify({ type: 'relay_update', relays: cached }));
  }

  ws.on('close', () => {
    const set = clients.get(mac);
    if (set) {
      set.delete(ws);
      if (set.size === 0) {
        clients.delete(mac);
      }
    }
    console.log(`WS disconnected: ${mac}`);
  });
});