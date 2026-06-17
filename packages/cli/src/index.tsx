import React from 'react';
import { render } from 'ink';
import meow from 'meow';
import { fileURLToPath } from 'node:url';
import { runCli as runDomainCli } from '@ekairos/domain/cli';
import App from './app.js';
import {
	getPlatformAccessToken,
	resolvePlatformUrl,
	signInToPlatform,
	signOutFromPlatform,
} from './lib/platform-auth.js';
import { runPlatformDomainCommand } from './lib/platform-domain-run.js';
import { createSession, loadSession, processAsyncStep } from './lib/session.js';
import { checkShadcnConfig, ensureEkairosRegistry, installComponent } from './lib/shadcn.js';

const VALID_ACTIONS = new Set(['init-shadcn', 'update-all', 'install-essentials', 'exit']);
const CLI_SKILL_PATH = fileURLToPath(new URL('../SKILL.md', import.meta.url));
const DOMAIN_SKILL_PATH = fileURLToPath(new URL('../../domain/SKILL.md', import.meta.url));
const rawArgv = process.argv.slice(2);

const cli = meow(
	`
	Usage
	  $ ekairos
	  $ ekairos login
	  $ ekairos whoami
	  $ ekairos create-app --demo
	  $ ekairos create-app <dir> --next --install --smoke --json
	  $ ekairos domain query "<json5>" --baseUrl=<url> --admin
	  $ ekairos dataset <command> [options]

	Skills
	  CLI skill:    ${CLI_SKILL_PATH}
	  Domain skill: ${DOMAIN_SKILL_PATH}

	Options
		--async    Run in async/session mode
		--session  Session ID for continuing an async session
		--input    JSON input for the session step
		--action   Convenience flag for async actions (update-all, install-essentials, init-shadcn, exit)
		--platform Platform URL override. Defaults to production.
		--app      Platform application id for ekairos domain ...
		--env      Runtime env override as a JSON object for ekairos domain ...
		--no-open  Print OAuth URL instead of opening a browser
		--dry-run  Validate OAuth discovery/registration without completing login

	Examples
	  $ ekairos --async
	  $ ekairos login
	  $ ekairos whoami --json
	  $ ekairos create-app --demo
	  $ ekairos create-app ./supply-chain --next --install --smoke --json
	  $ ekairos domain query "{ procurement_order: { supplier: {} } }" --baseUrl=http://localhost:3000 --admin
	  $ ekairos domain query "{ task_tasks: {} }" --app=<appId>
	  $ ekairos domain query "{ task_tasks: {} }" --app=<appId> --env='{"orgId":"org_..."}'
	  $ ekairos --session <uuid> --input '{"action": "update-all"}'
	  $ ekairos dataset create --rows-file rows.jsonl --app-id <id> --admin-token <token>
`,
	{
		importMeta: import.meta,
		flags: {
			async: {
				type: 'boolean',
			},
			session: {
				type: 'string',
			},
			input: {
				type: 'string',
			},
			action: {
				type: 'string',
			},
			dev: {
				type: 'boolean',
				default: false,
			},
			platform: {
				type: 'string',
			},
			app: {
				type: 'string',
			},
			env: {
				type: 'string',
			},
			pretty: {
				type: 'boolean',
				default: false,
			},
			noOpen: {
				type: 'boolean',
				default: false,
			},
			dryRun: {
				type: 'boolean',
				default: false,
			},
			json: {
				type: 'boolean',
				default: false,
			},
		},
	},
);

const [command, ...commandArgs] = cli.input;

async function runAddCommand(componentTarget?: string) {
	if (!componentTarget) {
		console.error('Please specify a component, e.g. ekairos add @ekairos/agent');
		process.exit(1);
	}

	const hasConfig = await checkShadcnConfig();
	if (!hasConfig) {
		console.error('components.json not found. Run "shadcn init" first.');
		process.exit(1);
	}

	try {
		await ensureEkairosRegistry();
		await installComponent(componentTarget);
		console.log(`✔ Installed ${componentTarget}`);
		process.exit(0);
	} catch (error) {
		console.error(error instanceof Error ? error.message : 'Installation failed');
		process.exit(1);
	}
}

