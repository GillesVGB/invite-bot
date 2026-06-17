const fs = require('fs');
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
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN;
const PORT = process.env.PORT || 3000;
const DATA_FILE =
  process.env.DATA_FILE || path.join(__dirname, 'data', 'invite-data.json');
const INVITES_CHANNEL_ID =
  process.env.INVITES_CHANNEL_ID || '1508515294925029388';
const INVITE_LOG_KANAAL_ID = "1508515389074706492";
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
const rewardMilestones = [5, 10, 20, 25, 30, 40  , 45, 50];
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

client.once(Events.ClientReady, async () => {
  await loadData();
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
  await loadData();
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

// ============================================
// INVITE LOGS - Wordt gestuurd als iemand joint
// ============================================
client.on(Events.GuildMemberAdd, async (member) => {
  await loadData();

  const before = inviteCache.get(member.guild.id) || new Map();
  const after = await fetchGuildInvites(member.guild);
  const usedInvite = findUsedInvite(before, after);

  inviteCache.set(member.guild.id, after);

  if (!usedInvite || !usedInvite.inviterId) {
    console.log(`[${member.guild.name}] Invite niet gevonden voor ${member.user.tag}.`);
    
    const logChannel = await client.channels.fetch(INVITE_LOG_KANAAL_ID).catch(() => null);
    if (logChannel) {
      const embed = new EmbedBuilder()
        .setColor(THEMA.warning)
        .setTitle("⚠️ Nieuwe member - Invite niet gevonden")
        .setDescription(`${member.user.tag} is gejoind, maar de gebruikte invite kon niet worden gevonden.`)
        .addFields(
          { name: "👤 Nieuwe member", value: `${member.user} (${member.user.tag})`, inline: true },
          { name: "🆔 User ID", value: member.user.id, inline: true },
          { name: "📅 Datum", value: new Date().toLocaleString('nl-NL'), inline: false }
        )
        .setFooter({ text: "Amsterdam Roleplay - Invite Tracker", iconURL: BOT_AVATAR_URL })
        .setTimestamp();
      await logChannel.send({ embeds: [embed] });
    }
    return;
  }

  const result = await recordJoin(member, usedInvite);
  
  const inviterStats = getUserStats(member.guild.id, usedInvite.inviterId);
  const inviterMember = await member.guild.members.fetch(usedInvite.inviterId).catch(() => null);
  
  const logChannel = await client.channels.fetch(INVITE_LOG_KANAAL_ID).catch(() => null);
  if (logChannel) {
    const statusEmoji = result.valid ? "✅" : "❌";
    const statusText = result.valid ? "Geldig" : "Ongeldig (account te jong)";
    
    const embed = new EmbedBuilder()
      .setColor(result.valid ? THEMA.success : THEMA.error)
      .setTitle(`${statusEmoji} Nieuwe member gejoind!`)
      .setDescription(`${member.user.tag} is de server gejoind via een invite van ${inviterMember ? inviterMember.user.tag : usedInvite.inviterId}`)
      .addFields(
        { name: "👤 Nieuwe member", value: `${member.user} (${member.user.tag})`, inline: true },
        { name: "🆔 User ID", value: member.user.id, inline: true },
        { name: "📅 Account leeftijd", value: `${Math.floor((Date.now() - member.user.createdTimestamp) / 86400000)} dagen`, inline: true },
        { name: "🔗 Invite code", value: usedInvite.code, inline: true },
        { name: "👥 Uitgenodigd door", value: inviterMember ? `${inviterMember.user} (${inviterMember.user.tag})` : usedInvite.inviterId, inline: true },
        { name: "📊 Inviter stats", value: `**Geldige invites:** ${inviterStats.valid}\n**Totaal invites:** ${inviterStats.total}\n**Ongeldig:** ${inviterStats.invalid}`, inline: true },
        { name: "✅ Status", value: statusText, inline: true }
      )
      .setFooter({ text: `Amsterdam Roleplay - Invite Tracker | Totaal invites: ${inviterStats.valid}`, iconURL: BOT_AVATAR_URL })
      .setTimestamp();
    
    await logChannel.send({ embeds: [embed] });
  }

  if (!result.counted || !result.valid) return;

  if (inviterMember) {
    await applyRewardRoles(inviterMember, result.validInvites);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() || !interaction.guild) return;
  await loadData();

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

// ============================================
// FUNCTIES
// ============================================

function formatUptime(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}u`;
  if (h > 0) return `${h}u ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

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
    5: '1514664846120189992',
    10: '1514664856127803534',
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
    5: '`Wordt bekeken`',
    10: '`/reviewmij Command`',
    20: '`VIP Blackmarket`',
    25: '`Wordt bekeken`',
    30: '`VIP Join Message`',
    40: '`Wordt bekeken`',
    45: '`Wordt bekeken`',
    50: '`Wordt bekeken`'
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
      const prize = milestonePrizes[milestone] || '🎁 Exclusieve beloning';
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
    
    if (rank === 1) medal = '🥇';
    else if (rank === 2) medal = '🥈';
    else if (rank === 3) medal = '🥉';
    else medal = `#${rank}`;
    
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
    : '🎉 Alle mijlpalen zijn behaald in Amsterdam! Je bent een echte inviter!';

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
      { name: '❯ **5 invites**', value: 'Wordt bekeken``', inline: true },
      { name: '❯ **10 invites**', value: '`/reviewmij Command`', inline: true },
      { name: '❯ **20 invites**', value: '`VIP Blackmarket`', inline: true },
      { name: '❯ **25 invites**', value: '`Wordt bekeken`', inline: true },
      { name: '❯ **30 invites**', value: '`Wordt bekekenr`', inline: true },
      { name: '❯ **40 invites**', value: '`Wordt bekeken`', inline: true },
      { name: '❯ **45 invites**', value: '`Wordt bekeken`', inline: true },
      { name: '❯ **50 invites**', value: '`Wordt bekeken`', inline: true },
  { name: '\u200b', value: '\u200b', inline: true },
      {
        name: '**📋 Belangrijke informatie**',
        value: [
          '• Alleen **geldige invites** tellen mee.',
          '• **Fake accounts** en **alt-accounts** zijn niet toegestaan.',
          '• Alle invites worden **gecontroleerd** door het Amsterdam staffteam.',
          '• Bij **misbruik** vervallen alle behaalde beloningen.',
          '• Mijlpaal bereikt? Spreek een **stafflid** aan voor verificatie in Amsterdam.',
          '• **Nieuwe mijlpalen!** Tot 50 invites mogelijk!',
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
    await interaction.deferUpdate();
    const leaderboard = getLeaderboard(interaction.guild.id);
    const totalPages = Math.ceil(leaderboard.length / 10);
    const fakeInteraction = {
      ...interaction,
      options: { getInteger: () => 1 },
      reply: interaction.reply,
      editReply: interaction.editReply
    };
    await handleLeaderboardCommand(fakeInteraction);
  }
  else if (interaction.customId === 'leaderboard_prev') {
    await interaction.deferUpdate();
    const currentPage = parseInt(interaction.message.embeds[0]?.footer?.text?.match(/Pagina (\d+)/)?.[1] || 1);
    const fakeInteraction = {
      ...interaction,
      options: { getInteger: () => currentPage - 1 },
      reply: interaction.reply,
      editReply: interaction.editReply
    };
    await handleLeaderboardCommand(fakeInteraction);
  }
  else if (interaction.customId === 'leaderboard_next') {
    await interaction.deferUpdate();
    const currentPage = parseInt(interaction.message.embeds[0]?.footer?.text?.match(/Pagina (\d+)/)?.[1] || 1);
    const fakeInteraction = {
      ...interaction,
      options: { getInteger: () => currentPage + 1 },
      reply: interaction.reply,
      editReply: interaction.editReply
    };
    await handleLeaderboardCommand(fakeInteraction);
  }
  else if (interaction.customId === 'leaderboard_last') {
    await interaction.deferUpdate();
    const leaderboard = getLeaderboard(interaction.guild.id);
    const totalPages = Math.ceil(leaderboard.length / 10);
    const fakeInteraction = {
      ...interaction,
      options: { getInteger: () => totalPages },
      reply: interaction.reply,
      editReply: interaction.editReply
    };
    await handleLeaderboardCommand(fakeInteraction);
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
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                font-family: 'Segoe UI', 'Arial', sans-serif;
                background: linear-gradient(135deg, #87CEEB 0%, #4FC3F7 100%);
                color: #1a1a2e;
                text-align: center;
                padding: 50px 20px;
                min-height: 100vh;
            }
            .container {
                background: rgba(255, 255, 255, 0.95);
                backdrop-filter: blur(10px);
                border-radius: 30px;
                padding: 40px;
                max-width: 800px;
                margin: 0 auto;
                box-shadow: 0 20px 40px rgba(0, 0, 0, 0.2);
                border: 1px solid rgba(255, 255, 255, 0.5);
            }
            h1 {
                font-size: 2.5em;
                margin-bottom: 10px;
                background: linear-gradient(135deg, #1a1a2e, #16213e);
                -webkit-background-clip: text;
                -webkit-text-fill-color: transparent;
                background-clip: text;
            }
            h2 { color: #666; margin-bottom: 20px; font-weight: 400; }
            .logo {
                width: 120px;
                height: 120px;
                border-radius: 50%;
                margin-bottom: 20px;
                border: 3px solid #87CEEB;
                box-shadow: 0 0 20px rgba(135, 206, 235, 0.5);
                object-fit: cover;
            }
            .status-card {
                background: linear-gradient(135deg, #f0f8ff, #e6f3ff);
                border-radius: 20px;
                padding: 20px;
                margin: 20px 0;
                border-left: 4px solid #87CEEB;
            }
            .status {
                display: inline-block;
                background: linear-gradient(135deg, #87CEEB, #4FC3F7);
                color: #1a1a2e;
                padding: 12px 25px;
                border-radius: 50px;
                font-weight: bold;
                margin: 20px 0;
                font-size: 1.1em;
            }
            .stats {
                display: flex;
                justify-content: space-around;
                flex-wrap: wrap;
                gap: 15px;
                margin: 30px 0;
            }
            .stat-box {
                background: linear-gradient(135deg, #f8f9fa, #e9ecef);
                border-radius: 15px;
                padding: 15px 25px;
                min-width: 120px;
                border: 1px solid #dee2e6;
            }
            .stat-number { font-size: 2em; font-weight: bold; color: #87CEEB; }
            .stat-label { font-size: 0.85em; color: #666; margin-top: 5px; }
            .commands {
                text-align: left;
                background: #f8f9fa;
                border-radius: 15px;
                padding: 20px;
                margin: 20px 0;
            }
            .commands h3 { color: #1a1a2e; margin-bottom: 15px; text-align: center; }
            .command-list {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
                gap: 10px;
            }
            .command-item {
                background: white;
                padding: 8px 12px;
                border-radius: 8px;
                font-family: monospace;
                font-size: 0.9em;
                border: 1px solid #dee2e6;
                transition: all 0.3s ease;
            }
            .command-item:hover { background: #87CEEB; color: white; transform: translateY(-2px); }
            .reward-section {
                background: linear-gradient(135deg, #fff8e7, #fff3d6);
                border-radius: 15px;
                padding: 20px;
                margin: 20px 0;
            }
            .reward-section h3 { color: #ff8c00; margin-bottom: 15px; text-align: center; }
            .reward-grid {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
                gap: 10px;
            }
            .reward-item {
                background: white;
                padding: 10px;
                border-radius: 10px;
                text-align: center;
                border: 1px solid #ffe0b3;
            }
            .reward-invites { font-size: 1.2em; font-weight: bold; color: #ff8c00; }
            .reward-prize { font-size: 0.85em; color: #666; margin-top: 5px; }
            .footer {
                margin-top: 30px;
                font-size: 12px;
                color: #666;
                border-top: 1px solid #dee2e6;
                padding-top: 20px;
            }
            @keyframes pulse {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.8; transform: scale(1.05); }
            }
            .online { animation: pulse 2s infinite; }
            @keyframes float {
                0%, 100% { transform: translateY(0px); }
                50% { transform: translateY(-5px); }
            }
            .logo { animation: float 3s ease-in-out infinite; }
            @media (max-width: 600px) {
                .container { padding: 20px; }
                h1 { font-size: 1.8em; }
                .stat-box { padding: 10px 15px; min-width: 80px; }
                .stat-number { font-size: 1.5em; }
            }
        </style>
    </head>
    <body>
        <div class="container">
            <img src="${BOT_AVATAR_URL}" alt="Amsterdam Invite Logo" class="logo">
            <h1>🎉 Amsterdam Roleplay</h1>
            <h2>Invite Tracker Bot Status</h2>
            <div class="status-card">
                <div class="status online">✅ Bot is online</div>
                <p style="margin-top: 10px;">📍 Gemeente Amsterdam - Invite Tracker Systeem</p>
                <p style="font-size: 0.9em; opacity: 0.8;">Nodig vrienden uit en verdien exclusieve beloningen!</p>
            </div>
            <div class="stats">
                <div class="stat-box"><div class="stat-number" id="ping">--</div><div class="stat-label">Ping</div></div>
                <div class="stat-box"><div class="stat-number" id="uptime">--</div><div class="stat-label">Uptime</div></div>
                <div class="stat-box"><div class="stat-number" id="guilds">--</div><div class="stat-label">Servers</div></div>
                <div class="stat-box"><div class="stat-number" id="totalInvites">--</div><div class="stat-label">Totaal Invites</div></div>
            </div>
            <div class="reward-section">
                <h3>🎁 Invite Beloningen</h3>
                <div class="reward-grid">
                    <div class="reward-item"><div class="reward-invites">🎯 5 invites</div><div class="reward-prize">Wordt bekeken</div></div>
                    <div class="reward-item"><div class="reward-invites">🎯 10 invites</div><div class="reward-prize">/reviewmij Command</div></div>
                    <div class="reward-item"><div class="reward-invites">🎯 20 invites</div><div class="reward-prize">VIP Blackmarket</div></div>
                    <div class="reward-item"><div class="reward-invites">🎯 25 invites</div><div class="reward-prize">Wordt bekeken</div></div>
                    <div class="reward-item"><div class="reward-invites">🎯 30 invites</div><div class="reward-prize">VIP Join Message</div></div>
                    <div class="reward-item"><div class="reward-invites">🎯 40 invites</div><div class="reward-prize">Wordt bekeken</div></div>
                    <div class="reward-item"><div class="reward-invites">🎯 45 invites</div><div class="reward-prize">Wordt bekeken</div></div>
                    <div class="reward-item"><div class="reward-invites">🎯 50 invites</div><div class="reward-prize">Wordt bekeken</div></div>
                </div>
            </div>
            <div class="commands">
                <h3>📋 Beschikbare Commando's</h3>
                <div class="command-list">
                    <div class="command-item">/invites</div>
                    <div class="command-item">/invites @gebruiker</div>
                    <div class="command-item">/leaderboard</div>
                    <div class="command-item">/inviteactie</div>
                    <div class="command-item">/setrewardrole</div>
                    <div class="command-item">/rewardroles</div>
                    <div class="command-item">/syncrewards</div>
                    <div class="command-item">/addinvites (admin)</div>
                    <div class="command-item">/removeinvites (admin)</div>
                    <div class="command-item">/setinvites (admin)</div>
                </div>
            </div>
            <div class="commands">
                <h3>🏆 Leaderboard Systeem</h3>
                <div class="command-list">
                    <div class="command-item">🥇 Top 10 inviters</div>
                    <div class="command-item">📊 Paginering met knoppen</div>
                    <div class="command-item">👑 Medailles voor top 3</div>
                    <div class="command-item">📈 Geldige invites telling</div>
                </div>
            </div>
            <div class="footer">
                <p>🏛️ Gemeente Amsterdam - Invite Tracker System</p>
                <p>Alleen geldige invites tellen mee voor beloningen | Fake accounts worden verwijderd</p>
                <p>© 2026 Amsterdam Roleplay | Alle rechten voorbehouden</p>
            </div>
        </div>
        <script>
            async function fetchStatus() {
                try {
                    const response = await fetch('/health');
                    const data = await response.json();
                    document.getElementById('ping').innerText = data.ping || '24ms';
                    document.getElementById('uptime').innerText = data.uptime || '3d 12u';
                    document.getElementById('guilds').innerText = data.guilds || '1';
                    document.getElementById('totalInvites').innerText = data.totalInvites || '0';
                } catch (error) {
                    console.error('Error fetching status:', error);
                    document.getElementById('ping').innerText = 'N/A';
                    document.getElementById('uptime').innerText = 'N/A';
                    document.getElementById('guilds').innerText = 'N/A';
                    document.getElementById('totalInvites').innerText = 'N/A';
                }
            }
            fetchStatus();
            setInterval(fetchStatus, 30000);
        </script>
    </body>
    </html>
  `);
});

webApp.get('/health', (req, res) => {
  const guildData = db.guilds[Object.keys(db.guilds)[0]] || { users: {} };
  const totalInvites = Object.values(guildData.users || {}).reduce((sum, u) => sum + (u.valid || 0), 0);
  
  res.json({ 
    status: 'online', 
    bot: client.user?.tag, 
    guilds: client.guilds.cache.size,
    stad: 'Amsterdam',
    ping: `${Math.round(client.ws.ping)}ms`,
    uptime: formatUptime(client.uptime),
    totalInvites: totalInvites.toLocaleString('nl-NL')
  });
});

webApp.listen(webPort, () => {
  console.log(`✅ Webpagina op poort ${webPort} - Gemeente Amsterdam`);
});
