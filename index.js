/**
 * =====================================================================
 *  Advanced Ticket Bot  -  single file, discord.js v14
 * =====================================================================
 *  Setup:
 *    1. npm init -y
 *    2. npm install discord.js
 *    3. Set env var DISCORD_TOKEN  (or paste the token in TOKEN below)
 *    4. Enable "Message Content Intent" + "Server Members Intent" is NOT
 *       needed, only Message Content (for transcripts / claim lock).
 *    5. Invite bot with scopes: bot + applications.commands
 *       Permissions: Administrator (or Manage Channels, Manage Roles,
 *       Manage Messages, View Channel, Send Messages, Attach Files,
 *       Read Message History, Embed Links)
 *    6. node index.js
 *
 *  Everything is customised through slash commands:
 *    /setup category | logs | staffrole | maxtickets | welcome | naming
 *           reason | enforce | dmtranscript | panelstyle | panel | settings
 *    /ticket claim | unclaim | transfer | close | add | remove | rename
 *
 *  CLAIM RULE: once a staff member claims a ticket, no other staff can
 *  send messages in it (channel permissions + message enforcement, so
 *  even Administrators get their messages removed). The ticket owner and
 *  the claimer can talk. Unclaim restores access for all staff.
 * =====================================================================
 */

const fs = require('fs');
const path = require('path');
const {
  Client, GatewayIntentBits, Partials, Events, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, AttachmentBuilder,
  REST, Routes, MessageFlags,
} = require('discord.js');

const TOKEN = process.env.DISCORD_TOKEN || 'YOUR_BOT_TOKEN_HERE';
const DB_FILE = path.join(__dirname, 'tickets-db.json');

/* ------------------------------ Database ------------------------------ */
let db = { guilds: {}, tickets: {} };
try {
  if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} catch (e) { console.error('Failed to read DB, starting fresh:', e); }

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), (err) => err && console.error(err));
  }, 300);
}

const defaultConfig = () => ({
  categoryId: null,
  logChannelId: null,
  staffRoles: [],
  maxTickets: 1,
  counter: 0,
  welcome: 'Hello {user}, thanks for opening a ticket!\nA staff member will be with you shortly.',
  naming: 'ticket-{number}',
  requireReason: true,
  enforceClaim: true,
  dmTranscript: true,
  panel: {
    title: '🎫 Support Tickets',
    description: 'Need help? Click the button below to open a ticket.',
    color: '#5865F2',
    buttonLabel: 'Open Ticket',
    buttonEmoji: '🎫',
    buttonStyle: 'Primary',
  },
});

function getCfg(guildId) {
  if (!db.guilds[guildId]) { db.guilds[guildId] = defaultConfig(); save(); }
  // merge in any new defaults
  const d = defaultConfig();
  const c = db.guilds[guildId];
  for (const k of Object.keys(d)) if (c[k] === undefined) c[k] = d[k];
  for (const k of Object.keys(d.panel)) if (c.panel[k] === undefined) c.panel[k] = d.panel[k];
  return c;
}

/* ------------------------------ Client ------------------------------ */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

/* ------------------------------ Commands ------------------------------ */
const STYLES = [
  { name: 'Blue', value: 'Primary' },
  { name: 'Grey', value: 'Secondary' },
  { name: 'Green', value: 'Success' },
  { name: 'Red', value: 'Danger' },
];

