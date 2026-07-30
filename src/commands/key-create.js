const {
  ModalBuilder, TextInputBuilder, TextInputStyle, ActionRowBuilder, EmbedBuilder,
} = require('discord.js');
const db = require('../database');
const { adminUserId } = require('../config');

async function handleCommand(interaction) {
  if (interaction.user.id !== adminUserId)
    return interaction.reply({ content: '❌ 이 명령어는 관리자만 사용할 수 있습니다.', ephemeral: true });

  const modal = new ModalBuilder().setCustomId('modal_key_create').setTitle('🔑 키 생성');
  modal.addComponents(
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('label').setLabel('키 레이블 (선택 — 고객 이름 등)').setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(50),
    ),
    new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('days').setLabel('유효기간 (일 수 — 0 입력 시 무제한)').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('예: 30  (30일)  |  0 (무제한)'),
    ),
  );
  await interaction.showModal(modal);
}

async function handleModalSubmit(interaction) {
  const label   = interaction.fields.getTextInputValue('label').trim() || null;
  const daysStr = interaction.fields.getTextInputValue('days').trim();
  const days    = parseInt(daysStr, 10);

  if (isNaN(days) || days < 0)
    return interaction.reply({ content: '❌ 유효기간은 0 이상의 숫자여야 합니다.', ephemeral: true });

  const expiresAt = days === 0 ? null : Date.now() + days * 24 * 60 * 60 * 1000;
  const { keyValue } = await db.createKey({ createdBy: interaction.user.id, label, expiresAt });

  const expiryText = expiresAt
    ? `<t:${Math.floor(expiresAt / 1000)}:F> (<t:${Math.floor(expiresAt / 1000)}:R>)`
    : '무제한';

  await interaction.reply({
    embeds: [
      new EmbedBuilder().setTitle('✅ 키 생성 완료').setColor(0x57f287)
        .addFields(
          { name: '🔑 키', value: `\`\`\`${keyValue}\`\`\`` },
          { name: '📌 레이블', value: label || '없음', inline: true },
          { name: '⏰ 만료', value: expiryText, inline: true },
        )
        .setFooter({ text: '고객에게 이 키를 전달하세요.' }).setTimestamp(),
    ],
    ephemeral: true,
  });
}

module.exports = { handleCommand, handleModalSubmit };
