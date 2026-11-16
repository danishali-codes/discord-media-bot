import { REST, Routes } from 'discord.js';
import { slashCommandBody } from './commands';
import { loadEnv } from './env';

async function main(): Promise<void> {
  const env = loadEnv();
  const rest = new REST({ version: '10' }).setToken(env.DISCORD_TOKEN);
  const body = slashCommandBody();
  await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID), { body });
  console.log(`Registered ${body.length} commands in guild ${env.DISCORD_GUILD_ID}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
