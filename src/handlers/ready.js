const { ActivityType } = require('discord.js');
const hosting = require('../hosting');

module.exports = function ready(client) {
  console.log(`[Bot] Logged in as ${client.user.tag}`);
  client.user.setActivity('코드 호스팅 서비스', { type: ActivityType.Watching });
  hosting.startExpiryWatcher();
};
