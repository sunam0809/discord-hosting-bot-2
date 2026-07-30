require('dotenv').config();

module.exports = {
  token: process.env.DISCORD_BOT_TOKEN,
  clientId: process.env.DISCORD_CLIENT_ID,
  adminUserId: '1531640611977957446',
  port: process.env.PORT || 3000,
};
