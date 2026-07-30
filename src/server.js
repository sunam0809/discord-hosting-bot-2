const express = require('express');
const { port } = require('./config');

const app = express();

const startTime = Date.now();

app.get('/', (_req, res) => res.send('🤖 Discord Hosting Bot is alive!'));

app.get('/health', (_req, res) => res.json({
  status: 'ok',
  uptime: Math.floor((Date.now() - startTime) / 1000),
  ts: Date.now(),
}));

// UptimeRobot ping 엔드포인트 (서비스가 절대 잠들지 않도록)
app.get('/ping', (_req, res) => res.send('pong'));

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`[Server] Health check running on port ${port}`);
});

// graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Server] SIGTERM 수신 — 서버 종료 중...');
  server.close(() => process.exit(0));
});

module.exports = app;