const setupCmd = new SlashCommandBuilder()
  .setName('setup')
  .setDescription('Configure the ticket system')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false)
  .addSubcommand((s) => s.setName('category').setDescription('Category where tickets are created')
    .addChannelOption((o) => o.setName('category').setDescription('Category').addChannelTypes(ChannelType.GuildCategory).setRequired(true)))
  .addSubcommand((s) => s.setName('logs').setDescription('Channel for ticket logs & transcripts')
    .addChannelOption((o) => o.setName('channel').setDescription('Log channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
  .addSubcommand((s) => s.setName('staffrole').setDescription('Add or remove a staff role')
    .addStringOption((o) => o.setName('action').setDescription('Add or remove').setRequired(true)
      .addChoices({ name: 'Add', value: 'add' }, { name: 'Remove', value: 'remove' }))
    .addRoleOption((o) => o.setName('role').setDescription('Staff role').setRequired(true)))
  .addSubcommand((s) => s.setName('maxtickets').setDescription('Max open tickets per user')
    .addIntegerOption((o) => o.setName('amount').setDescription('1-10').setMinValue(1).setMaxValue(10).setRequired(true)))
  .addSubcommand((s) => s.setName('welcome').setDescription('Welcome message in new tickets ({user} {number})')
    .addStringOption((o) => o.setName('message').setDescription('Use \\n for new lines').setMaxLength(1500).setRequired(true)))
  .addSubcommand((s) => s.setName('naming').setDescription('Ticket channel name format ({number} {username})')
    .addStringOption((o) => o.setName('format').setDescription('e.g. ticket-{number} or {username}-support').setMaxLength(50).setRequired(true)))
  .addSubcommand((s) => s.setName('reason').setDescription('Ask for a reason (modal) when opening a ticket')
    .addBooleanOption((o) => o.setName('enabled').setDescription('Enabled?').setRequired(true)))
  .addSubcommand((s) => s.setName('enforce').setDescription('Delete messages from non-claimer staff (even admins)')
    .addBooleanOption((o) => o.setName('enabled').setDescription('Enabled?').setRequired(true)))
  .addSubcommand((s) => s.setName('dmtranscript').setDescription('DM transcript to ticket owner on close')
    .addBooleanOption((o) => o.setName('enabled').setDescription('Enabled?').setRequired(true)))
  .addSubcommand((s) => s.setName('panelstyle').setDescription('Customise the panel embed and button')
    .addStringOption((o) => o.setName('title').setDescription('Embed title').setMaxLength(100))
    .addStringOption((o) => o.setName('description').setDescription('Embed description (\\n for new lines)').setMaxLength(1500))
    .addStringOption((o) => o.setName('color').setDescription('Hex color e.g. #ff0000').setMaxLength(7))
    .addStringOption((o) => o.setName('button_label').setDescription('Button text').setMaxLength(80))
    .addStringOption((o) => o.setName('button_emoji').setDescription('Button emoji'))
    .addStringOption((o) => o.setName('button_style').setDescription('Button color').addChoices(...STYLES)))
  .addSubcommand((s) => s.setName('panel').setDescription('Send the ticket panel')
    .addChannelOption((o) => o.setName('channel').setDescription('Where to send it (default: here)').addChannelTypes(ChannelType.GuildText)))
  .addSubcommand((s) => s.setName('settings').setDescription('View current settings'));

const ticketCmd = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Ticket management')
  .setDMPermission(false)
  .addSubcommand((s) => s.setName('claim').setDescription('Claim this ticket'))
  .addSubcommand((s) => s.setName('unclaim').setDescription('Release this ticket'))
  .addSubcommand((s) => s.setName('transfer').setDescription('Transfer claim to another staff member')
    .addUserOption((o) => o.setName('staff').setDescription('New claimer').setRequired(true)))
  .addSubcommand((s) => s.setName('close').setDescription('Close this ticket')
    .addStringOption((o) => o.setName('reason').setDescription('Close reason')))
  .addSubcommand((s) => s.setName('add').setDescription('Add a user to this ticket')
    .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true)))
  .addSubcommand((s) => s.setName('remove').setDescription('Remove a user from this ticket')
    .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true)))
  .addSubcommand((s) => s.setName('rename').setDescription('Rename this ticket')
    .addStringOption((o) => o.setName('name').setDescription('New name').setMaxLength(90).setRequired(true)));

const commandsJSON = [setupCmd, ticketCmd].map((c) => c.toJSON());

