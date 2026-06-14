const fs = require('fs');
const http = require('http');
const path = require('path');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const {
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const PORT = process.env.PORT || 3000;
const DATA_FILE =
  process.env.DATA_FILE || path.join(__dirname, 'data', 'invite-data.json');
const INVITES_CHANNEL_ID =
  process.env.INVITES_CHANNEL_ID || '1508515294925029388';
const MIN_ACCOUNT_AGE_DAYS = Number(process.env.MIN_ACCOUNT_AGE_DAYS || 0);
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUPABASE_TABLE = process.env.SUPABASE_TABLE || 'invite_bot_state';

if (!TOKEN) {
  console.error('DISCORD_TOKEN ontbreekt.');
  process.exit(1);
}

// Amsterdam thema kleuren
const THEMA = {
  primary: 0x87CEEB,
  secondary: 0xADD8E6,
  success: 0x00CED1,
  error: 0xFF6B6B,
  warning: 0xFFD700,
  info: 0x4FC3F7,
  white: 0xFFFFFF,
  accent: 0xB0E0E6,
  pink: 0xFF69B4,
  gold: 0xFFD700,
  silver: 0xC0C0C0,
  bronze: 0xCD7F32
};

const BOT_AVATAR_URL = "https://cdn.discordapp.com/attachments/1507087328752177214/1515802226700845277/amsterdam_roleplay_logo_transparant.png?ex=6a305455&is=6a2f02d5&hm=f9088df305687b2365e3eb299b558c04e29018714151a0602c0c7bb01d3c2dd1&";

const supabase =
  SUPABASE_URL && SUPABASE_KEY
    ? createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false },
      })
    : null;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildInvites,
  ],
});

const inviteCache = new Map();
const rewardMilestones = [3, 5, 10, 15, 20];
const db = { guilds: {} };

