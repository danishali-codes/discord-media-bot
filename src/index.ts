import { Client, GatewayIntentBits } from 'discord.js';
import { openDatabase } from './db';
import { loadEnv } from './env';
import { registerHandlers } from './interactions';
import { startJobs } from './jobs';
import { SeerrClient } from './seerr';
import { startWebhook } from './webhook';

async function main(): Promise<void> {
  const env = loadEnv();
  const db = openDatabase('data/bot.sqlite');
  const seerr = new SeerrClient({ baseUrl: env.SEERR_URL, apiKey: env.SEERR_API_KEY });
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  });
  const ctx = { env, db, seerr, client };

  registerHandlers(client, ctx);
  client.once('clientReady', () => {
    console.log(`Logged in as ${client.user?.tag}`);
  });
  client.on('error', (error) => {
    console.error('discord error', error);
  });

  await client.login(env.DISCORD_TOKEN);
  const server = startWebhook(ctx);
  startJobs(ctx);

  const stop = (): void => {
    server.close();
    client.destroy();
    db.close();
    process.exit(0);
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