async function registerCommands() {
  const rest = new REST({ version: '10' }).setToken(TOKEN);
  await rest.put(Routes.applicationCommands(client.user.id), { body: commandsJSON });
  console.log('✅ Slash commands registered');
}

/* ------------------------------ Helpers ------------------------------ */
const ok = (text) => ({ content: `✅ ${text}`, flags: MessageFlags.Ephemeral });
const err = (text) => ({ content: `❌ ${text}`, flags: MessageFlags.Ephemeral });

function isStaff(member, cfg) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return cfg.staffRoles.some((r) => member.roles.cache.has(r));
}

function parseColor(hex) {
  return /^#?[0-9a-fA-F]{6}$/.test(hex || '') ? parseInt(hex.replace('#', ''), 16) : 0x5865f2;
}

function nl(str) { return str.replace(/\\n/g, '\n'); }

function sanitizeName(name) {
  return name.toLowerCase().replace(/[^a-z0-9-_ ]/g, '').trim().replace(/\s+/g, '-').slice(0, 90) || 'ticket';
}

function ticketButtons(claimed) {
  return new ActionRowBuilder().addComponents(
    claimed
      ? new ButtonBuilder().setCustomId('ticket_unclaim').setLabel('Unclaim').setEmoji('🔓').setStyle(ButtonStyle.Secondary)
      : new ButtonBuilder().setCustomId('ticket_claim').setLabel('Claim').setEmoji('🙋').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('ticket_close').setLabel('Close').setEmoji('🔒').setStyle(ButtonStyle.Danger),
  );
}

async function logEvent(guild, cfg, embed, files = []) {
  if (!cfg.logChannelId) return;
  const ch = guild.channels.cache.get(cfg.logChannelId) || await guild.channels.fetch(cfg.logChannelId).catch(() => null);
  if (ch) await ch.send({ embeds: [embed], files }).catch(() => {});
}

async function buildTranscript(channel, ticket) {
  let all = [];
  let before;
  for (let i = 0; i < 10; i++) { // up to 1000 messages
    const batch = await channel.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch || batch.size === 0) break;
    all = all.concat([...batch.values()]);
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  all.reverse();
  const lines = [
    `Transcript for #${channel.name}`,
    `Ticket #${ticket.number} | Owner: ${ticket.ownerId} | Opened: ${new Date(ticket.createdAt).toISOString()}`,
    `Reason: ${ticket.reason || 'N/A'}`,
    '='.repeat(60),
  ];
  for (const m of all) {
    const time = m.createdAt.toISOString().replace('T', ' ').slice(0, 19);
    const content = m.content || (m.embeds.length ? '[embed]' : '');
    lines.push(`[${time}] ${m.author.tag}: ${content}`);
    for (const a of m.attachments.values()) lines.push(`    📎 ${a.url}`);
  }
  return new AttachmentBuilder(Buffer.from(lines.join('\n'), 'utf8'), { name: `transcript-${channel.name}.txt` });
}

