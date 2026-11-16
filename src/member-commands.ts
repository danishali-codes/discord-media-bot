import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { accountGate, canManage, dm, failureText } from './access';
import { formatMonitor, parseStatusPage } from './kuma';
import { formatRequestLine, requestMatches, type UserRequest } from './check-format';
import type { AppContext } from './context';
import { requestJson } from './http';
import { JellyfinClient, jellyfinConfigured } from './jellyfin';
import { filterUpcoming, mediaUsernames } from './library';
import { collectLinks } from './links';
import { collectNew } from './new-media';
import { newEmbed, resultViews } from './present';
import { posterUrl } from './seerr';
import { buildIssue, chooseReportTarget, parseProblem, problemLabel, type ReportCandidate } from './report';
import { showSearch } from './request-flow';
import { SonarrClient, sonarrConfigured } from './sonarr';
import { matchTautulliUser, TautulliClient, tautulliConfigured } from './tautulli';
import { DUBAI } from './schedule';

const BLURPLE = 0x5865f2;
const GREEN = 0x3ba55d;
const RED = 0xed4245;

const MEMBER_HELP: Array<[string, string]> = [
  ['/link-account', 'Ask an admin to link your Jellyfin or Plex account.'],
  ['/unlink-account', 'Remove your own link.'],
  ['/request', 'Request a movie or show. Only in the requests channel.'],
  ['/search', 'See availability. Request buttons follow the same rules as /request.'],
  ['/check', 'Your requests, newest first.'],
  ['/watchlist', 'Your Seerr watchlist.'],
  ['/new', 'Recently added movies and shows. Optional days, default 7.'],
  ['/random', 'A random Jellyfin movie or show. Optional type and genre.'],
  ['/upcoming', 'Episodes in the next 7 days for shows you have requested.'],
  ['/stats', 'Your watch time. Tautulli only covers Plex.'],
  ['/report', 'Report a playback problem on something in the library.'],
  ['/link', 'Links to Jellyfin, Plex, Seerr, and the status page.'],
  ['/status', 'Whether each monitor is up.'],
  ['/help', 'This list.'],
];

const ADMIN_HELP: Array<[string, string]> = [
  ['/announce', 'Post an announcement.'],
  ['/pending', 'Pending requests, with Approve, Decline, and Alter.'],
  ['/nowplaying', 'Current Plex and Jellyfin streams.'],
  ['/disk', 'Disk use from Beszel.'],
  ['/restart', 'Restart an allowlisted container. Admin channel only, with a confirm button.'],
  ['/unlink', "Remove another member's link."],
];

export async function handleMemberCommand(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<boolean> {
  switch (interaction.commandName) {
    case 'check':
      await checkRequests(interaction, ctx);
      return true;
    case 'search':
      await search(interaction, ctx);
      return true;
    case 'link':
      await links(interaction, ctx);
      return true;
    case 'status':
      await status(interaction, ctx);
      return true;
    case 'report':
      await openReport(interaction, ctx);
      return true;
    case 'new':
      await recent(interaction, ctx);
      return true;
    case 'random':
      await randomPick(interaction, ctx);
      return true;
    case 'watchlist':
      await watchlist(interaction, ctx);
      return true;
    case 'upcoming':
      await upcoming(interaction, ctx);
      return true;
    case 'stats':
      await stats(interaction, ctx);
      return true;
    case 'help':
      await help(interaction, ctx);
      return true;
    default:
      return false;
  }
}

export async function handleMemberComponent(interaction: Interaction, ctx: AppContext): Promise<boolean> {
  if (interaction.isModalSubmit() && interaction.customId === 'report:modal') {
    await submitReport(interaction, ctx);
    return true;
  }
  if (interaction.isStringSelectMenu() && interaction.customId.startsWith('report:pick:')) {
    await pickReport(interaction, ctx);
    return true;
  }
  if (interaction.isButton() && interaction.customId.startsWith('report:')) {
    await decideReport(interaction, ctx);
    return true;
  }
  return false;
}

async function checkRequests(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  const gate = accountGate(ctx, interaction.user.id);
  if (!gate.ok) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: gate.message });
    return;
  }
  const query = interaction.options.getString('title')?.trim();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    // shortcut: title filter only sees the 10 newest requests, so older matches stay hidden.
    const listed = await ctx.seerr.listUserRequests(gate.link.seerrUserId, 10);
    if (listed.length === 0) {
      await interaction.editReply("You haven't requested anything yet, use /request");
      return;
    }
    const titled = await withTitles(ctx, listed);
    const shown = titled.filter((request) => requestMatches(request.title ?? '', query));
    if (shown.length === 0) {
      await interaction.editReply(`No requests matched "${query}".`);
      return;
    }
    const embed = new EmbedBuilder()
      .setColor(BLURPLE)
      .setTitle('Your requests')
      .setDescription(shown.map((request) => formatRequestLine({
        title: request.title ?? 'Unknown title',
        year: request.year,
        mediaType: request.mediaType,
        requestedAt: request.createdAt,
        requestStatus: request.requestStatus,
        mediaStatus: request.mediaStatus,
      })).join('\n').slice(0, 4000));
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await interaction.editReply(failureText(error, 'Could not load your requests.'));
  }
}

