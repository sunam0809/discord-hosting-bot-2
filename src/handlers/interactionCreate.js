const {
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
} = require('discord.js');
const db        = require('../database');
const hosting   = require('../hosting');
const keyCreate = require('../commands/key-create');

const STATUS_ICON = (alive) => alive ? '🟢 실행 중' : '🔴 중지됨';
const LANG_LABEL  = (lang)  => hosting.LANG_CONFIG[lang] ?? { emoji: '📦', label: lang };
const PAGE_SIZE   = 2; // 2 records × 2 rows each = 4 rows, + 1 navigation row = 5 max

// ── History embed builder (paginated, 2 per page) ─────────────────────────

function buildHistoryEmbed(records, page = 0) {
  const embed = new EmbedBuilder().setColor(0x5865F2).setTitle('📋  내 호스팅 기록').setTimestamp();

  if (!records.length) {
    embed.setDescription('```\n아직 호스팅 기록이 없습니다.\n패널에서 언어를 선택해 첫 호스팅을 시작해보세요!\n```');
    return { embed, components: [] };
  }

  const totalPages = Math.ceil(records.length / PAGE_SIZE);
  const safePage   = Math.max(0, Math.min(page, totalPages - 1));
  const slice      = records.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  embed.setDescription(`총 **${records.length}**개  ·  ${safePage + 1} / ${totalPages} 페이지`);
  const components = [];

  slice.forEach((rec, i) => {
    const cfg    = LANG_LABEL(rec.language);
    const alive  = hosting.isRunning(rec.id);
    const absIdx = safePage * PAGE_SIZE + i + 1;

    embed.addFields({
      name: `${absIdx}.  ${cfg.emoji}  ${cfg.label}  ·  \`${rec.id.slice(0, 8)}\``,
      value:
        `> 상태  **${STATUS_ICON(alive)}**\n` +
        `> 생성  <t:${Math.floor(Number(rec.created_at) / 1000)}:R>\n` +
        `> 수정  <t:${Math.floor(Number(rec.updated_at) / 1000)}:R>`,
    });

    // Row 1: control buttons
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`rec_restart:${rec.id}`).setLabel('재시작').setEmoji('▶️').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`rec_edit:${rec.id}`).setLabel('수정').setEmoji('⚙️').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`rec_stop:${rec.id}`).setLabel('중지').setEmoji('⏹️').setStyle(ButtonStyle.Danger).setDisabled(!alive),
      new ButtonBuilder().setCustomId(`rec_log:${rec.id}`).setLabel('로그').setEmoji('📄').setStyle(ButtonStyle.Secondary),
    ));

    // Row 2: library + delete
    components.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`libs_view:${rec.id}`).setLabel('라이브러리').setEmoji('📦').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`rec_delete_confirm:${rec.id}:${safePage}`).setLabel('호스팅 삭제').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
    ));
  });

  // Navigation row (always show if >0 records to allow refresh + paging)
  const navRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`hist_page:${safePage - 1}`)
      .setLabel('← 이전')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage <= 0),
    new ButtonBuilder()
      .setCustomId(`hist_page:${safePage + 1}`)
      .setLabel('다음 →')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage >= totalPages - 1),
  );
  components.push(navRow);

  return { embed, components };
}

// ── Library panel embed builder ───────────────────────────────────────────

