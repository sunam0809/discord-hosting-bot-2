require('./server');

const { Client, GatewayIntentBits } = require('discord.js');
const { token } = require('./config');
const db = require('./database');
const hosting = require('./hosting');
const readyHandler = require('./handlers/ready');
const interactionCreateHandler = require('./handlers/interactionCreate');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', (c) => readyHandler(c));
client.on('interactionCreate', (interaction) => interactionCreateHandler(interaction));

(async () => {
  try {
    // 1. Init DB tables
    await db.init();
  } catch (err) {
    console.error('[DB] 초기화 실패 (계속 진행):', err.message);
  }

  try {
    // 2. Auto-recover previously running processes
    await hosting.recoverRunningProcesses();
  } catch (err) {
    console.error('[Recovery] 복구 실패 (계속 진행):', err.message);
  }

  try {
    // 3. Login
    await client.login(token);
  } catch (err) {
    // 로그인 실패해도 Express 헬스체크 서버는 살아있어야 함
    console.error('[Bot] Discord 로그인 실패:', err.message);
    console.error('[Bot] 헬스체크 서버는 계속 실행 중입니다. 환경변수(DISCORD_BOT_TOKEN)를 확인하세요.');
  }
})();
