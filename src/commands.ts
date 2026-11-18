import { PermissionFlagsBits, SlashCommandBuilder, type RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';

export function slashCommandBody(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  const link = new SlashCommandBuilder()
    .setName('link-account')
    .setDescription('Ask an admin to link your Jellyfin or Plex account')
    .addStringOption((option) =>
      option
        .setName('username')
        .setDescription('Jellyfin or Plex username, or your Seerr display name')
        .setRequired(true)
        .setMaxLength(80),
    )
    .addStringOption((option) =>
      option
        .setName('service')
        .setDescription('Where that username comes from')
        .setRequired(true)
        .addChoices({ name: 'Jellyfin', value: 'jellyfin' }, { name: 'Plex', value: 'plex' }),
    );

  const unlink = new SlashCommandBuilder()
    .setName('unlink-account')
    .setDescription('Remove the link between Discord and Seerr');

  const request = new SlashCommandBuilder()
    .setName('request')
    .setDescription('Request a movie or TV show')
    .addStringOption((option) =>
      option.setName('title').setDescription('Movie or show to search for').setRequired(true).setMaxLength(200),
    );

  const check = new SlashCommandBuilder()
    .setName('check')
    .setDescription('See the status of your requests')
    .addStringOption((option) =>
      option.setName('title').setDescription('Only show requests matching this title').setRequired(false).setMaxLength(200),
    );

  const search = new SlashCommandBuilder()
    .setName('search')
    .setDescription('Search the library without leaving this channel')
    .addStringOption((option) =>
      option.setName('query').setDescription('Movie or show to look up').setRequired(true).setMaxLength(200),
    );

  const links = new SlashCommandBuilder().setName('link').setDescription('Links to Jellyfin, Plex, Seerr, and status');
  const status = new SlashCommandBuilder().setName('status').setDescription('See what is up or down');
  const report = new SlashCommandBuilder().setName('report').setDescription('Report a playback problem');

  const recent = new SlashCommandBuilder()
    .setName('new')
    .setDescription('Recently added movies and shows')
    .addIntegerOption((option) =>
      option.setName('days').setDescription('How many days back').setRequired(false).setMinValue(1).setMaxValue(90),
    );

  const random = new SlashCommandBuilder()
    .setName('random')
    .setDescription('Pick a random movie or show from Jellyfin')
    .addStringOption((option) =>
      option
        .setName('type')
        .setDescription('Movie or TV')
        .setRequired(false)
        .addChoices({ name: 'Movie', value: 'movie' }, { name: 'TV', value: 'tv' }),
    )
    .addStringOption((option) =>
      option.setName('genre').setDescription('Optional Jellyfin genre').setRequired(false).setMaxLength(50),
    );

  const watchlist = new SlashCommandBuilder().setName('watchlist').setDescription('Your Seerr watchlist');
  const upcoming = new SlashCommandBuilder().setName('upcoming').setDescription('Episodes airing in the next 7 days');
  const stats = new SlashCommandBuilder().setName('stats').setDescription('Your Plex watch stats from Tautulli');
  const help = new SlashCommandBuilder().setName('help').setDescription('What the bot can do');

  const announce = new SlashCommandBuilder().setName('announce').setDescription('Post an announcement');
  const nowplaying = new SlashCommandBuilder().setName('nowplaying').setDescription('Who is watching right now');
  const pending = new SlashCommandBuilder().setName('pending').setDescription('Requests waiting for approval');
  const disk = new SlashCommandBuilder().setName('disk').setDescription('Disk use from Beszel');
  const restart = new SlashCommandBuilder()
    .setName('restart')
    .setDescription('Restart an allowlisted container')
    .addStringOption((option) =>
      option.setName('service').setDescription('Container name').setRequired(true).setAutocomplete(true),
    );
  const ask = new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Send a message to a MausBot')
    .addStringOption((option) =>
      option.setName('bot').setDescription('Which bot').setRequired(true).setAutocomplete(true),
    )
    .addStringOption((option) =>
      option.setName('message').setDescription('What to say').setRequired(true).setMaxLength(2000),
    );
  const askReset = new SlashCommandBuilder()
    .setName('ask-reset')
    .setDescription('Start a fresh MausBot chat')
    .addStringOption((option) =>
      option.setName('bot').setDescription('Which bot').setRequired(true).setAutocomplete(true),
    );
  const unlinkUser = new SlashCommandBuilder()
    .setName('unlink')
    .setDescription("Remove another member's account link")
    .addUserOption((option) => option.setName('user').setDescription('Member to unlink').setRequired(true));

  const purge = new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete recent messages in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((option) =>
      option.setName('count').setDescription('Delete the last N messages').setRequired(false).setMinValue(1).setMaxValue(1000),
    )
    .addIntegerOption((option) =>
      option.setName('days').setDescription('Delete everything from the last N days').setRequired(false).setMinValue(1).setMaxValue(30),
    )
    .addUserOption((option) => option.setName('user').setDescription('Only messages from this member').setRequired(false))
    .addBooleanOption((option) =>
      option.setName('include_pinned').setDescription('Delete pinned messages too (default: keep them)').setRequired(false),
    );

  return [
    link.toJSON(),
    unlink.toJSON(),
    request.toJSON(),
    check.toJSON(),
    search.toJSON(),
    links.toJSON(),
    status.toJSON(),
    report.toJSON(),
    recent.toJSON(),
    random.toJSON(),
    watchlist.toJSON(),
    upcoming.toJSON(),
    stats.toJSON(),
    help.toJSON(),
    announce.toJSON(),
    nowplaying.toJSON(),
    pending.toJSON(),
    disk.toJSON(),
    restart.toJSON(),
    ask.toJSON(),
    askReset.toJSON(),
    unlinkUser.toJSON(),
    purge.toJSON(),
  ];
}