async function buildLibraryEmbed(record, libs) {
  const cfg   = LANG_LABEL(record.language);
  const embed = new EmbedBuilder()
    .setColor(0xFEE75C)
    .setTitle(`📦  라이브러리 관리  ·  ${cfg.emoji} ${cfg.label}  \`${record.id.slice(0, 8)}\``)
    .setTimestamp();

  if (!libs.length) {
    embed.setDescription('```\n설치된 라이브러리가 없습니다.\n아래 버튼으로 설치하세요.\n```');
  } else {
    embed.setDescription(
      libs.map((l, i) =>
        `${i + 1}. \`${l.name}\`${l.version ? `  v${l.version}` : ''}  — <t:${Math.floor(Number(l.installed_at) / 1000)}:R>`
      ).join('\n')
    );
  }

  const components = [];
  const installRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`lib_install:${record.id}`).setLabel('라이브러리 설치').setEmoji('➕').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`my_history:0`).setLabel('← 기록으로').setStyle(ButtonStyle.Secondary),
  );
  components.push(installRow);

  // Delete buttons: max 4 per row, max 4 rows
  for (let i = 0; i < Math.min(libs.length, 16); i += 4) {
    const chunk = libs.slice(i, i + 4);
    components.push(new ActionRowBuilder().addComponents(
      chunk.map(l =>
        new ButtonBuilder()
          .setCustomId(`lib_delete:${l.id}:${record.id}`)
          .setLabel(`삭제: ${l.name}`)
          .setEmoji('🗑️')
          .setStyle(ButtonStyle.Danger)
      )
    ));
  }

  return { embed, components };
}

// ── Main handler ──────────────────────────────────────────────────────────

