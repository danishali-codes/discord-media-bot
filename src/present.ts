import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { libraryLabel } from './check-format';
import { clip } from './http';
import { newItemDetail, type GroupedNew } from './library';
import { posterUrl, type SearchHit } from './seerr';

const BLURPLE = 0x5865f2;

export function resultViews(hits: SearchHit[], mode: 'numbers' | 'request'): {
  embeds: EmbedBuilder[];
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const buttons: ButtonBuilder[] = [];
  hits.forEach((hit, index) => {
    const number = index + 1;
    const requestable = hit.library === undefined || hit.library === 'absent';
    if (mode === 'numbers' || requestable) {
      buttons.push(
        new ButtonBuilder()
          .setCustomId(`request:go:${hit.mediaType}:${hit.mediaId}`)
          .setLabel(mode === 'numbers' ? String(number) : `Request ${number}`)
          .setStyle(mode === 'numbers' ? ButtonStyle.Primary : ButtonStyle.Success),
      );
    }
  });
  const components = buttons.length
    ? [new ActionRowBuilder<ButtonBuilder>().addComponents(...buttons.slice(0, 5))]
    : [];
  return { embeds: hits.slice(0, 5).map(resultEmbed), components };
}

export function resultEmbed(hit: SearchHit): EmbedBuilder {
  const label = libraryLabel(hit.library);
  const kind = hit.mediaType === 'movie' ? 'Movie' : 'TV';
  const overview = hit.overview ? `${clip(hit.overview, 200)}\n\n` : '';
  const embed = new EmbedBuilder()
    .setColor(BLURPLE)
    .setTitle(clip(`${hit.title}${hit.year ? ` (${hit.year})` : ''}`, 250))
    .setDescription(`${overview}${kind} · ${label.emoji} ${label.text}`);
  const poster = posterUrl(hit.posterPath, 'w342');
  if (poster) embed.setThumbnail(poster);
  return embed;
}

export function newEmbed(entry: GroupedNew & { posterPath?: string }): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(BLURPLE)
    .setTitle(clip(`${entry.title}${entry.year ? ` (${entry.year})` : ''}`, 250))
    .setDescription(`${entry.overview ? `${clip(entry.overview, 200)}\n\n` : ''}${newItemDetail(entry)}`);
  const poster = posterUrl(entry.posterPath, 'w342');
  if (poster) embed.setThumbnail(poster);
  return embed;
}

export function requestButtons(requestId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`seerr:approve:${requestId}`).setLabel('Approve').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`seerr:decline:${requestId}`).setLabel('Decline').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`seerr:alter:${requestId}`).setLabel('Alter').setStyle(ButtonStyle.Secondary),
  );
}