/* ---------------------------- Ticket actions ---------------------------- */
async function createTicket(interaction, reason) {
  const { guild, user } = interaction;
  const cfg = getCfg(guild.id);

  const open = Object.entries(db.tickets).filter(([, t]) => t.guildId === guild.id && t.ownerId === user.id);
  if (open.length >= cfg.maxTickets) {
    return interaction.editReply(`❌ You already have ${open.length} open ticket(s): ${open.map(([id]) => `<#${id}>`).join(', ')}`);
  }
  if (!cfg.staffRoles.length) return interaction.editReply('❌ No staff roles are configured. Ask an admin to run `/setup staffrole`.');

  cfg.counter += 1;
  const number = cfg.counter;
  const name = sanitizeName(cfg.naming.replace('{number}', String(number).padStart(4, '0')).replace('{username}', user.username));

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks],
    },
    {
      id: client.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.EmbedLinks],
    },
    ...cfg.staffRoles.filter((r) => guild.roles.cache.has(r)).map((r) => ({
      id: r,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks],
    })),
  ];

  let channel;
  try {
    channel = await guild.channels.create({
      name,
      type: ChannelType.GuildText,
      parent: cfg.categoryId && guild.channels.cache.has(cfg.categoryId) ? cfg.categoryId : null,
      topic: `Ticket #${number} | Owner: ${user.tag} (${user.id})`,
      permissionOverwrites: overwrites,
    });
  } catch (e) {
    console.error(e);
    return interaction.editReply('❌ I could not create the ticket channel. Check my permissions.');
  }

  db.tickets[channel.id] = {
    guildId: guild.id, ownerId: user.id, number, reason: reason || null,
    claimedBy: null, createdAt: Date.now(),
  };
  save();

  const embed = new EmbedBuilder()
    .setColor(parseColor(cfg.panel.color))
    .setTitle(`Ticket #${number}`)
    .setDescription(cfg.welcome.replace(/{user}/g, `<@${user.id}>`).replace(/{number}/g, number))
    .addFields(
      { name: 'Opened by', value: `<@${user.id}>`, inline: true },
      { name: 'Status', value: '🟢 Unclaimed', inline: true },
    )
    .setTimestamp();
  if (reason) embed.addFields({ name: 'Reason', value: reason.slice(0, 1000) });

  await channel.send({
    content: `<@${user.id}> ${cfg.staffRoles.map((r) => `<@&${r}>`).join(' ')}`,
    embeds: [embed],
    components: [ticketButtons(false)],
    allowedMentions: { users: [user.id], roles: cfg.staffRoles },
  });

  await logEvent(guild, cfg, new EmbedBuilder().setColor(0x57f287).setTitle('Ticket Opened')
    .addFields({ name: 'Ticket', value: `<#${channel.id}> (#${number})`, inline: true }, { name: 'Owner', value: `<@${user.id}>`, inline: true },
      { name: 'Reason', value: reason || 'N/A' }).setTimestamp());

  return interaction.editReply(`✅ Your ticket has been created: <#${channel.id}>`);
}

async function claimTicket(interaction, channel, ticket, cfg) {
  const guild = interaction.guild;
  if (!isStaff(interaction.member, cfg)) return err('Only staff can claim tickets.');
  if (ticket.claimedBy) return err(`This ticket is already claimed by <@${ticket.claimedBy}>.`);
  if (interaction.user.id === ticket.ownerId) return err("You can't claim your own ticket.");

  await applyClaimLock(channel, guild, cfg, interaction.user.id, null);
  ticket.claimedBy = interaction.user.id;
  save();
  await refreshTicketMessage(channel, ticket, cfg);
  await channel.send({ embeds: [new EmbedBuilder().setColor(0x57f287)
    .setDescription(`🙋 <@${interaction.user.id}> has claimed this ticket.\nOther staff members can no longer send messages here.`)] });
  await logEvent(guild, cfg, new EmbedBuilder().setColor(0xfee75c).setTitle('Ticket Claimed')
    .addFields({ name: 'Ticket', value: `<#${channel.id}>`, inline: true }, { name: 'Staff', value: `<@${interaction.user.id}>`, inline: true }).setTimestamp());
  return null;
}

async function unclaimTicket(interaction, channel, ticket, cfg) {
  if (!ticket.claimedBy) return err('This ticket is not claimed.');
  const canForce = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
  if (ticket.claimedBy !== interaction.user.id && !canForce) return err('Only the claimer (or an administrator) can unclaim.');

  await releaseClaimLock(channel, cfg, ticket.claimedBy);
  const prev = ticket.claimedBy;
  ticket.claimedBy = null;
  save();
  await refreshTicketMessage(channel, ticket, cfg);
  await channel.send({ embeds: [new EmbedBuilder().setColor(0xed4245)
    .setDescription(`🔓 <@${prev}> released this ticket. All staff can respond again.`)] });
  await logEvent(interaction.guild, cfg, new EmbedBuilder().setColor(0xfee75c).setTitle('Ticket Unclaimed')
    .addFields({ name: 'Ticket', value: `<#${channel.id}>`, inline: true }, { name: 'By', value: `<@${interaction.user.id}>`, inline: true }).setTimestamp());
  return null;
}