async function search(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  const query = interaction.options.getString('query', true).trim();
  if (!query) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Enter something to search for.' });
    return;
  }
  await showSearch(interaction, ctx, query, 'request');
}

async function links(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  const found = collectLinks({
    jellyfin: ctx.env.JELLYFIN_PUBLIC_URL,
    plex: ctx.env.PLEX_PUBLIC_URL,
    seerr: ctx.env.SEERR_PUBLIC_URL,
    status: ctx.env.STATUS_PAGE_URL,
    extra: ctx.env.LINKS_EXTRA,
  });
  if (found.length === 0) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'No service links are configured.' });
    return;
  }
  const embed = new EmbedBuilder()
    .setColor(BLURPLE)
    .setTitle('Links')
    .setDescription(found.map((link) => `[${link.name}](${link.url})`).join('\n'));
  await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed] });
}

async function status(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (!ctx.env.UPTIME_KUMA_URL || !ctx.env.UPTIME_KUMA_STATUS_SLUG) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Uptime Kuma is not configured.' });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const base = ctx.env.UPTIME_KUMA_URL.replace(/\/+$/, '');
    const slug = encodeURIComponent(ctx.env.UPTIME_KUMA_STATUS_SLUG);
    const [page, beats] = await Promise.all([
      requestJson(fetch, `${base}/api/status-page/${slug}`),
      requestJson(fetch, `${base}/api/status-page/heartbeat/${slug}`),
    ]);
    if (page.status !== 200 || beats.status !== 200) throw new Error('Could not load the status page.');
    const monitors = parseStatusPage(page.body, beats.body);
    if (monitors.length === 0) {
      await interaction.editReply('The status page has no public monitors.');
      return;
    }
    const embed = new EmbedBuilder()
      .setColor(BLURPLE)
      .setTitle('Status')
      .setDescription(monitors.map(formatMonitor).join('\n').slice(0, 4000));
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await interaction.editReply(failureText(error, 'Could not load the status page.'));
  }
}

async function openReport(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  const gate = accountGate(ctx, interaction.user.id);
  if (!gate.ok) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: gate.message });
    return;
  }
  await interaction.showModal(reportModal());
}

async function recent(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  const days = interaction.options.getInteger('days') ?? 7;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const items = await collectNew(ctx.env, ctx.seerr, days);
    if (items.length === 0) {
      await interaction.editReply(`Nothing new in the last ${days} days.`);
      return;
    }
    await interaction.editReply({
      content: jellyfinConfigured(ctx.env) ? `Added in the last ${days} days.` : `Added in the last ${days} days, from Seerr.`,
      embeds: items.slice(0, 8).map(newEmbed),
    });
  } catch (error) {
    await interaction.editReply(failureText(error, 'Could not load recent media.'));
  }
}

