import { SlashCommandBuilder, type RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';

export function slashCommandBody(): RESTPostAPIChatInputApplicationCommandsJSONBody[] {
  const link = new SlashCommandBuilder()
    .setName('link-account')
    .setDescription('Link Discord to your Jellyfin or Plex account in Seerr')
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

  return [link.toJSON(), unlink.toJSON(), request.toJSON()];
}
