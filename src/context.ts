import type { Client } from 'discord.js';
import type { LinkStore } from './db';
import type { Env } from './env';
import type { SeerrClient } from './seerr';

export type AppContext = {
  env: Env;
  db: LinkStore;
  seerr: SeerrClient;
  client: Client;
};
