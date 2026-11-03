/** Point d'entrée Lambda de l'API (derrière API Gateway HTTP API + autorisateur Cognito). */
import { handle } from 'hono/aws-lambda';
import { createApp } from './app.js';

export const handler = handle(createApp());