async function run() {
	if (cli.flags.dev) {
		process.env.EKAIROS_REGISTRY_URL = 'http://localhost:3030/';
		console.log('Using local registry: http://localhost:3030/');
	}

	if (command === 'login') {
		const result = await signInToPlatform({
			dryRun: cli.flags.dryRun,
			noOpen: cli.flags.noOpen,
			platformUrl: cli.flags.platform,
		});
		if (cli.flags.dryRun || cli.flags.json) {
			console.log(JSON.stringify({ ok: true, ...result }, null, 2));
			return;
		}
		const user = 'user' in result ? result.user : undefined;
		console.log(`Signed in to ${resolvePlatformUrl(cli.flags.platform)} as ${user?.email ?? user?.id ?? 'unknown user'}.`);
		return;
	}

	if (command === 'whoami') {
		const platformUrl = resolvePlatformUrl(cli.flags.platform);
		const credentials = await getPlatformAccessToken(platformUrl);
		if (!credentials) {
			console.error(`Not signed in to ${platformUrl}. Run: ekairos login${cli.flags.platform ? ` --platform=${platformUrl}` : ''}`);
			process.exit(1);
		}
		if (cli.flags.json) {
			console.log(JSON.stringify({ ok: true, platformUrl, user: credentials.user }, null, 2));
			return;
		}
		console.log(`${credentials.user?.email ?? credentials.user?.id ?? 'unknown user'} @ ${platformUrl}`);
		return;
	}

	if (command === 'logout') {
		const platformUrl = resolvePlatformUrl(cli.flags.platform);
		await signOutFromPlatform(platformUrl);
		console.log(`Signed out from ${platformUrl}.`);
		return;
	}

	if (command === 'token') {
		const platformUrl = resolvePlatformUrl(cli.flags.platform);
		const credentials = await getPlatformAccessToken(platformUrl);
		if (!credentials) {
			console.error(`Not signed in to ${platformUrl}. Run: ekairos login${cli.flags.platform ? ` --platform=${platformUrl}` : ''}`);
			process.exit(1);
		}
		console.log(credentials.accessToken);
		return;
	}

	if (command === 'add') {
		await runAddCommand(commandArgs[0]);
		return;
	}

	if (command === 'create-app') {
		const code = await runDomainCli(['create-app', ...rawArgv.slice(1)]);
		process.exit(code);
	}

	if (command === 'domain') {
		if (commandArgs[0] === 'create-app') {
			console.error('Use `ekairos create-app ...` for app creation.');
			process.exit(1);
		}
		if (cli.flags.platform || cli.flags.app) {
			const code = await runPlatformDomainCommand(commandArgs, {
				app: cli.flags.app,
				env: cli.flags.env,
				platformUrl: cli.flags.platform,
				pretty: cli.flags.pretty || cli.flags.json,
			});
			process.exit(code);
		}
		const code = await runDomainCli(rawArgv.slice(1));
		process.exit(code);
	}

	if (command === 'dataset') {
		const { runDatasetCommand } = await import('./lib/dataset.js');
		await runDatasetCommand(commandArgs);
		return;
	}

	if (cli.flags.async || cli.flags.session) {
		try {
			let state;
			let input = null;

			const tryParseActionString = (value: string | undefined) => {
				if (!value) return null;
				const trimmed = value.trim();
				return VALID_ACTIONS.has(trimmed) ? { action: trimmed } : null;
			};

			if (cli.flags.input) {
				try {
					input = JSON.parse(cli.flags.input);
				} catch (e) {
					input = tryParseActionString(cli.flags.input);
					if (!input) {
						console.error(JSON.stringify({ error: 'Invalid JSON input' }));
						process.exit(1);
					}
				}
			}

			if (!input && cli.flags.action) {
				const parsed = tryParseActionString(cli.flags.action);
				if (!parsed) {
					console.error(JSON.stringify({ error: 'Invalid action value' }));
					process.exit(1);
				}
				input = parsed;
			}

			if (cli.flags.session) {
				state = await loadSession(cli.flags.session);
				if (!state) {
					console.error(JSON.stringify({ error: 'Session not found or expired' }));
					process.exit(1);
				}
			} else {
				// New session
				state = await createSession();
			}

			const response = await processAsyncStep(state!, input);
			console.log(JSON.stringify(response, null, 2));
			process.exit(0);

		} catch (error) {
			console.error(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }));
			process.exit(1);
		}
	} else {
		// Interactive Mode
		render(<App />);
	}
}

run();