async function randomPick(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (!jellyfinConfigured(ctx.env)) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Jellyfin is not configured.' });
    return;
  }
  const typeName = interaction.options.getString('type');
  const type = typeName === 'movie' || typeName === 'tv' ? typeName : undefined;
  const genre = interaction.options.getString('genre')?.trim();
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const item = await new JellyfinClient(ctx.env.JELLYFIN_URL, ctx.env.JELLYFIN_API_KEY).random(type, genre);
    if (!item) {
      await interaction.editReply(genre ? 'Nothing matched that genre.' : 'The library looks empty.');
      return;
    }
    let posterPath: string | undefined;
    if (item.tmdbId) {
      try {
        const details = item.kind === 'movie' ? await ctx.seerr.getMovie(item.tmdbId) : await ctx.seerr.getTv(item.tmdbId);
        posterPath = details.posterPath;
      } catch {
        posterPath = undefined;
      }
    }
    const embed = new EmbedBuilder()
      .setColor(BLURPLE)
      .setTitle(`${item.title}${item.year ? ` (${item.year})` : ''}`)
      .setDescription(item.overview ? item.overview.slice(0, 300) : item.kind === 'movie' ? 'Movie' : 'TV');
    const poster = posterUrl(posterPath, 'w342');
    if (poster) embed.setThumbnail(poster);
    if (ctx.env.JELLYFIN_PUBLIC_URL) {
      embed.setURL(`${ctx.env.JELLYFIN_PUBLIC_URL.replace(/\/+$/, '')}/web/index.html#!/details?id=${item.id}`);
    }
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await interaction.editReply(failureText(error, 'Could not pick something from Jellyfin.'));
  }
}

async function watchlist(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  const gate = accountGate(ctx, interaction.user.id);
  if (!gate.ok) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: gate.message });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const hits = (await ctx.seerr.watchlist(gate.link.seerrUserId, 5)).slice(0, 5);
    if (hits.length === 0) {
      await interaction.editReply('Your Seerr watchlist is empty.');
      return;
    }
    const view = resultViews(hits, 'request');
    await interaction.editReply({ content: 'Your watchlist.', embeds: view.embeds, components: view.components });
  } catch (error) {
    await interaction.editReply(failureText(error, 'Could not load your watchlist.'));
  }
}

async function upcoming(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (!sonarrConfigured(ctx.env) || !ctx.env.SONARR_URL || !ctx.env.SONARR_API_KEY) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Sonarr is not configured.' });
    return;
  }
  const gate = accountGate(ctx, interaction.user.id);
  if (!gate.ok) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: gate.message });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    // shortcut: only the 50 newest requests are matched against the Sonarr calendar.
    const requests = await ctx.seerr.listUserRequests(gate.link.seerrUserId, 50);
    const tv = requests.filter((request) => request.mediaType === 'tv' && request.requestStatus !== 'declined');
    const start = dubaiDate(new Date());
    const end = dubaiDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    const episodes = await new SonarrClient(ctx.env.SONARR_URL, ctx.env.SONARR_API_KEY).calendar(start, end);
    const mine = filterUpcoming(episodes, {
      tmdbIds: tv.flatMap((request) => (request.tmdbId ? [request.tmdbId] : [])),
      tvdbIds: tv.flatMap((request) => (request.tvdbId ? [request.tvdbId] : [])),
    });
    if (mine.length === 0) {
      await interaction.editReply('Nothing you requested airs in the next 7 days.');
      return;
    }
    const lines = mine.slice(0, 20).map((episode) => {
      const code =
        episode.season !== undefined && episode.episode !== undefined ? ` S${episode.season}E${episode.episode}` : '';
      const when = episode.airsAt ? ` · ${formatAir(episode.airsAt)}` : '';
      return `📺 ${episode.show}${code}${episode.title ? ` — ${episode.title}` : ''}${when}`;
    });
    await interaction.editReply({
      embeds: [new EmbedBuilder().setColor(BLURPLE).setTitle('Upcoming').setDescription(lines.join('\n').slice(0, 4000))],
    });
  } catch (error) {
    await interaction.editReply(failureText(error, 'Could not load the Sonarr calendar.'));
  }
}

