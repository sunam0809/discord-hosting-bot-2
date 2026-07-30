const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle,
} = require('discord.js');
const { adminUserId } = require('../config');

async function handleCommand(interaction) {
  if (interaction.user.id !== adminUserId) {
    return interaction.reply({ content: '❌ 이 명령어는 관리자만 사용할 수 있습니다.', ephemeral: true });
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('⚡  코드 호스팅 서비스')
    .setDescription(
      '```\n실행하고 싶은 코드를 언제든 호스팅하세요.\n키 하나로 즉시 시작 · 언제든 수정 · 재시작 가능\n```'
    )
    .addFields(
      {
        name: '🟨  JavaScript',
        value: '> Node.js 환경에서 실행\n> 서버, 봇, 스크립트 등',
        inline: true,
      },
      {
        name: '🐍  Python',
        value: '> Python 3 환경에서 실행\n> 자동화, 크롤링, 분석 등',
        inline: true,
      },
      {
        name: '\u200B',
        value:
          '> 📌 **키가 없으신가요?** 관리자에게 문의하세요.\n' +
          '> ⏰ 키 만료 시 호스팅이 자동으로 종료됩니다.\n' +
          '> 📋 [내 호스팅 기록] 에서 재시작·수정 가능합니다.',
      },
    )
    .setFooter({ text: '아래 버튼을 눌러 시작하세요' })
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('lang:javascript')
      .setLabel('JavaScript 호스팅 시작')
      .setEmoji('🟨')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('lang:python')
      .setLabel('Python 호스팅 시작')
      .setEmoji('🐍')
      .setStyle(ButtonStyle.Success),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('my_history')
      .setLabel('내 호스팅 기록 보기')
      .setEmoji('📋')
      .setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({ embeds: [embed], components: [row1, row2] });
}

module.exports = { handleCommand };