module.exports = async function interactionCreate(interaction) {
  try {

    // ── Slash commands ────────────────────────────────────────────────────
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === '키생성')  return keyCreate.handleCommand(interaction);
      if (interaction.commandName === '창띄우기') return require('../commands/open-panel').handleCommand(interaction);
    }

    // ── Modal: key create ─────────────────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId === 'modal_key_create')
      return keyCreate.handleModalSubmit(interaction);

    // ── Button: language selected ─────────────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('lang:')) {
      const language = interaction.customId.split(':')[1];
      const cfg      = hosting.LANG_CONFIG[language];
      const modal    = new ModalBuilder()
        .setCustomId(`code_submit:${language}`)
        .setTitle(`${cfg.emoji}  ${cfg.label} 호스팅 시작`);
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('key_input').setLabel('🔑  인증 키').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder('관리자에게 받은 키를 입력하세요'),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('code_input').setLabel('📝  코드').setStyle(TextInputStyle.Paragraph).setRequired(true).setPlaceholder('실행할 코드를 여기에 붙여넣으세요'),
        ),
      );
      return interaction.showModal(modal);
    }

    // ── Button: my_history (+ page) ───────────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('my_history')) {
      const page    = parseInt(interaction.customId.split(':')[1] || '0', 10) || 0;
      const records = await db.getHostingRecordsByUser(interaction.user.id);
      const { embed, components } = buildHistoryEmbed(records, page);
      if (interaction.replied || interaction.deferred) {
        return interaction.editReply({ embeds: [embed], components });
      }
      return interaction.reply({ embeds: [embed], components, ephemeral: true });
    }

    // ── Button: hist_page (pagination) ────────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('hist_page:')) {
      const page    = Math.max(0, parseInt(interaction.customId.split(':')[1], 10) || 0);
      const records = await db.getHostingRecordsByUser(interaction.user.id);
      const { embed, components } = buildHistoryEmbed(records, page);
      await interaction.deferUpdate();
      return interaction.editReply({ embeds: [embed], components });
    }

    // ── Modal: code_submit (new hosting) ──────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId.startsWith('code_submit:')) {
      const language = interaction.customId.split(':')[1];
      const keyValue = interaction.fields.getTextInputValue('key_input').trim();
      const code     = interaction.fields.getTextInputValue('code_input');

      const { valid, key, reason } = await db.validateKey(keyValue);
      if (!valid)
        return interaction.reply({ content: `❌ 키 오류: ${reason}`, ephemeral: true });

      await interaction.deferReply({ ephemeral: true });
      const recordId = await db.createHostingRecord({
        keyId: key.id, userId: interaction.user.id,
        username: interaction.user.username, language, code,
      });

      try {
        const pid = await hosting.startHosting(recordId);
        const cfg = hosting.LANG_CONFIG[language];
        return interaction.editReply({
          embeds: [
            new EmbedBuilder().setColor(0x57F287).setTitle('✅  호스팅 시작됨')
              .addFields(
                { name: '언어', value: `${cfg.emoji}  ${cfg.label}`, inline: true },
                { name: 'PID', value: `\`${pid}\``, inline: true },
                { name: '기록 ID', value: `\`${recordId.slice(0, 8)}\``, inline: true },
              )
              .setDescription('> 📦 라이브러리가 필요하면 [내 호스팅 기록] → [라이브러리] 버튼을 누르세요.')
              .setTimestamp(),
          ],
        });
      } catch (err) {
        return interaction.editReply({ content: `❌ 호스팅 실패: ${err.message}` });
      }
    }

    // ── Button: rec_restart ───────────────────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('rec_restart:')) {
      const recordId = interaction.customId.split(':')[1];
      const record   = await db.getHostingRecord(recordId);
      if (!record || record.user_id !== interaction.user.id)
        return interaction.reply({ content: '❌ 권한이 없습니다.', ephemeral: true });

      const keyRow = await db.getKeyById(record.key_id);
      if (!keyRow?.is_active || (keyRow.expires_at && Date.now() > Number(keyRow.expires_at))) {
        return interaction.reply({
          embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle('⚠️  키 만료').setDescription('키가 만료되어 재시작할 수 없습니다.\n새 키를 받아 다시 호스팅하세요.')],
          ephemeral: true,
        });
      }

      await interaction.deferReply({ ephemeral: true });
      try {
        const pid = await hosting.startHosting(recordId);
        const cfg = hosting.LANG_CONFIG[record.language];
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('▶️  재시작 완료')
            .addFields({ name: '언어', value: `${cfg.emoji}  ${cfg.label}`, inline: true }, { name: 'PID', value: `\`${pid}\``, inline: true })
            .setTimestamp()],
        });
      } catch (err) {
        return interaction.editReply({ content: `❌ 재시작 실패: ${err.message}` });
      }
    }

    // ── Button: rec_stop ──────────────────────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('rec_stop:')) {
      const recordId = interaction.customId.split(':')[1];
      const record   = await db.getHostingRecord(recordId);
      if (!record || record.user_id !== interaction.user.id)
        return interaction.reply({ content: '❌ 권한이 없습니다.', ephemeral: true });

      hosting.stopHosting(recordId);
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('⏹️  중지 완료')
          .setDescription(`\`${recordId.slice(0, 8)}\` 호스팅이 중지되었습니다.`).setTimestamp()],
        ephemeral: true,
      });
    }

    // ── Button: rec_edit ──────────────────────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('rec_edit:')) {
      const recordId = interaction.customId.split(':')[1];
      const record   = await db.getHostingRecord(recordId);
      if (!record || record.user_id !== interaction.user.id)
        return interaction.reply({ content: '❌ 권한이 없습니다.', ephemeral: true });

      const cfg   = LANG_LABEL(record.language);
      const modal = new ModalBuilder()
        .setCustomId(`code_edit:${recordId}`)
        .setTitle(`⚙️  ${cfg.emoji} ${cfg.label} 수정`);
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('lang_input').setLabel('언어 (javascript / python)').setStyle(TextInputStyle.Short).setRequired(true).setValue(record.language),
        ),
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('code_input').setLabel('코드').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue(record.code.slice(0, 4000)),
        ),
      );
      return interaction.showModal(modal);
    }

    // ── Modal: code_edit ──────────────────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId.startsWith('code_edit:')) {
      const recordId = interaction.customId.split(':')[1];
      const record   = await db.getHostingRecord(recordId);
      if (!record || record.user_id !== interaction.user.id)
        return interaction.reply({ content: '❌ 권한이 없습니다.', ephemeral: true });

      const language = interaction.fields.getTextInputValue('lang_input').trim().toLowerCase();
      const code     = interaction.fields.getTextInputValue('code_input');

      if (!hosting.LANG_CONFIG[language])
        return interaction.reply({ content: `❌ 지원하지 않는 언어입니다. (javascript 또는 python)`, ephemeral: true });

      const keyRow = await db.getKeyById(record.key_id);
      if (!keyRow?.is_active || (keyRow.expires_at && Date.now() > Number(keyRow.expires_at)))
        return interaction.reply({ embeds: [new EmbedBuilder().setColor(0xFEE75C).setTitle('⚠️  키 만료').setDescription('키가 만료되어 재시작할 수 없습니다.')], ephemeral: true });

      await interaction.deferReply({ ephemeral: true });
      await db.updateHostingCode(recordId, language, code);
      try {
        const pid = await hosting.startHosting(recordId);
        const cfg = hosting.LANG_CONFIG[language];
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('⚙️  수정 & 재시작 완료')
            .addFields({ name: '언어', value: `${cfg.emoji}  ${cfg.label}`, inline: true }, { name: 'PID', value: `\`${pid}\``, inline: true })
            .setTimestamp()],
        });
      } catch (err) {
        return interaction.editReply({ content: `❌ 재시작 실패: ${err.message}` });
      }
    }

    // ── Button: rec_log ───────────────────────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('rec_log:')) {
      const recordId = interaction.customId.split(':')[1];
      const record   = await db.getHostingRecord(recordId);
      if (!record || record.user_id !== interaction.user.id)
        return interaction.reply({ content: '❌ 권한이 없습니다.', ephemeral: true });

      const log       = hosting.getLog(recordId, 30);
      const truncated = log.length > 1800 ? '...(앞부분 생략)\n' + log.slice(-1800) : log;
      return interaction.reply({
        embeds: [new EmbedBuilder().setColor(0x5865F2)
          .setTitle(`📄  실행 로그  ·  \`${recordId.slice(0, 8)}\``)
          .setDescription(`\`\`\`\n${truncated || '(로그 없음)'}\n\`\`\``)
          .setTimestamp()],
        ephemeral: true,
      });
    }

    // ── Button: rec_delete_confirm ────────────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('rec_delete_confirm:')) {
      const parts    = interaction.customId.split(':');
      const recordId = parts[1];
      const page     = parseInt(parts[2] || '0', 10);
      const record   = await db.getHostingRecord(recordId);
      if (!record || record.user_id !== interaction.user.id)
        return interaction.reply({ content: '❌ 권한이 없습니다.', ephemeral: true });

      const cfg = LANG_LABEL(record.language);
      return interaction.reply({
        embeds: [
          new EmbedBuilder().setColor(0xED4245).setTitle('🗑️  정말 삭제하시겠습니까?')
            .setDescription(
              `**${cfg.emoji}  ${cfg.label}**  ·  \`${recordId.slice(0, 8)}\`\n\n` +
              `> ⚠️ 삭제하면 코드, 라이브러리 기록이 모두 사라집니다.\n> 실행 중이라면 즉시 중지됩니다.`
            )
            .setTimestamp(),
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`rec_delete_do:${recordId}:${page}`).setLabel('삭제 확인').setEmoji('🗑️').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId(`hist_page:${page}`).setLabel('취소').setStyle(ButtonStyle.Secondary),
          ),
        ],
        ephemeral: true,
      });
    }

    // ── Button: rec_delete_do (confirmed delete) ──────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('rec_delete_do:')) {
      const parts    = interaction.customId.split(':');
      const recordId = parts[1];
      const page     = parseInt(parts[2] || '0', 10);
      const record   = await db.getHostingRecord(recordId);
      if (!record || record.user_id !== interaction.user.id)
        return interaction.reply({ content: '❌ 권한이 없습니다.', ephemeral: true });

      // Stop if running
      if (hosting.isRunning(recordId)) hosting.stopHosting(recordId);

      // Delete from DB (libraries cascade-delete)
      await db.deleteHostingRecord(recordId);

      // Show updated history
      const records = await db.getHostingRecordsByUser(interaction.user.id);
      const safePage = Math.max(0, Math.min(page, Math.ceil(records.length / PAGE_SIZE) - 1));
      const { embed, components } = buildHistoryEmbed(records, safePage);

      await interaction.deferUpdate();
      return interaction.editReply({
        embeds: [embed],
        components,
      });
    }

    // ── Button: libs_view ─────────────────────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('libs_view:')) {
      const recordId = interaction.customId.split(':')[1];
      const record   = await db.getHostingRecord(recordId);
      if (!record || record.user_id !== interaction.user.id)
        return interaction.reply({ content: '❌ 권한이 없습니다.', ephemeral: true });

      const libs = await db.getLibraries(recordId);
      const { embed, components } = await buildLibraryEmbed(record, libs);
      return interaction.reply({ embeds: [embed], components, ephemeral: true });
    }

    // ── Button: lib_install (show modal) ──────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('lib_install:')) {
      const recordId = interaction.customId.split(':')[1];
      const record   = await db.getHostingRecord(recordId);
      if (!record || record.user_id !== interaction.user.id)
        return interaction.reply({ content: '❌ 권한이 없습니다.', ephemeral: true });

      const cfg   = LANG_LABEL(record.language);
      const ph    = record.language === 'python' ? '예: requests  또는  discord.py==2.3.2' : '예: axios  또는  axios@1.6.0';
      const modal = new ModalBuilder().setCustomId(`modal_lib_install:${recordId}`).setTitle(`📦  라이브러리 설치  (${cfg.emoji} ${cfg.label})`);
      modal.addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder().setCustomId('package_name').setLabel('패키지 이름').setStyle(TextInputStyle.Short).setRequired(true).setPlaceholder(ph),
        ),
      );
      return interaction.showModal(modal);
    }

    // ── Modal: lib_install ────────────────────────────────────────────────
    if (interaction.isModalSubmit() && interaction.customId.startsWith('modal_lib_install:')) {
      const recordId    = interaction.customId.split(':')[1];
      const record      = await db.getHostingRecord(recordId);
      if (!record || record.user_id !== interaction.user.id)
        return interaction.reply({ content: '❌ 권한이 없습니다.', ephemeral: true });

      const packageName = interaction.fields.getTextInputValue('package_name').trim();
      if (!packageName)
        return interaction.reply({ content: '❌ 패키지 이름을 입력하세요.', ephemeral: true });

      await interaction.deferReply({ ephemeral: true });
      try {
        const { name, version } = await hosting.installLibrary(recordId, packageName);
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0x57F287).setTitle('✅  라이브러리 설치 완료')
            .addFields(
              { name: '패키지', value: `\`${name}\``, inline: true },
              { name: '버전',   value: version ? `v${version}` : '(버전 불명)', inline: true },
            )
            .setDescription('> 변경사항을 적용하려면 **재시작** 버튼을 눌러주세요.')
            .setTimestamp()],
        });
      } catch (err) {
        return interaction.editReply({
          embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌  설치 실패')
            .setDescription(`\`\`\`\n${err.message.slice(0, 1000)}\n\`\`\``)
            .setTimestamp()],
        });
      }
    }

    // ── Button: lib_delete ────────────────────────────────────────────────
    if (interaction.isButton() && interaction.customId.startsWith('lib_delete:')) {
      const parts    = interaction.customId.split(':');
      const libId    = parts[1];
      const recordId = parts[2];
      const record   = await db.getHostingRecord(recordId);
      if (!record || record.user_id !== interaction.user.id)
        return interaction.reply({ content: '❌ 권한이 없습니다.', ephemeral: true });

      const libs   = await db.getLibraries(recordId);
      const target = libs.find(l => l.id === libId);
      if (!target)
        return interaction.reply({ content: '❌ 라이브러리를 찾을 수 없습니다.', ephemeral: true });

      await interaction.deferReply({ ephemeral: true });
      try {
        await hosting.uninstallLibrary(recordId, target.name);
        const updatedLibs = await db.getLibraries(recordId);
        const { embed, components } = await buildLibraryEmbed(record, updatedLibs);
        return interaction.editReply({ embeds: [embed], components });
      } catch (err) {
        return interaction.editReply({ content: `❌ 삭제 실패: ${err.message}` });
      }
    }

  } catch (err) {
    console.error('[InteractionCreate]', err);
    const msg = {
      embeds: [new EmbedBuilder().setColor(0xED4245).setTitle('❌  오류 발생').setDescription('처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.')],
      ephemeral: true,
    };
    if (interaction.replied || interaction.deferred) interaction.followUp(msg).catch(() => {});
    else interaction.reply(msg).catch(() => {});
  }
};