async function stats(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  if (!tautulliConfigured(ctx.env) || !ctx.env.TAUTULLI_URL || !ctx.env.TAUTULLI_API_KEY) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Tautulli is not configured. It only covers Plex.' });
    return;
  }
  const gate = accountGate(ctx, interaction.user.id);
  if (!gate.ok) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: gate.message });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const client = new TautulliClient(ctx.env.TAUTULLI_URL, ctx.env.TAUTULLI_API_KEY);
    const names = mediaUsernames(await ctx.seerr.getUser(gate.link.seerrUserId));
    if (!names.plex) {
      await interaction.editReply('This Seerr account has no Plex username. Tautulli only covers Plex.');
      return;
    }
    const user = matchTautulliUser(await client.users(), names.plex);
    if (!user) {
      await interaction.editReply(`No Tautulli user matches "${names.plex}". Tautulli only covers Plex.`);
      return;
    }
    const [watch, history] = await Promise.all([client.watchStats(user.id), client.history(user.id, 5)]);
    const lines = watch
      .filter((row) => row.days === 0 || row.days === 30)
      .map((row) => `${row.days === 0 ? 'All time' : 'Last 30 days'}: ${row.plays} plays, ${formatHours(row.seconds)}`);
    const recent = history.map((item) => `• ${item.title}`);
    const embed = new EmbedBuilder()
      .setColor(BLURPLE)
      .setTitle(`Stats for ${names.plex}`)
      .setDescription([...lines, recent.length ? `\nRecent\n${recent.join('\n')}` : ''].filter(Boolean).join('\n').slice(0, 4000) || 'Tautulli returned no watch stats.');
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    await interaction.editReply(failureText(error, 'Could not load Tautulli stats.'));
  }
}

async function help(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void> {
  const lines = MEMBER_HELP.map(([command, text]) => `**${command}** — ${text}`);
  if (canManage(interaction, ctx.env.ADMIN_ROLE_ID)) {
    lines.push('', '**Admin**', ...ADMIN_HELP.map(([command, text]) => `**${command}** — ${text}`));
  }
  const embed = new EmbedBuilder().setColor(BLURPLE).setTitle('Commands').setDescription(lines.join('\n').slice(0, 4000));
  await interaction.reply({ flags: MessageFlags.Ephemeral, embeds: [embed] });
}

function reportModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId('report:modal')
    .setTitle('Report a problem')
    .addLabelComponents(
      new LabelBuilder().setLabel('Title').setTextInputComponent(
        new TextInputBuilder().setCustomId('title').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200),
      ),
      new LabelBuilder().setLabel('Problem').setStringSelectMenuComponent(
        new StringSelectMenuBuilder()
          .setCustomId('problem')
          .setPlaceholder('What kind of problem?')
          .setRequired(true)
          .addOptions(
            { label: 'Video', value: 'video' },
            { label: 'Audio', value: 'audio' },
            { label: 'Subtitles', value: 'subtitles' },
            { label: 'Missing episode', value: 'missing' },
            { label: 'Other', value: 'other' },
          ),
      ),
      new LabelBuilder().setLabel('Description').setTextInputComponent(
        new TextInputBuilder().setCustomId('description').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000),
      ),
    );
}

async function submitReport(interaction: ModalSubmitInteraction, ctx: AppContext): Promise<void> {
  const gate = accountGate(ctx, interaction.user.id);
  if (!gate.ok) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: gate.message });
    return;
  }
  const title = interaction.fields.getTextInputValue('title').trim();
  const problem = parseProblem(interaction.fields.getStringSelectValues('problem')[0]);
  const description = interaction.fields.getTextInputValue('description').trim();
  if (!title || !problem || !description) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'Title, problem, and description are required.' });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const hits = (await ctx.seerr.search(title)).slice(0, 5);
    const candidates = await reportCandidates(ctx, hits);
    const choice = chooseReportTarget(candidates, title);
    if (choice.action === 'choose') {
      const menu = new StringSelectMenuBuilder()
        .setCustomId(`report:pick:${problem}`)
        .setPlaceholder('Which title is this about?')
        .addOptions(
          choice.candidates.slice(0, 5).map((candidate) => ({
            label: `${candidate.title}${candidate.year ? ` (${candidate.year})` : ''}`.slice(0, 100),
            description: candidate.mediaType === 'movie' ? 'Movie' : 'TV',
            value: `${candidate.mediaType}:${candidate.tmdbId}:${candidate.seerrMediaId}`,
          })),
        );
      await interaction.editReply({
        embeds: [reportDraft(problem, description)],
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
      });
      return;
    }
    const target = choice.action === 'use' ? choice.candidate : undefined;
    await publishReport(interaction, ctx, { title: target?.title ?? title, problem, description, target });
  } catch (error) {
    await interaction.editReply(failureText(error, 'Could not file that report.'));
  }
}