/** Lock all staff roles from sending; allow only the claimer. */
async function applyClaimLock(channel, guild, cfg, newClaimerId, oldClaimerId) {
  for (const roleId of cfg.staffRoles) {
    if (guild.roles.cache.has(roleId)) {
      await channel.permissionOverwrites.edit(roleId, { SendMessages: false, ViewChannel: true, ReadMessageHistory: true }).catch(() => {});
    }
  }
  if (oldClaimerId) await channel.permissionOverwrites.delete(oldClaimerId).catch(() => {});
  await channel.permissionOverwrites.edit(newClaimerId, {
    ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true,
  }).catch(() => {});
}

async function releaseClaimLock(channel, cfg, claimerId) {
  for (const roleId of cfg.staffRoles) {
    if (channel.guild.roles.cache.has(roleId)) {
      await channel.permissionOverwrites.edit(roleId, { SendMessages: true, ViewChannel: true, ReadMessageHistory: true }).catch(() => {});
    }
  }
  if (claimerId) await channel.permissionOverwrites.delete(claimerId).catch(() => {});
}

async function refreshTicketMessage(channel, ticket, cfg) {
  const msgs = await channel.messages.fetch({ limit: 50, after: '0' }).catch(() => null);
  if (!msgs) return;
  const first = msgs.find((m) => m.author.id === client.user.id && m.components.length && m.embeds[0]?.title?.startsWith('Ticket #'));
  if (!first) return;
  const embed = EmbedBuilder.from(first.embeds[0]);
  const fields = (first.embeds[0].fields || []).filter((f) => f.name !== 'Status' && f.name !== 'Claimed by');
  embed.setFields(fields);
  embed.addFields({ name: 'Status', value: ticket.claimedBy ? '🔒 Claimed' : '🟢 Unclaimed', inline: true });
  if (ticket.claimedBy) embed.addFields({ name: 'Claimed by', value: `<@${ticket.claimedBy}>`, inline: true });
  await first.edit({ embeds: [embed], components: [ticketButtons(!!ticket.claimedBy)] }).catch(() => {});
}

async function closeTicket(interaction, channel, ticket, cfg, reason) {
  const guild = interaction.guild;
  const canClose = isStaff(interaction.member, cfg) || interaction.user.id === ticket.ownerId;
  if (!canClose) return err('You cannot close this ticket.');
  if (ticket.claimedBy && ticket.claimedBy !== interaction.user.id
    && interaction.user.id !== ticket.ownerId
    && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    return err(`Only the claimer <@${ticket.claimedBy}>, the ticket owner or an administrator can close this.`);
  }

  await interaction.reply({ embeds: [new EmbedBuilder().setColor(0xed4245)
    .setDescription(`🔒 Ticket closing in 5 seconds...${reason ? `\n**Reason:** ${reason}` : ''}`)] });

  const transcript = await buildTranscript(channel, ticket);
  const embed = new EmbedBuilder().setColor(0xed4245).setTitle('Ticket Closed')
    .addFields(
      { name: 'Ticket', value: `#${ticket.number} (${channel.name})`, inline: true },
      { name: 'Owner', value: `<@${ticket.ownerId}>`, inline: true },
      { name: 'Claimed by', value: ticket.claimedBy ? `<@${ticket.claimedBy}>` : 'Nobody', inline: true },
      { name: 'Closed by', value: `<@${interaction.user.id}>`, inline: true },
      { name: 'Reason', value: reason || 'N/A' },
    ).setTimestamp();

  await logEvent(guild, cfg, embed, [transcript]);

  if (cfg.dmTranscript) {
    const owner = await client.users.fetch(ticket.ownerId).catch(() => null);
    if (owner) {
      const dmTranscript = new AttachmentBuilder(transcript.attachment, { name: transcript.name });
      await owner.send({ embeds: [embed.setTitle(`Your ticket in ${guild.name} was closed`)], files: [dmTranscript] }).catch(() => {});
    }
  }

  delete db.tickets[channel.id];
  save();
  setTimeout(() => channel.delete('Ticket closed').catch(() => {}), 5000);
  return null;
}

