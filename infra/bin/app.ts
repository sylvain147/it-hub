#!/usr/bin/env node
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { App } from 'aws-cdk-lib';
import { HubStack } from '../lib/hub-stack.js';
import { GithubOidcStack } from '../lib/github-oidc-stack.js';

const app = new App();
const ctx = (k: string, fallback: string) => String(app.node.tryGetContext(k) ?? fallback);
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: ctx('region', process.env.CDK_DEFAULT_REGION ?? 'eu-west-3') };
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

new HubStack(app, 'HubIt', {
  env,
  description: 'Hobbit – générateur de cahiers des charges et futurs modules',
  repoRoot,
  llmProvider: ctx('llmProvider', 'bedrock') === 'mock' ? 'mock' : 'bedrock',
  bedrockRegion: ctx('bedrockRegion', env.region),
  bedrockApi: ctx('bedrockApi', 'runtime') === 'mantle' ? 'mantle' : 'runtime',
  modelFast: ctx('modelFast', 'anthropic.claude-haiku-5-5'),
  modelSmart: ctx('modelSmart', 'anthropic.claude-sonnet-5-5'),
  monthlyBudgetUsd: Number(ctx('monthlyBudgetUsd', '30')),
  mailFrom: ctx('mailFrom', ''),
});

new GithubOidcStack(app, 'HubItGithubOidc', {
  env,
  repository: ctx('githubRepository', 'sylvain147/it-hub'),
  branch: ctx('githubBranch', 'main'),
});
