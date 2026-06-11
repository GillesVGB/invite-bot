const fs = require('fs');
const http = require('http');
const path = require('path');
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
    .setDescription('Bekijk hoeveel geldige invites iemand heeft.')
    .addUserOption((option) =>
      option
        .setName('user')
        .setDescription('De speler waarvan je de invites wilt bekijken.')
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('inviteactie')
    .setDescription('Plaats de Invite Actie embed met alle beloningen zonder ping.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option
        .setName('channel')
        .setDescription('Kanaal waar de embed geplaatst moet worden.')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(false),
    ),
  new SlashCommandBuilder()
    .setName('setrewardrole')
    .setDescription('Koppel een Discord-rol aan een invite-mijlpaal.')
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
    .setDescription('Bekijk welke rollen aan invite-mijlpalen gekoppeld zijn.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  new SlashCommandBuilder()
    .setName('syncrewards')
    .setDescription('Geef reward-rollen aan leden die ze al behaald hebben.')
    .setDefaultMemberPermissions(
      PermissionFlagsBits.ManageGuild | PermissionFlagsBits.ManageRoles,
    ),
  new SlashCommandBuilder()
    .setName('addinvites')
    .setDescription('Geef handmatig geldige invites aan een speler.')
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
    .setDescription('Haal handmatig geldige invites weg bij een speler.')
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
    .setDescription('Zet het geldige invite-aantal van een speler exact.')
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

startWebServer();
const dataReady = loadData();

client.once(Events.ClientReady, async () => {
  await dataReady;
  console.log(`Ingelogd als ${client.user.tag}`);

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
    console.log(
      `[${member.guild.name}] Invite niet gevonden voor ${member.user.tag}.`,
    );
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

function startWebServer() {
  const server = http.createServer((request, response) => {
    const body =
      request.url === '/health'
        ? JSON.stringify({
            ok: true,
            bot: client.user ? client.user.tag : 'starting',
            guilds: client.guilds.cache.size,
            storage: supabase ? 'supabase' : 'local-json',
          })
        : 'Utrecht Roleplay Invite Bot draait.';

    response.writeHead(200, {
      'content-type':
        request.url === '/health'
          ? 'application/json; charset=utf-8'
          : 'text/plain; charset=utf-8',
    });
    response.end(body);
  });

  server.listen(PORT, () => {
    console.log(`Render webserver luistert op poort ${PORT}`);
  });
}

async function loadData() {
  if (supabase) {
    const { data, error } = await supabase
      .from(SUPABASE_TABLE)
      .select('guild_id, data');

    if (error) {
      console.error('Supabase laden mislukt, lokale backup wordt gebruikt:', error);
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

    console.error('Supabase opslaan mislukt, lokale backup wordt gebruikt:', error);
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
    db.guilds[guildId] = {
      users: {},
      joins: {},
      rewardRoles: {},
    };
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

  guildData.users[userId].valid ??= 0;
  guildData.users[userId].invalid ??= 0;
  guildData.users[userId].total ??= 0;
  guildData.users[userId].manual ??= 0;
  guildData.users[userId].lastInviteAt ??= null;

  return guildData.users[userId];
}

async function registerCommands(guild) {
  try {
    await guild.commands.set(commands);
    console.log(`[${guild.name}] Slash commands geregistreerd.`);
  } catch (error) {
    console.error(`[${guild.name}] Slash commands registreren mislukt:`, error);
  }
}

async function refreshGuildInvites(guild) {
  const invites = await fetchGuildInvites(guild);
  inviteCache.set(guild.id, invites);
}

async function fetchGuildInvites(guild) {
  try {
    const invites = await guild.invites.fetch();
    return new Map(
      invites.map((invite) => [invite.code, inviteToSnapshot(invite)]),
    );
  } catch (error) {
    console.error(
      `[${guild.name}] Invites ophalen mislukt. Geef de bot Manage Server permissie.`,
      error.message,
    );
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

    if (invite.uses > previousUses) {
      return invite;
    }
  }

  return null;
}

async function recordJoin(member, invite) {
  const guildData = ensureGuildData(member.guild.id);

  if (guildData.joins[member.id]) {
    return {
      counted: false,
      valid: false,
      reason: 'member_already_counted',
    };
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
    reason: isValid
      ? 'valid'
      : `account_younger_than_${MIN_ACCOUNT_AGE_DAYS}_days`,
    joinedAt: new Date().toISOString(),
    accountCreatedAt: member.user.createdAt.toISOString(),
  };

  await saveGuildData(member.guild.id);

  console.log(
    `[${member.guild.name}] ${member.user.tag} joined via ${invite.code} van ${invite.inviterId}. Geldig: ${isValid}.`,
  );

  return {
    counted: true,
    valid: isValid,
    validInvites: inviterStats.valid,
  };
}

async function applyRewardRoles(member, validInviteCount) {
  const guildData = ensureGuildData(member.guild.id);
  const rewardRoles = guildData.rewardRoles || {};
  const awarded = [];
  const failed = [];

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
      await member.roles.add(role, `Invite reward voor ${milestone} invites`);
      awarded.push(role.name);
    } catch (error) {
      failed.push(`${role.name}: ${error.message}`);
    }
  }

  return { awarded, failed };
}

async function handleInvitesCommand(interaction) {
  const user = interaction.options.getUser('user') || interaction.user;
  const stats = getUserStats(interaction.guild.id, user.id);
  const nextMilestone = rewardMilestones.find((milestone) => stats.valid < milestone);
  const nextText = nextMilestone
    ? `${nextMilestone - stats.valid} geldige invite(s) tot **${nextMilestone} invites**.`
    : 'Alle standaard mijlpalen zijn behaald.';

  const embed = new EmbedBuilder()
    .setColor(0x2b8cff)
    .setAuthor({ name: 'Utrecht Roleplay Invite Tracker' })
    .setTitle(`Invites van ${user.username}`)
    .setThumbnail(user.displayAvatarURL({ size: 128 }))
    .setDescription(`${user} staat momenteel op **${stats.valid}** geldige invite(s).`)
    .addFields(
      { name: 'Geldig', value: String(stats.valid), inline: true },
      { name: 'Gedetecteerd', value: String(stats.total), inline: true },
      { name: 'Handmatig', value: String(stats.manual || 0), inline: true },
      { name: 'Ongeldig', value: String(stats.invalid), inline: true },
      { name: 'Volgende mijlpaal', value: nextText, inline: false },
    )
    .setFooter({ text: 'Alleen geldige invites tellen mee voor beloningen.' })
    .setTimestamp();

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleInviteActieCommand(interaction) {
  const targetChannel =
    interaction.options.getChannel('channel') || interaction.channel;

  if (!targetChannel || !targetChannel.isTextBased()) {
    await interaction.reply({
      content: 'Ik kan de embed alleen in een tekstkanaal plaatsen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

const embed = new EmbedBuilder()
    .setColor(0x2b8cff)
    .setAuthor({ 
        name: 'Utrecht Roleplay' 
    })
    .setTitle('Invite Actie')
    .setDescription(
        [
            'Nodig vrienden uit voor onze Discord-server en verdien **exclusieve beloningen**!',
            '',
            `Bekijk je aantal invites in <#${INVITES_CHANNEL_ID}> met **/invites**.`,
        ].join('\n'),
    )
    .setThumbnail(client.user.displayAvatarURL())
    .addFields(
        // Bovenste rij
        { name: '**3 invites**', value: '`67dance`', inline: true },
        { name: '**5 invites**', value: '`VIP Join Message`', inline: true },
        { name: '**10 invites**', value: '`/reviewmij Command`', inline: true },
        
        // Onderste rij met leeg midden
        { name: '**15 invites**', value: '`Voertuig naar keuze: Buff of Baller`', inline: true },
        { name: '\u200b', value: '\u200b', inline: true },
        { name: '**20 invites**', value: '`VIP Blackmarket`', inline: true },
        
        // Kleine regel (lege ruimte)
        { name: '\u200b', value: '\u200b', inline: false },
        
        // Informatie
        {
            name: '**Belangrijke informatie**',
            value: [
                '• Alleen **geldige invites** tellen mee.',
                '• **Fake accounts** en **alt-accounts** zijn niet toegestaan.',
                '• Alle invites worden **gecontroleerd** door het staffteam.',
                '• Bij **misbruik** vervallen alle behaalde beloningen.',
                '• Mijlpaal bereikt? Spreek een **stafflid** aan voor verificatie.',
            ].join('\n'),
            inline: false,
        },
    )
    .setFooter({ text: 'Utrecht Roleplay Invite Actie' })
    .setTimestamp();
  
  await targetChannel.send({
    embeds: [embed],
    allowedMentions: { parse: [] },
  });

  await interaction.reply({
    content: `Invite Actie embed geplaatst in ${targetChannel}.`,
    flags: MessageFlags.Ephemeral,
  });
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
  if (member) {
    await applyRewardRoles(member, stats.valid);
  }

  await interaction.reply({
    embeds: [
      buildAdminEmbed(
        'Invites toegevoegd',
        user,
        `**+${amount}** geldige invite(s) toegevoegd.`,
        stats,
        reason,
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
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

  await interaction.reply({
    embeds: [
      buildAdminEmbed(
        'Invites verwijderd',
        user,
        `**-${removed}** geldige invite(s) verwijderd.`,
        stats,
        reason,
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
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
  if (member) {
    await applyRewardRoles(member, stats.valid);
  }

  await interaction.reply({
    embeds: [
      buildAdminEmbed(
        'Invites ingesteld',
        user,
        `Geldige invites ingesteld op **${amount}**.`,
        stats,
        reason,
      ),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

function buildAdminEmbed(title, user, description, stats, reason) {
  return new EmbedBuilder()
    .setColor(0xf59e0b)
    .setAuthor({ name: 'Invite beheer' })
    .setTitle(title)
    .setDescription(`${user}\n${description}`)
    .addFields(
      { name: 'Nieuw totaal', value: String(stats.valid), inline: true },
      { name: 'Handmatig', value: String(stats.manual || 0), inline: true },
      { name: 'Reden', value: reason, inline: false },
    )
    .setTimestamp();
}

async function handleSetRewardRoleCommand(interaction) {
  const milestone = interaction.options.getInteger('invites', true);
  const role = interaction.options.getRole('role', true);
  const botMember =
    interaction.guild.members.me ||
    (await interaction.guild.members.fetchMe().catch(() => null));

  if (role.id === interaction.guild.id || role.managed) {
    await interaction.reply({
      content: 'Deze rol kan ik niet automatisch uitdelen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (botMember && role.comparePositionTo(botMember.roles.highest) >= 0) {
    await interaction.reply({
      content:
        'Zet mijn bot-rol hoger dan deze reward-rol, anders mag Discord hem niet uitdelen.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const guildData = ensureGuildData(interaction.guild.id);
  guildData.rewardRoles[String(milestone)] = role.id;
  await saveGuildData(interaction.guild.id);

  await interaction.reply({
    content: `Vanaf **${milestone} geldige invite(s)** krijgt iemand automatisch ${role}.`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleRewardRolesCommand(interaction) {
  const guildData = ensureGuildData(interaction.guild.id);
  const rewardRoles = Object.entries(guildData.rewardRoles || {}).sort(
    ([a], [b]) => Number(a) - Number(b),
  );

  const description = rewardRoles.length
    ? rewardRoles
        .map(([milestone, roleId]) => `**${milestone} invites** -> <@&${roleId}>`)
        .join('\n')
    : 'Er zijn nog geen reward-rollen ingesteld. Gebruik `/setrewardrole`.';

  const embed = new EmbedBuilder()
    .setColor(0x3498db)
    .setTitle('Invite reward-rollen')
    .setDescription(description);

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });
}

async function handleSyncRewardsCommand(interaction) {
  const guildData = ensureGuildData(interaction.guild.id);
  const rewardRoles = guildData.rewardRoles || {};

  if (!Object.keys(rewardRoles).length) {
    await interaction.reply({
      content: 'Er zijn nog geen reward-rollen ingesteld.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let checked = 0;
  let awarded = 0;
  let failed = 0;

  for (const [userId, stats] of Object.entries(guildData.users || {})) {
    if (!stats.valid) continue;

    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    if (!member) continue;

    checked += 1;
    const result = await applyRewardRoles(member, stats.valid);
    awarded += result.awarded.length;
    failed += result.failed.length;
  }

  await interaction.editReply(
    `Rewards gesynchroniseerd. Gecontroleerd: **${checked}**, rollen gegeven: **${awarded}**, mislukt: **${failed}**.`,
  );
}
