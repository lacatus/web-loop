import { config } from '../config';
import { createDb } from './client';

createDb(config.databaseUrl);
console.log(`Migrations applied to ${config.databaseUrl}`);