async function pickReport(interaction: StringSelectMenuInteraction, ctx: AppContext): Promise<void> {
  const gate = accountGate(ctx, interaction.user.id);
  if (!gate.ok) {
    await interaction.update({ content: gate.message, embeds: [], components: [] });
    return;
  }
  const parsed = /^(movie|tv):(\d+):(\d+)$/.exec(interaction.values[0] ?? '');
  const problem = parseProblem(/^report:pick:(.+)$/.exec(interaction.customId)?.[1]);
  const description = interaction.message.embeds[0]?.description?.trim();
  if (!parsed || !problem || !description) {
    await interaction.update({ content: 'That report is out of date. Run /report again.', embeds: [], components: [] });
    return;
  }
  await interaction.deferUpdate();
  const option = interaction.component.options.find((item) => item.value === interaction.values[0]);
  await publishReport(interaction, ctx, {
    title: option?.label ?? 'Reported title',
    problem,
    description,
    target: {
      mediaType: parsed[1] as 'movie' | 'tv',
      tmdbId: Number(parsed[2]),
      title: option?.label ?? 'Reported title',
      seerrMediaId: Number(parsed[3]),
      onServer: true,
    },
  });
}

async function publishReport(
  interaction: ModalSubmitInteraction | StringSelectMenuInteraction,
  ctx: AppContext,
  input: { title: string; problem: ReturnType<typeof parseProblem> & string; description: string; target?: ReportCandidate },
): Promise<void> {
  let issueId = 0;
  let issueNote = 'No Seerr issue was opened because this is not in the library.';
  if (input.target?.seerrMediaId) {
    try {
      issueId = await ctx.seerr.createIssue(
        buildIssue({
          problem: input.problem,
          description: input.description,
          mediaId: input.target.seerrMediaId,
          reporter: interaction.user.tag,
        }),
      );
      issueNote = `Seerr issue #${issueId}`;
    } catch (error) {
      issueNote = `Seerr issue was not opened: ${failureText(error, 'request failed')}`;
    }
  }
  const embed = new EmbedBuilder()
    .setColor(YELLOW)
    .setTitle(input.title)
    .addFields(
      { name: 'Problem', value: problemLabel(input.problem), inline: true },
      { name: 'From', value: `${interaction.user} (${interaction.user.tag})`, inline: true },
      { name: 'Description', value: input.description.slice(0, 1000) },
      { name: 'Seerr', value: issueNote },
    );
  const channel = await ctx.client.channels.fetch(ctx.env.ADMIN_CHANNEL_ID);
  if (!channel?.isSendable()) {
    await interaction.editReply('Could not reach the admin channel.');
    return;
  }
  await channel.send({
    embeds: [embed],
    components: [reportButtons(issueId, interaction.user.id)],
    allowedMentions: { users: [interaction.user.id] },
  });
  await interaction.editReply({
    content: issueId ? 'Reported to the admins, and a Seerr issue was opened.' : `Reported to the admins. ${issueNote}`,
    embeds: [],
    components: [],
  });
}

