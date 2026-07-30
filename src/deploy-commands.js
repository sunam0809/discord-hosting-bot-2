require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('키생성')
    .setDescription('호스팅 접근 키를 생성합니다 (관리자 전용)'),

  new SlashCommandBuilder()
    .setName('창띄우기')
    .setDescription('코드 호스팅 패널을 채널에 게시합니다 (관리자 전용)'),
].map(cmd => cmd.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
  console.log('슬래시 명령어 등록 중...');
  await rest.put(
    Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
    { body: commands },
  );
  console.log('✅ 슬래시 명령어 등록 완료!');
})().catch(console.error);
