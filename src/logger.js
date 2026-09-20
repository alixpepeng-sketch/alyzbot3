import pino from 'pino';
import { config } from './config.js';

export const log = pino({ level: 'info' });
export const baileysLogger = pino({ level: config.logLevel });
