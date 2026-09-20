import { startServer } from './src/server.js';
import { startBot } from './src/bot.js';
import { log } from './src/logger.js';

process.on('unhandledRejection', (err) => log.error({ err }, 'unhandledRejection'));
process.on('uncaughtException', (err) => log.error({ err }, 'uncaughtException'));
process.on('SIGTERM', () => process.exit(0));

startServer();
startBot();