const commands = [
  new SlashCommandBuilder()
    .setName('invites')
    .setDescription('Bekijk hoeveel geldige invites iemand heeft in Amsterdam.')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('De speler waarvan je de invites wilt bekijken.')
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('inviteactie')
    .setDescription('Plaats de Invite Actie embed met alle beloningen voor Amsterdam.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Kanaal waar de embed geplaatst moet worden.')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Bekijk de top 10 inviters van Amsterdam!')
    .addIntegerOption((option) =>
      option
        .setName('page')
        .setDescription('Pagina nummer (1-10)')
        .setMinValue(1)
        .setMaxValue(10)
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('setrewardrole')
    .setDescription('Koppel een Discord-rol aan een invite-mijlpaal in Amsterdam.')
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild | PermissionFlagsBits.ManageRoles,
    )
    .addIntegerOption((option) =>
      option
        .setName('invites')
        .setDescription('Aantal geldige invites voor deze rol.')
        .setMinValue(1)
        .setRequired(true),
    )
    .addRoleOption((option) =>
      option
        .setName('role')
        .setDescription('Rol die automatisch wordt gegeven.')
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName('rewardroles')
    .setDescription('Bekijk welke rollen aan invite-mijlpalen gekoppeld zijn in Amsterdam.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('syncrewards')
    .setDescription('Geef reward-rollen aan Amsterdamse leden die ze al behaald hebben.')
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild | PermissionFlagsBits.ManageRoles,
    ),
  new SlashCommandBuilder()
    .setName('addinvites')
    .setDescription('Geef handmatig geldige invites aan een Amsterdamse speler.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('De speler die invites krijgt.')
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('Aantal invites dat je wilt toevoegen.')
        .setMinValue(1)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Optionele reden voor de correctie.')
        .setMaxLength(120)
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('removeinvites')
    .setDescription('Haal handmatig geldige invites weg bij een Amsterdamse speler.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('De speler waarbij je invites weghaalt.')
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('Aantal invites dat je wilt verwijderen.')
        .setMinValue(1)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Optionele reden voor de correctie.')
        .setMaxLength(120)
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('setinvites')
    .setDescription('Zet het geldige invite-aantal van een Amsterdamse speler exact.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('De speler waarvan je het aantal wilt zetten.')
        .setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('amount')
        .setDescription('Het nieuwe aantal geldige invites.')
        .setMinValue(0)
        .setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('Optionele reden voor de correctie.')
        .setMaxLength(120)
        .setRequired(false),
    ),
].map((command) => command.toJSON());

const dataReady = loadData();

client.once(Events.ClientReady, async () => {
  await dataReady;
  console.log(`🏛️ Bot online! ${client.user.tag}`);
  console.log(`📍 Gemeente Amsterdam - Invite Tracker`);
  
  try {
    await client.user.setAvatar(BOT_AVATAR_URL);
    console.log(`✅ Bot avatar geüpdatet naar Amsterdam logo`);
  } catch (error) {
    console.log(`Kon avatar niet updaten: ${error.message}`);
  }
  
  client.user.setActivity(`Amsterdam | /invites`, { type: 3 });

  for (const guild of client.guilds.cache.values()) {
    await registerCommands(guild);
    await refreshGuildInvites(guild);
  }
});

client.on(Events.GuildCreate, async (guild) => {
  await dataReady;
  await registerCommands(guild);
  await refreshGuildInvites(guild);
});

client.on(Events.InviteCreate, (invite) => {
  const guildInvites = inviteCache.get(invite.guild.id) || new Map();
  guildInvites.set(invite.code, inviteToSnapshot(invite));
  inviteCache.set(invite.guild.id, guildInvites);
});

client.on(Events.InviteDelete, (invite) => {
  const guildInvites = inviteCache.get(invite.guild.id);
  if (!guildInvites) return;
  guildInvites.delete(invite.code);
});

client.on(Events.GuildMemberAdd, async (member) => {
  await dataReady;

  const before = inviteCache.get(member.guild.id) || new Map();
  const after = await fetchGuildInvites(member.guild);
  const usedInvite = findUsedInvite(before, after);

  inviteCache.set(member.guild.id, after);

  if (!usedInvite || !usedInvite.inviterId) {
    console.log(`[${member.guild.name}] Invite niet gevonden voor ${member.user.tag}.`);
    return;
  }

  const result = await recordJoin(member, usedInvite);
  if (!result.counted || !result.valid) return;

  const inviterMember = await member.guild.members
    .fetch(usedInvite.inviterId)
    .catch(() => null);

  if (inviterMember) {
    await applyRewardRoles(inviterMember, result.validInvites);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.guild) return;
  await dataReady;

  if (interaction.commandName === 'invites') {
    await handleInvitesCommand(interaction);
    return;
  }
  if (interaction.commandName === 'inviteactie') {
    await handleInviteActieCommand(interaction);
    return;
  }
  if (interaction.commandName === 'leaderboard') {
    await handleLeaderboardCommand(interaction);
    return;
  }
  if (interaction.commandName === 'setrewardrole') {
    await handleSetRewardRoleCommand(interaction);
    return;
  }
  if (interaction.commandName === 'rewardroles') {
    await handleRewardRolesCommand(interaction);
    return;
  }
  if (interaction.commandName === 'syncrewards') {
    await handleSyncRewardsCommand(interaction);
    return;
  }
  if (interaction.commandName === 'addinvites') {
    await handleAddInvitesCommand(interaction);
    return;
  }
  if (interaction.commandName === 'removeinvites') {
    await handleRemoveInvitesCommand(interaction);
    return;
  }
  if (interaction.commandName === 'setinvites') {
    await handleSetInvitesCommand(interaction);
  }
});

client.login(TOKEN);

process.on('unhandledRejection', (error) => {
  console.error('Unhandled promise rejection:', error);
});

async function loadData() {
  if (supabase) {
    const { data, error } = await supabase
      .from(SUPABASE_TABLE)
      .select('guild_id, data');

    if (error) {
      console.error('Supabase laden mislukt:', error);
      loadLocalData();
      return;
    }

    for (const row of data || []) {
      db.guilds[row.guild_id] = normalizeGuildData(row.data);
    }
    console.log(`Invite data geladen uit Supabase: ${SUPABASE_TABLE}`);
    return;
  }
  loadLocalData();
}

function loadLocalData() {
  try {
    const localData = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    db.guilds = localData.guilds || {};
    console.log(`Invite data geladen uit ${DATA_FILE}`);
  } catch {
    console.log('Geen lokale invite data gevonden, start met lege data.');
  }
}

async function saveGuildData(guildId) {
  if (supabase) {
    const { error } = await supabase.from(SUPABASE_TABLE).upsert(
      {
        guild_id: guildId,
        data: normalizeGuildData(db.guilds[guildId]),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'guild_id' },
    );
    if (!error) return;
    console.error('Supabase opslaan mislukt:', error);
  }
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function normalizeGuildData(data = {}) {
  return {
    users: data.users || {},
    joins: data.joins || {},
    rewardRoles: data.rewardRoles || {},
  };
}

function ensureGuildData(guildId) {
  if (!db.guilds[guildId]) {
    db.guilds[guildId] = { users: {}, joins: {}, rewardRoles: {} };
  }
  return db.guilds[guildId];
}

function getUserStats(guildId, userId) {
  const guildData = ensureGuildData(guildId);
  if (!guildData.users[userId]) {
    guildData.users[userId] = {
      valid: 0,
      invalid: 0,
      total: 0,
      manual: 0,
      lastInviteAt: null,
    };
  }
  const stats = guildData.users[userId];
  stats.valid ??= 0;
  stats.invalid ??= 0;
  stats.total ??= 0;
  stats.manual ??= 0;
  stats.lastInviteAt ??= null;
  return stats;
}

function getLeaderboard(guildId) {
  const guildData = ensureGuildData(guildId);
  const users = Object.entries(guildData.users || {})
    .map(([userId, stats]) => ({
      userId,
      valid: stats.valid || 0,
      total: stats.total || 0,
    }))
    .filter(u => u.valid > 0)
    .sort((a, b) => b.valid - a.valid);
  return users;
}

async function registerCommands(guild) {
  try {
    await guild.commands.set(commands);
    console.log(`[${guild.name}] Slash commands geregistreerd.`);
  } catch (error) {
    console.error(`[${guild.name}] Fout bij registreren:`, error);
  }
}

async function refreshGuildInvites(guild) {
  const invites = await fetchGuildInvites(guild);
  inviteCache.set(guild.id, invites);
}

async function fetchGuildInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    return new Map(invites.map((invite) => [invite.code, inviteToSnapshot(invite)]));
  } catch (error) {
    console.error(`[${guild.name}] Invites ophalen mislukt:`, error.message);
    return inviteCache.get(guild.id) || new Map();
  }
}

function inviteToSnapshot(invite) {
  return {
    code: invite.code,
    uses: invite.uses || 0,
    inviterId: invite.inviter ? invite.inviter.id : null,
    channelId: invite.channelId,
  };
}

function findUsedInvite(before, after) {
  for (const [code, invite] of after.entries()) {
    const previousUses = before.get(code)?.uses || 0;
    if (invite.uses > previousUses) return invite;
  }
  return null;
}

async function recordJoin(member, invite) {
  const guildData = ensureGuildData(member.guild.id);

  if (guildData.joins[member.id]) {
    return { counted: false, valid: false, reason: 'member_already_counted' };
  }

  const inviterStats = getUserStats(member.guild.id, invite.inviterId);
  const accountAgeMs = Date.now() - member.user.createdTimestamp;
  const accountAgeDays = accountAgeMs / 86_400_000;
  const isValid = accountAgeDays >= MIN_ACCOUNT_AGE_DAYS;

  inviterStats.total += 1;
  inviterStats.lastInviteAt = new Date().toISOString();

  if (isValid) {
    inviterStats.valid += 1;
  } else {
    inviterStats.invalid += 1;
  }

  guildData.joins[member.id] = {
    inviterId: invite.inviterId,
    inviteCode: invite.code,
    valid: isValid,
    reason: isValid ? 'valid' : `account_younger_than_${MIN_ACCOUNT_AGE_DAYS}_days`,
    joinedAt: new Date().toISOString(),
    accountCreatedAt: member.user.createdAt.toISOString(),
  };

  await saveGuildData(member.guild.id);
  console.log(`[${member.guild.name}] ${member.user.tag} joined via ${invite.code}. Geldig: ${isValid}.`);

  return {
    counted: true,
    valid: isValid,
    validInvites: inviterStats.valid,
  };
}

async function sendMilestoneDM(member, milestone, prize, roleId, roleName) {
  const roleIds = {
    3: '1514664828285747290',
    5: '1514664846120189992',
    10: '1514664856127803534',
    15: '1514664851350487162',
    20: '1514664840310816900',
  };
  
  const correctRoleId = roleIds[milestone] || roleId;
  
  const dmEmbed = new EmbedBuilder()
    .setColor(THEMA.pink)
    .setAuthor({ name: 'Amsterdam Roleplay', iconURL: BOT_AVATAR_URL })
    .setTitle('🎉 Gefeliciteerd! 🎉')
    .setDescription([
      `**Je hebt zojuist de mijlpaal van ${milestone} invites bereikt in Amsterdam!**`,
      '',
      `**Prijs:** ${prize}`,
      '',
      `✨ Maak een ticket aan om je prijs te claimen!`,
    ].join('\n'))
    .setFooter({ text: 'Amsterdam Roleplay • Invite Actie', iconURL: BOT_AVATAR_URL })
    .setTimestamp();

  try {
    await member.send({ embeds: [dmEmbed] });
    console.log(`DM gestuurd naar ${member.user.tag} voor ${milestone} invites`);
  } catch (error) {
    console.error(`Kon geen DM sturen naar ${member.user.tag}:`, error.message);
  }
}

async function applyRewardRoles(member, validInviteCount) {
  const guildData = ensureGuildData(member.guild.id);
  const rewardRoles = guildData.rewardRoles || {};
  const awarded = [];
  const failed = [];

  const milestonePrizes = {
    3: '`67dance`',
    5: '`VIP Join Message`',
    10: '`/reviewmij Command`',
    15: '`Buff / Baller (auto)`',
    20: '`VIP Blackmarket`',
  };

  const milestoneRoleNames = {
    3: '❯ 3 Invites',
    5: '❯ 5 Invites',
    10: '❯ 10 Invites',
    15: '❯ 15 Invites',
    20: '❯ 20 Invites',
  };

  for (const [milestoneText, roleId] of Object.entries(rewardRoles)) {
    const milestone = Number(milestoneText);
    if (!Number.isFinite(milestone) || validInviteCount < milestone) continue;
    if (member.roles.cache.has(roleId)) continue;

    const role = member.guild.roles.cache.get(roleId);
    if (!role) {
      failed.push(`${milestone} invites: rol niet gevonden`);
      continue;
    }

    try {
      await member.roles.add(role, `Invite reward voor ${milestone} invites in Amsterdam`);
      awarded.push(role.name);
      const prize = milestonePrizes[milestone] || 'Exclusieve beloning';
      await sendMilestoneDM(member, milestone, prize, roleId, role.name);
    } catch (error) {
      failed.push(`${role.name}: ${error.message}`);
    }
  }
  return { awarded, failed };
}

// ============================================
// LEADERBOARD COMMAND
// ============================================
async function handleLeaderboardCommand(interaction) {
  const page = interaction.options.getInteger('page') || 1;
  const itemsPerPage = 10;
  const leaderboard = getLeaderboard(interaction.guild.id);
  
  if (leaderboard.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(THEMA.warning)
      .setAuthor({ name: 'Amsterdam Roleplay', iconURL: BOT_AVATAR_URL })
      .setTitle('📊 Invite Leaderboard')
      .setDescription('Er zijn nog geen geldige invites geregistreerd in Amsterdam!')
      .setFooter({ text: 'Wees de eerste om vrienden uit te nodigen!', iconURL: BOT_AVATAR_URL })
      .setTimestamp();
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  }

  const totalPages = Math.ceil(leaderboard.length / itemsPerPage);
  const currentPage = Math.min(page, totalPages);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const pageItems = leaderboard.slice(startIndex, endIndex);

  let description = '';
  for (let i = 0; i < pageItems.length; i++) {
    const item = pageItems[i];
    const rank = startIndex + i + 1;
    let medal = '';
    let medalColor = '';
    
    if (rank === 1) { medal = '🥇'; medalColor = THEMA.gold; }
    else if (rank === 2) { medal = '🥈'; medalColor = THEMA.silver; }
    else if (rank === 3) { medal = '🥉'; medalColor = THEMA.bronze; }
    else { medal = `#${rank}`; }
    
    try {
      const user = await interaction.guild.members.fetch(item.userId).catch(() => null);
      const username = user ? user.user.username : `Onbekende Gebruiker (${item.userId.slice(0, 8)}...)`;
      description += `**${medal}** ${username}\n└ **${item.valid}** geldige invites | **${item.total}** totaal\n\n`;
    } catch {
      description += `**${medal}** Onbekende Gebruiker\n└ **${item.valid}** geldige invites\n\n`;
    }
  }

  const embed = new EmbedBuilder()
    .setColor(THEMA.primary)
    .setAuthor({ name: 'Amsterdam Roleplay', iconURL: BOT_AVATAR_URL })
    .setTitle('🏆 Invite Leaderboard - Amsterdam')
    .setDescription(description || 'Geen data beschikbaar')
    .setFooter({ text: `Pagina ${currentPage}/${totalPages} • Totaal ${leaderboard.length} inviters`, iconURL: BOT_AVATAR_URL })
    .setTimestamp()
    .setThumbnail(BOT_AVATAR_URL);

  const row = new ActionRowBuilder()
    .addComponents(
      new ButtonBuilder()
        .setCustomId('leaderboard_first')
        .setLabel('⏮️ Eerste')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === 1),
      new ButtonBuilder()
        .setCustomId('leaderboard_prev')
        .setLabel('◀️ Vorige')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(currentPage === 1),
      new ButtonBuilder()
        .setCustomId('leaderboard_next')
        .setLabel('Volgende ▶️')
        .setStyle(ButtonStyle.Primary)
        .setDisabled(currentPage === totalPages),
      new ButtonBuilder()
        .setCustomId('leaderboard_last')
        .setLabel('Laatste ⏭️')
        .setStyle(ButtonStyle.Secondary)
        .setDisabled(currentPage === totalPages)
    );

  await interaction.reply({ embeds: [embed], components: [row] });
}

// ============================================
// OVERIGE COMMAND HANDLERS
// ============================================
async function handleInvitesCommand(interaction) {
  const user = interaction.options.getUser('user') || interaction.user;
  const stats = getUserStats(interaction.guild.id, user.id);
  const nextMilestone = rewardMilestones.find((milestone) => stats.valid < milestone);
  const nextText = nextMilestone
    ? `${nextMilestone - stats.valid} geldige invite(s) tot **${nextMilestone} invites** in Amsterdam.`
    : 'Alle standaard mijlpalen zijn behaald in Amsterdam.';

  const embed = new EmbedBuilder()
    .setColor(THEMA.primary)
    .setAuthor({ name: 'Amsterdam Roleplay Invite Tracker', iconURL: BOT_AVATAR_URL })
    .setTitle(`🏛️ Invites van ${user.username} in Amsterdam`)
    .setThumbnail(user.displayAvatarURL({ size: 128 }))
    .setDescription(`${user} staat momenteel op **${stats.valid}** geldige invite(s) in Amsterdam.`)
    .addFields(
      { name: '✅ Geldig', value: String(stats.valid), inline: true },
      { name: '📊 Gedetecteerd', value: String(stats.total), inline: true },
      { name: '✏️ Handmatig', value: String(stats.manual || 0), inline: true },
      { name: '❌ Ongeldig', value: String(stats.invalid), inline: true },
      { name: '🎯 Volgende mijlpaal', value: nextText, inline: false },
    )
    .setFooter({ text: 'Gemeente Amsterdam - Alleen geldige invites tellen mee voor beloningen.', iconURL: BOT_AVATAR_URL })
    .setTimestamp();

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleInviteActieCommand(interaction) {
  const targetChannel = interaction.options.getChannel('channel') || interaction.channel;
  if (!targetChannel || !targetChannel.isTextBased()) {
    return interaction.reply({
      content: 'Ik kan de embed alleen in een tekstkanaal plaatsen.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const embed = new EmbedBuilder()
    .setColor(THEMA.pink)
    .setAuthor({ name: 'Amsterdam Roleplay', iconURL: BOT_AVATAR_URL })
    .setTitle('🏛️ Invite Actie - Amsterdam')
    .setDescription([
      'Nodig vrienden uit voor onze Amsterdam Discord-server en verdien **exclusieve beloningen**!',
      '',
      `Bekijk je aantal invites in <#${INVITES_CHANNEL_ID}> met **/invites**.`,
    ].join('\n'))
    .setThumbnail(BOT_AVATAR_URL)
    .addFields(
      { name: '❯ **3 invites**', value: '`67dance`', inline: true },
      { name: '❯ **5 invites**', value: '`VIP Join Message`', inline: true },
      { name: '❯ **10 invites**', value: '`/reviewmij Command`', inline: true },
      { name: '❯ **15 invites**', value: '`Buff / Baller (auto)`', inline: true },
      { name: '❯ **20 invites**', value: '`VIP Blackmarket`', inline: true },
      { name: '\u200b', value: '\u200b', inline: true },
      { name: '\u200b', value: '\n', inline: false },
      {
        name: '**📋 Belangrijke informatie**',
        value: [
          '• Alleen **geldige invites** tellen mee.',
          '• **Fake accounts** en **alt-accounts** zijn niet toegestaan.',
          '• Alle invites worden **gecontroleerd** door het Amsterdam staffteam.',
          '• Bij **misbruik** vervallen alle behaalde beloningen.',
          '• Mijlpaal bereikt? Spreek een **stafflid** aan voor verificatie in Amsterdam.',
        ].join('\n'),
        inline: false,
      },
    )
    .setFooter({ text: 'Gemeente Amsterdam - Invite Actie', iconURL: BOT_AVATAR_URL })
    .setTimestamp();

  await targetChannel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  await interaction.reply({ content: `✅ Invite Actie embed geplaatst in ${targetChannel} voor Amsterdam!`, flags: MessageFlags.Ephemeral });
}

async function handleSetRewardRoleCommand(interaction) {
  const milestone = interaction.options.getInteger('invites', true);
  const role = interaction.options.getRole('role', true);
  const botMember = interaction.guild.members.me || await interaction.guild.members.fetchMe().catch(() => null);

  if (role.id === interaction.guild.id || role.managed) {
    return interaction.reply({ content: 'Deze rol kan ik niet automatisch uitdelen in Amsterdam.', flags: MessageFlags.Ephemeral });
  }
  if (botMember && role.comparePositionTo(botMember.roles.highest) >= 0) {
    return interaction.reply({ content: 'Zet mijn bot-rol hoger dan deze reward-rol in Amsterdam.', flags: MessageFlags.Ephemeral });
  }

  const guildData = ensureGuildData(interaction.guild.id);
  guildData.rewardRoles[String(milestone)] = role.id;
  await saveGuildData(interaction.guild.id);
  await interaction.reply({ content: `✅ Vanaf **${milestone} geldige invite(s)** krijgt iemand in Amsterdam automatisch ${role}.`, flags: MessageFlags.Ephemeral });
}

async function handleRewardRolesCommand(interaction) {
  const guildData = ensureGuildData(interaction.guild.id);
  const rewardRoles = Object.entries(guildData.rewardRoles || {}).sort(([a], [b]) => Number(a) - Number(b));
  const description = rewardRoles.length
    ? rewardRoles.map(([milestone, roleId]) => `**${milestone} invites** -> <@&${roleId}>`).join('\n')
    : 'Er zijn nog geen reward-rollen ingesteld in Amsterdam. Gebruik `/setrewardrole`.';

  const embed = new EmbedBuilder()
    .setColor(THEMA.info)
    .setAuthor({ name: '🏛️ Amsterdam Invite reward-rollen', iconURL: BOT_AVATAR_URL })
    .setTitle('🎁 Reward Rollen Amsterdam')
    .setDescription(description)
    .setFooter({ text: 'Gemeente Amsterdam', iconURL: BOT_AVATAR_URL });
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleSyncRewardsCommand(interaction) {
  const guildData = ensureGuildData(interaction.guild.id);
  const rewardRoles = guildData.rewardRoles || {};
  if (!Object.keys(rewardRoles).length) {
    return interaction.reply({ content: 'Er zijn nog geen reward-rollen ingesteld in Amsterdam.', flags: MessageFlags.Ephemeral });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  let checked = 0, awarded = 0, failed = 0;

  for (const [userId, stats] of Object.entries(guildData.users || {})) {
    if (!stats.valid) continue;
    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    if (!member) continue;
    checked += 1;
    const result = await applyRewardRoles(member, stats.valid);
    awarded += result.awarded.length;
    failed += result.failed.length;
  }
  await interaction.editReply(`🏛️ Amsterdam - Rewards gesynchroniseerd. Gecontroleerd: **${checked}**, rollen gegeven: **${awarded}**, mislukt: **${failed}**.`);
}

async function handleAddInvitesCommand(interaction) {
  const user = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);
  const reason = interaction.options.getString('reason') || 'Geen reden opgegeven';
  const stats = getUserStats(interaction.guild.id, user.id);

  stats.valid += amount;
  stats.manual += amount;
  stats.lastInviteAt = new Date().toISOString();
  await saveGuildData(interaction.guild.id);

  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (member) await applyRewardRoles(member, stats.valid);

  const embed = new EmbedBuilder()
    .setColor(THEMA.warning)
    .setAuthor({ name: '🏛️ Amsterdam Invite Beheer', iconURL: BOT_AVATAR_URL })
    .setTitle('Invites toegevoegd in Amsterdam')
    .setDescription(`${user}\n**+${amount}** geldige invite(s) toegevoegd.`)
    .addFields(
      { name: '📊 Nieuw totaal', value: String(stats.valid), inline: true },
      { name: '✏️ Handmatig', value: String(stats.manual || 0), inline: true },
      { name: '📝 Reden', value: reason, inline: false },
    )
    .setFooter({ text: 'Gemeente Amsterdam', iconURL: BOT_AVATAR_URL })
    .setTimestamp();
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleRemoveInvitesCommand(interaction) {
  const user = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);
  const reason = interaction.options.getString('reason') || 'Geen reden opgegeven';
  const stats = getUserStats(interaction.guild.id, user.id);
  const removed = Math.min(amount, stats.valid);

  stats.valid -= removed;
  stats.manual = Math.max(0, stats.manual - removed);
  await saveGuildData(interaction.guild.id);

  const embed = new EmbedBuilder()
    .setColor(THEMA.warning)
    .setAuthor({ name: '🏛️ Amsterdam Invite Beheer', iconURL: BOT_AVATAR_URL })
    .setTitle('Invites verwijderd in Amsterdam')
    .setDescription(`${user}\n**-${removed}** geldige invite(s) verwijderd.`)
    .addFields(
      { name: '📊 Nieuw totaal', value: String(stats.valid), inline: true },
      { name: '✏️ Handmatig', value: String(stats.manual || 0), inline: true },
      { name: '📝 Reden', value: reason, inline: false },
    )
    .setFooter({ text: 'Gemeente Amsterdam', iconURL: BOT_AVATAR_URL })
    .setTimestamp();
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleSetInvitesCommand(interaction) {
  const user = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);
  const reason = interaction.options.getString('reason') || 'Geen reden opgegeven';
  const stats = getUserStats(interaction.guild.id, user.id);
  const difference = amount - stats.valid;

  stats.valid = amount;
  stats.manual = Math.max(0, stats.manual + difference);
  stats.lastInviteAt = new Date().toISOString();
  await saveGuildData(interaction.guild.id);

  const member = await interaction.guild.members.fetch(user.id).catch(() => null);
  if (member) await applyRewardRoles(member, stats.valid);

  const embed = new EmbedBuilder()
    .setColor(THEMA.warning)
    .setAuthor({ name: '🏛️ Amsterdam Invite Beheer', iconURL: BOT_AVATAR_URL })
    .setTitle('Invites ingesteld in Amsterdam')
    .setDescription(`${user}\nGeldige invites ingesteld op **${amount}**.`)
    .addFields(
      { name: '📊 Nieuw totaal', value: String(stats.valid), inline: true },
      { name: '✏️ Handmatig', value: String(stats.manual || 0), inline: true },
      { name: '📝 Reden', value: reason, inline: false },
    )
    .setFooter({ text: 'Gemeente Amsterdam', iconURL: BOT_AVATAR_URL })
    .setTimestamp();
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

// ============================================
// BUTTON HANDLER VOOR LEADERBOARD
// ============================================
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;
  
  if (interaction.customId === 'leaderboard_first') {
    const leaderboard = getLeaderboard(interaction.guild.id);
    const totalPages = Math.ceil(leaderboard.length / 10);
    await handleLeaderboardCommand({ ...interaction, options: { getInteger: () => 1 }, reply: interaction.reply, editReply: interaction.editReply });
    await interaction.deferUpdate();
  }
  else if (interaction.customId === 'leaderboard_prev') {
    const currentPage = parseInt(interaction.message.embeds[0]?.footer?.text?.match(/Pagina (\d+)/)?.[1] || 1);
    await handleLeaderboardCommand({ ...interaction, options: { getInteger: () => currentPage - 1 }, reply: interaction.reply, editReply: interaction.editReply });
    await interaction.deferUpdate();
  }
  else if (interaction.customId === 'leaderboard_next') {
    const currentPage = parseInt(interaction.message.embeds[0]?.footer?.text?.match(/Pagina (\d+)/)?.[1] || 1);
    await handleLeaderboardCommand({ ...interaction, options: { getInteger: () => currentPage + 1 }, reply: interaction.reply, editReply: interaction.editReply });
    await interaction.deferUpdate();
  }
  else if (interaction.customId === 'leaderboard_last') {
    const leaderboard = getLeaderboard(interaction.guild.id);
    const totalPages = Math.ceil(leaderboard.length / 10);
    await handleLeaderboardCommand({ ...interaction, options: { getInteger: () => totalPages }, reply: interaction.reply, editReply: interaction.editReply });
    await interaction.deferUpdate();
  }
});

// ============================================
// WEBSERVER
// ============================================
const webApp = express();
const webPort = process.env.PORT || 3000;

webApp.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
        <title>Amsterdam Roleplay - Invite Bot</title>
        <style>
            body {
                font-family: 'Arial', sans-serif;
                background: linear-gradient(135deg, #87CEEB 0%, #ADD8E6 100%);
                color: #1a1a2e;
                text-align: center;
                padding: 50px;
                margin: 0;
            }
            .container {
                background: white;
                border-radius: 20px;
                padding: 40px;
                max-width: 600px;
                margin: 0 auto;
                box-shadow: 0 10px 30px rgba(0,0,0,0.2);
            }
            h1 {
                color: #1a1a2e;
                margin-bottom: 10px;
            }
            .logo {
                width: 120px;
                height: 120px;
                border-radius: 50%;
                margin-bottom: 20px;
                border: 3px solid #87CEEB;
            }
            .status {
                background: #87CEEB;
                color: white;
                padding: 10px 20px;
                border-radius: 10px;
                display: inline-block;
                margin: 20px 0;
            }
            .footer {
                margin-top: 30px;
                font-size: 12px;
                color: #666;
            }
            .command-list {
                display: flex;
                flex-wrap: wrap;
                justify-content: center;
                gap: 10px;
                margin: 20px 0;
            }
            .command-item {
                background: #f0f0f0;
                padding: 5px 12px;
                border-radius: 15px;
                font-family: monospace;
                font-size: 0.85em;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <img src="${BOT_AVATAR_URL}" alt="Amsterdam Logo" class="logo">
            <h1>🏛️ Amsterdam Roleplay</h1>
            <h2>Invite Bot Status</h2>
            <div class="status">✅ Bot is online</div>
            <p>Bot is actief en alle systemen werken naar behoren.</p>
            <p>Gebruik <strong>/invites</strong> in Discord om je invites te bekijken!</p>
            <p>Gebruik <strong>/leaderboard</strong> om de top inviters te zien!</p>
            <div class="command-list">
                <span class="command-item">/invites</span>
                <span class="command-item">/leaderboard</span>
                <span class="command-item">/inviteactie</span>
                <span class="command-item">/setrewardrole</span>
                <span class="command-item">/rewardroles</span>
            </div>
            <div class="footer">
                Amsterdam Roleplay - Invite Tracker System
            </div>
        </div>
    </body>
    </html>
  `);
});

webApp.get('/health', (req, res) => {
  res.json({ status: 'online', bot: client.user?.tag, guilds: client.guilds.cache.size, stad: 'Amsterdam' });
});

webApp.listen(webPort, () => {
  console.log(`✅ Webpagina op poort ${webPort} - Gemeente Amsterdam`);
});