async function decideReport(interaction: ButtonInteraction, ctx: AppContext): Promise<void> {
  const parsed = /^report:(resolved|dismiss):(\d+)(?::(\d+))?$/.exec(interaction.customId);
  if (!parsed) return;
  if (!canManage(interaction, ctx.env.ADMIN_ROLE_ID)) {
    await interaction.reply({ flags: MessageFlags.Ephemeral, content: 'You do not have permission to handle reports.' });
    return;
  }
  const action = parsed[1];
  const issueOrUser = parsed[2];
  const reporterId = action === 'resolved' ? parsed[3] : issueOrUser;
  const issueId = action === 'resolved' ? Number(issueOrUser) : 0;
  if (!reporterId) return;
  await interaction.deferUpdate();
  try {
    if (action === 'resolved' && issueId > 0) await ctx.seerr.resolveIssue(issueId);
    if (action === 'resolved') {
      const title = interaction.message.embeds[0]?.title ?? 'your report';
      await dm(ctx, reporterId, `Your report about ${title} was marked resolved.`);
    }
    const embed = EmbedBuilder.from(interaction.message.embeds[0] ?? new EmbedBuilder().setTitle('Report'))
      .setColor(action === 'resolved' ? GREEN : RED)
      .setFooter({ text: `${action === 'resolved' ? 'Resolved' : 'Dismissed'} by ${interaction.user.tag}` });
    await interaction.editReply({ embeds: [embed], components: [] });
  } catch (error) {
    await interaction.followUp({ flags: MessageFlags.Ephemeral, content: failureText(error, 'Could not update that report.') });
  }
}

function reportButtons(issueId: number, discordId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`report:resolved:${issueId}:${discordId}`).setLabel('Resolved').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`report:dismiss:${discordId}`).setLabel('Dismiss').setStyle(ButtonStyle.Secondary),
  );
}

function reportDraft(problem: NonNullable<ReturnType<typeof parseProblem>>, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(YELLOW)
    .setTitle('Which title?')
    .setDescription(description.slice(0, 1000))
    .addFields({ name: 'Problem', value: problemLabel(problem) });
}

async function reportCandidates(
  ctx: AppContext,
  hits: Array<{ mediaType: 'movie' | 'tv'; mediaId: number; title: string; year?: number }>,
): Promise<ReportCandidate[]> {
  const candidates: ReportCandidate[] = [];
  for (const hit of hits) {
    try {
      const details = hit.mediaType === 'movie' ? await ctx.seerr.getMovie(hit.mediaId) : await ctx.seerr.getTv(hit.mediaId);
      candidates.push({
        mediaType: hit.mediaType,
        tmdbId: hit.mediaId,
        title: details.title,
        year: details.year,
        seerrMediaId: details.seerrMediaId,
        onServer: details.availability === 'available' && Boolean(details.seerrMediaId),
      });
    } catch {
      candidates.push({ mediaType: hit.mediaType, tmdbId: hit.mediaId, title: hit.title, year: hit.year, onServer: false });
    }
  }
  return candidates;
}

async function withTitles(ctx: AppContext, requests: UserRequest[]): Promise<UserRequest[]> {
  const cache = new Map<string, { title: string; year?: number }>();
  let lookups = 0;
  const out: UserRequest[] = [];
  for (const request of requests) {
    if (request.title || !request.mediaType || !request.tmdbId || lookups >= 10) {
      out.push(request);
      continue;
    }
    const key = `${request.mediaType}:${request.tmdbId}`;
    const cached = cache.get(key);
    if (cached) {
      out.push({ ...request, ...cached });
      continue;
    }
    lookups += 1;
    try {
      const details = request.mediaType === 'movie' ? await ctx.seerr.getMovie(request.tmdbId) : await ctx.seerr.getTv(request.tmdbId);
      const found = { title: details.title, year: details.year };
      cache.set(key, found);
      out.push({ ...request, ...found });
    } catch {
      out.push(request);
    }
  }
  return out;
}

function dubaiDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: DUBAI, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function formatAir(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-GB', { timeZone: DUBAI, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(date);
}

function formatHours(seconds: number): string {
  const hours = seconds / 3600;
  return hours >= 10 ? `${Math.round(hours)} hours` : `${hours.toFixed(1)} hours`;
}

const YELLOW = 0xfee75c;