/* ------------------------------ Panel ------------------------------ */
function buildPanel(cfg) {
  const p = cfg.panel;
  const embed = new EmbedBuilder().setColor(parseColor(p.color)).setTitle(p.title).setDescription(p.description);
  const btn = new ButtonBuilder().setCustomId('ticket_create').setLabel(p.buttonLabel)
    .setStyle(ButtonStyle[p.buttonStyle] || ButtonStyle.Primary);
  if (p.buttonEmoji) { try { btn.setEmoji(p.buttonEmoji); } catch { /* invalid emoji ignored */ } }
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(btn)] };
}

/* ------------------------------ Events ------------------------------ */
client.once(Events.ClientReady, async () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  try { await registerCommands(); } catch (e) { console.error('Command registration failed:', e); }
});

// Claim enforcement: even admins can't talk if they aren't the claimer.
client.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.author.bot) return;
  const ticket = db.tickets[message.channel.id];
  if (!ticket || !ticket.claimedBy) return;
  const cfg = getCfg(message.guild.id);
  if (!cfg.enforceClaim) return;
  if (message.author.id === ticket.claimedBy || message.author.id === ticket.ownerId) return;

  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!isStaff(member, cfg)) return; // users added via /ticket add may talk

  await message.delete().catch(() => {});
  const warn = await message.channel.send(`⛔ <@${message.author.id}>, this ticket is claimed by <@${ticket.claimedBy}>. Only they can reply.`).catch(() => null);
  if (warn) setTimeout(() => warn.delete().catch(() => {}), 4000);
});

