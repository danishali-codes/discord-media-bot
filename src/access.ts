import { PermissionFlagsBits, type ButtonInteraction, type ChatInputCommandInteraction, type ModalSubmitInteraction, type StringSelectMenuInteraction } from 'discord.js';
import type { AppContext } from './context';
import type { LinkRecord } from './db';
import { SeerrRequestError } from './seerr';

export type Manageable = ButtonInteraction | ChatInputCommandInteraction | ModalSubmitInteraction | StringSelectMenuInteraction;

export function accountGate(
  ctx: AppContext,
  discordId: string,
): { ok: true; link: LinkRecord } | { ok: false; message: string } {
  const link = ctx.db.getByDiscord(discordId);
  if (link) return { ok: true, link };
  if (ctx.db.getPendingByDiscord(discordId)) return { ok: false, message: 'Your link is awaiting approval.' };
  return { ok: false, message: 'Link your Jellyfin or Plex account first with /link-account.' };
}

export function canManage(interaction: Manageable, adminRoleId: string | undefined): boolean {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  if (!adminRoleId || !interaction.member) return false;
  const roles = interaction.member.roles;
  if (Array.isArray(roles)) return roles.includes(adminRoleId);
  return roles.cache.has(adminRoleId);
}

export function failureText(error: unknown, fallback: string): string {
  if ((error instanceof SeerrRequestError || error instanceof Error) && error.message) return error.message;
  return fallback;
}

export async function dm(ctx: AppContext, discordId: string, content: string): Promise<void> {
  try {
    const user = await ctx.client.users.fetch(discordId);
    await user.send(content);
  } catch {
    console.warn('DM failed', discordId);
  }
}
