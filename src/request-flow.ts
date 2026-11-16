import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { accountGate, failureText } from './access';
import type { AppContext } from './context';
import { clip } from './http';
import { resultViews } from './present';
import { posterUrl, type MediaKind, type SearchHit } from './seerr';

const BLURPLE = 0x5865f2;
const GREEN = 0x3ba55d;
const YELLOW = 0xfee75c;

type PickInteraction = ButtonInteraction | StringSelectMenuInteraction;

export async function requestTitle(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (interaction.channelId !== ctx.env.REQUESTS_CHANNEL_ID) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: `Use /request in <#${ctx.env.REQUESTS_CHANNEL_ID}>.`,
    });
    return;
  }
  const gate = accountGate(ctx, interaction.user.id);
  if (!gate.ok) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: gate.message });
    return;
  }
  const title = interaction.options.getString('title', true).trim();
  if (!title) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Enter a title to search for.' });
    return;
  }
  await showSearch(interaction, ctx, title, 'numbers');
}

export async function showSearch(
  interaction: ChatInputCommandInteraction,
  ctx: AppContext,
  query: string,
  mode: 'numbers' | 'request',
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const hits = dedupeHits((await ctx.seerr.search(query)).slice(0, 5));
    if (hits.length === 0) {
      await interaction.editReply(
        `Nothing matched "${clip(query, 80)}". Try a shorter title, drop the subtitle, or add the year (for example \`Dune 2021\`).`,
      );
      return;
    }
    const view = resultViews(hits, mode);
    await interaction.editReply({
      content: mode === 'numbers' ? 'Pick a result.' : 'Search results. Request is only offered for titles that are not on the server.',
      embeds: view.embeds,
      components: view.components,
    });
  } catch (error) {
    await interaction.editReply(failureText(error, 'Seerr search failed.'));
  }
}

export async function pickGo(interaction: ButtonInteraction, ctx: AppContext): Promise<void> {
  const parsed = /^request:go:(movie|tv):(\d+)$/.exec(interaction.customId);
  if (!parsed) return;
  if (interaction.channelId !== ctx.env.REQUESTS_CHANNEL_ID) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: `Use /request in <#${ctx.env.REQUESTS_CHANNEL_ID}>.`,
    });
    return;
  }
  await openChoice(interaction, ctx, parsed[1] as MediaKind, Number(parsed[2]));
}

export async function pickLegacy(interaction: StringSelectMenuInteraction, ctx: AppContext): Promise<void> {
  const parsed = /^(movie|tv):(\d+)$/.exec(interaction.values[0] ?? '');
  if (!parsed) {
    await interaction.update({ content: 'That choice is out of date. Run /request again.', components: [] });
    return;
  }
  await openChoice(interaction, ctx, parsed[1] as MediaKind, Number(parsed[2]));
}

export async function pickSeason(interaction: ButtonInteraction, ctx: AppContext): Promise<void> {
  const parsed = /^request:season:(all|latest):(\d+)(?::(\d+))?$/.exec(interaction.customId);
  if (!parsed) {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content: 'That button is out of date. Run /request again.',
    });
    return;
  }
  const mode = parsed[1] as 'all' | 'latest';
  const mediaId = Number(parsed[2]);
  const chosenSeason = parsed[3] ? Number(parsed[3]) : undefined;
  const gate = accountGate(ctx, interaction.user.id);
  if (!gate.ok) {
    await interaction.update({ content: gate.message, embeds: [], components: [] });
    return;
  }

  await interaction.deferUpdate();
  try {
    const show = await ctx.seerr.getTv(mediaId);
    const latest = chosenSeason ?? show.seasonNumbers[show.seasonNumbers.length - 1];
    if (mode === 'latest' && !latest) {
      await interaction.editReply({
        content: null,
        embeds: [doneEmbed(show, 'This show has no regular seasons to request.', YELLOW)],
        components: [],
      });
      return;
    }
    const seasons = mode === 'latest' && latest ? [latest] : 'all';
    const created = await ctx.seerr.createRequest({
      mediaType: 'tv',
      mediaId,
      userId: gate.link.seerrUserId,
      seasons,
    });
    const requested = mode === 'latest' && latest ? `Requested season ${latest}.` : 'Requested all seasons.';
    await interaction.editReply({
      content: null,
      embeds: [doneEmbed(show, created.outcome === 'created' ? requested : created.message, created.outcome === 'created' ? GREEN : YELLOW)],
      components: [],
    });
  } catch (error) {
    await interaction.editReply({
      content: failureText(error, 'Could not send that request to Seerr.'),
      embeds: [],
      components: [],
    });
  }
}

async function openChoice(interaction: PickInteraction, ctx: AppContext, mediaType: MediaKind, mediaId: number): Promise<void> {
  const gate = accountGate(ctx, interaction.user.id);
  if (!gate.ok) {
    await interaction.update({ content: gate.message, embeds: [], components: [] });
    return;
  }

  await interaction.deferUpdate();
  try {
    if (mediaType === 'movie') {
      const movie = await ctx.seerr.getMovie(mediaId);
      if (movie.availability === 'available') {
        await interaction.editReply({ content: null, embeds: [doneEmbed(movie, 'This is already available.', YELLOW)], components: [] });
        return;
      }
      const created = await ctx.seerr.createRequest({ mediaType: 'movie', mediaId, userId: gate.link.seerrUserId });
      await interaction.editReply({
        content: null,
        embeds: [doneEmbed(movie, created.outcome === 'created' ? 'Requested.' : created.message, created.outcome === 'created' ? GREEN : YELLOW)],
        components: [],
      });
      return;
    }

    const show = await ctx.seerr.getTv(mediaId);
    if (show.seasonNumbers.length === 0) {
      await interaction.editReply({
        content: null,
        embeds: [doneEmbed(show, 'This show has no regular seasons to request.', YELLOW)],
        components: [],
      });
      return;
    }
    const latest = show.seasonNumbers[show.seasonNumbers.length - 1];
    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`request:season:all:${mediaId}`).setLabel('All seasons').setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(`request:season:latest:${mediaId}:${latest}`)
        .setLabel(`Latest season (${latest})`)
        .setStyle(ButtonStyle.Secondary),
    );
    await interaction.editReply({
      content: null,
      embeds: [doneEmbed(show, 'Request every season, or only the latest?', BLURPLE)],
      components: [row],
    });
  } catch (error) {
    await interaction.editReply({
      content: failureText(error, 'Could not load that title from Seerr.'),
      embeds: [],
      components: [],
    });
  }
}

function doneEmbed(
  input: { title: string; year?: number; posterPath?: string },
  detail: string,
  color: number,
): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(input.title).setDescription(detail).setColor(color);
  if (input.year) embed.addFields({ name: 'Year', value: String(input.year), inline: true });
  const poster = posterUrl(input.posterPath, 'w342');
  if (poster) embed.setThumbnail(poster);
  return embed;
}

function dedupeHits(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>();
  return hits.filter((hit) => {
    const key = `${hit.mediaType}:${hit.mediaId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