// Clean up DB if a ticket channel is deleted manually
client.on(Events.ChannelDelete, (channel) => {
  if (db.tickets[channel.id]) { delete db.tickets[channel.id]; save(); }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.guild) return;
    const cfg = getCfg(interaction.guild.id);

    /* ---------- Buttons ---------- */
    if (interaction.isButton()) {
      const id = interaction.customId;

      if (id === 'ticket_create') {
        if (cfg.requireReason) {
          const modal = new ModalBuilder().setCustomId('ticket_modal').setTitle('Open a Ticket')
            .addComponents(new ActionRowBuilder().addComponents(
              new TextInputBuilder().setCustomId('reason').setLabel('What do you need help with?')
                .setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(true)));
          return interaction.showModal(modal);
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        return createTicket(interaction, null);
      }

      const ticket = db.tickets[interaction.channel.id];
      if (!ticket) return interaction.reply(err('This is not a ticket channel.'));

      if (id === 'ticket_claim') {
        const r = await claimTicket(interaction, interaction.channel, ticket, cfg);
        return r ? interaction.reply(r) : interaction.reply(ok('Ticket claimed.'));
      }
      if (id === 'ticket_unclaim') {
        const r = await unclaimTicket(interaction, interaction.channel, ticket, cfg);
        return r ? interaction.reply(r) : interaction.reply(ok('Ticket unclaimed.'));
      }
      if (id === 'ticket_close') {
        const r = await closeTicket(interaction, interaction.channel, ticket, cfg, null);
        if (r) return interaction.reply(r);
        return null;
      }
      return null;
    }

    /* ---------- Modal ---------- */
    if (interaction.isModalSubmit() && interaction.customId === 'ticket_modal') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      return createTicket(interaction, interaction.fields.getTextInputValue('reason'));
    }

    /* ---------- Slash commands ---------- */
    if (!interaction.isChatInputCommand()) return null;

    /* /setup */
    if (interaction.commandName === 'setup') {
      const sub = interaction.options.getSubcommand();
      switch (sub) {
        case 'category': {
          cfg.categoryId = interaction.options.getChannel('category').id; save();
          return interaction.reply(ok(`Tickets will be created in **${interaction.options.getChannel('category').name}**.`));
        }
        case 'logs': {
          cfg.logChannelId = interaction.options.getChannel('channel').id; save();
          return interaction.reply(ok(`Logs will be sent to <#${cfg.logChannelId}>.`));
        }
        case 'staffrole': {
          const role = interaction.options.getRole('role');
          const action = interaction.options.getString('action');
          if (action === 'add') {
            if (cfg.staffRoles.includes(role.id)) return interaction.reply(err('That role is already a staff role.'));
            cfg.staffRoles.push(role.id);
          } else {
            cfg.staffRoles = cfg.staffRoles.filter((r) => r !== role.id);
          }
          save();
          return interaction.reply(ok(`Staff roles: ${cfg.staffRoles.map((r) => `<@&${r}>`).join(', ') || 'none'}`));
        }
        case 'maxtickets': {
          cfg.maxTickets = interaction.options.getInteger('amount'); save();
          return interaction.reply(ok(`Max tickets per user: **${cfg.maxTickets}**`));
        }
        case 'welcome': {
          cfg.welcome = nl(interaction.options.getString('message')); save();
          return interaction.reply(ok('Welcome message updated.'));
        }
        case 'naming': {
          cfg.naming = interaction.options.getString('format'); save();
          return interaction.reply(ok(`Naming format set to \`${cfg.naming}\``));
        }
        case 'reason': {
          cfg.requireReason = interaction.options.getBoolean('enabled'); save();
          return interaction.reply(ok(`Reason prompt ${cfg.requireReason ? 'enabled' : 'disabled'}.`));
        }
        case 'enforce': {
          cfg.enforceClaim = interaction.options.getBoolean('enabled'); save();
          return interaction.reply(ok(`Claim enforcement (message deletion for other staff) ${cfg.enforceClaim ? 'enabled' : 'disabled'}.`));
        }
        case 'dmtranscript': {
          cfg.dmTranscript = interaction.options.getBoolean('enabled'); save();
          return interaction.reply(ok(`DM transcripts ${cfg.dmTranscript ? 'enabled' : 'disabled'}.`));
        }
        case 'panelstyle': {
          const o = interaction.options;
          if (o.getString('title')) cfg.panel.title = o.getString('title');
          if (o.getString('description')) cfg.panel.description = nl(o.getString('description'));
          if (o.getString('color')) cfg.panel.color = o.getString('color');
          if (o.getString('button_label')) cfg.panel.buttonLabel = o.getString('button_label');
          if (o.getString('button_emoji')) cfg.panel.buttonEmoji = o.getString('button_emoji');
          if (o.getString('button_style')) cfg.panel.buttonStyle = o.getString('button_style');
          save();
          return interaction.reply({ content: '✅ Panel style updated. Preview:', ...buildPanel(cfg), flags: MessageFlags.Ephemeral });
        }
        case 'panel': {
          const ch = interaction.options.getChannel('channel') || interaction.channel;
          await ch.send(buildPanel(cfg));
          return interaction.reply(ok(`Panel sent to <#${ch.id}>.`));
        }
        case 'settings': {
          const embed = new EmbedBuilder().setColor(0x5865f2).setTitle('🎫 Ticket Settings').addFields(
            { name: 'Category', value: cfg.categoryId ? `<#${cfg.categoryId}>` : 'Not set', inline: true },
            { name: 'Log channel', value: cfg.logChannelId ? `<#${cfg.logChannelId}>` : 'Not set', inline: true },
            { name: 'Max tickets/user', value: String(cfg.maxTickets), inline: true },
            { name: 'Staff roles', value: cfg.staffRoles.map((r) => `<@&${r}>`).join(', ') || 'None' },
            { name: 'Naming', value: `\`${cfg.naming}\``, inline: true },
            { name: 'Ask reason', value: cfg.requireReason ? 'Yes' : 'No', inline: true },
            { name: 'Enforce claim', value: cfg.enforceClaim ? 'Yes' : 'No', inline: true },
            { name: 'DM transcript', value: cfg.dmTranscript ? 'Yes' : 'No', inline: true },
            { name: 'Welcome message', value: cfg.welcome.slice(0, 1000) },
          );
          return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }
        default: return null;
      }
    }

    /* /ticket */
    if (interaction.commandName === 'ticket') {
      const channel = interaction.channel;
      const ticket = db.tickets[channel.id];
      if (!ticket) return interaction.reply(err('Use this command inside a ticket channel.'));
      const sub = interaction.options.getSubcommand();

      if (sub === 'claim') {
        const r = await claimTicket(interaction, channel, ticket, cfg);
        return interaction.reply(r || ok('Ticket claimed.'));
      }
      if (sub === 'unclaim') {
        const r = await unclaimTicket(interaction, channel, ticket, cfg);
        return interaction.reply(r || ok('Ticket unclaimed.'));
      }
      if (sub === 'close') {
        const r = await closeTicket(interaction, channel, ticket, cfg, interaction.options.getString('reason'));
        return r ? interaction.reply(r) : null;
      }

      // everything below is staff-only
      if (!isStaff(interaction.member, cfg)) return interaction.reply(err('Staff only.'));
      if (ticket.claimedBy && ticket.claimedBy !== interaction.user.id
        && !interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply(err(`This ticket is claimed by <@${ticket.claimedBy}>.`));
      }

      if (sub === 'transfer') {
        if (!ticket.claimedBy) return interaction.reply(err('Claim the ticket first.'));
        const target = interaction.options.getMember('staff');
        if (!target || !isStaff(target, cfg)) return interaction.reply(err('That user is not staff.'));
        if (target.id === ticket.claimedBy) return interaction.reply(err('They already own this ticket.'));
        await applyClaimLock(channel, interaction.guild, cfg, target.id, ticket.claimedBy);
        ticket.claimedBy = target.id; save();
        await refreshTicketMessage(channel, ticket, cfg);
        await channel.send({ embeds: [new EmbedBuilder().setColor(0x5865f2)
          .setDescription(`🔁 Ticket transferred to <@${target.id}> by <@${interaction.user.id}>.`)] });
        return interaction.reply(ok('Ticket transferred.'));
      }
      if (sub === 'add') {
        const u = interaction.options.getUser('user');
        await channel.permissionOverwrites.edit(u.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true });
        return interaction.reply({ content: `✅ Added <@${u.id}> to the ticket.`, allowedMentions: { parse: [] } });
      }
      if (sub === 'remove') {
        const u = interaction.options.getUser('user');
        if (u.id === ticket.ownerId) return interaction.reply(err("You can't remove the ticket owner."));
        await channel.permissionOverwrites.delete(u.id).catch(() => {});
        return interaction.reply({ content: `✅ Removed <@${u.id}> from the ticket.`, allowedMentions: { parse: [] } });
      }
      if (sub === 'rename') {
        const n = sanitizeName(interaction.options.getString('name'));
        await channel.setName(n);
        return interaction.reply(ok(`Renamed to **${n}**.`));
      }
    }
    return null;
  } catch (e) {
    console.error('Interaction error:', e);
    const payload = err('Something went wrong.');
    if (interaction.deferred || interaction.replied) interaction.followUp(payload).catch(() => {});
    else interaction.reply(payload).catch(() => {});
    return null;
  }
});

process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e));
client.login(TOKEN);
