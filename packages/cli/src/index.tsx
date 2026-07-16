import meow from 'meow';
import { fileURLToPath } from 'node:url';
import {
	getPlatformAccessToken,
	resolvePlatformUrl,
	signInToPlatform,
	signOutFromPlatform,
} from './lib/platform-auth.js';
import { runPlatformDomainCommand } from './lib/platform-domain-run.js';
import { readCliDefaults, writeCliDefaults } from './lib/defaults.js';

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
	  $ ekairos use --app=<appId> [--env=<key>]
	  $ ekairos apps [--project=<key>] [--refresh]
	  $ ekairos completion powershell|bash|zsh
	  $ ekairos create-app --demo
	  $ ekairos create-app <dir> --next --install --smoke --json
	  $ ekairos domain <operation> [--app=<appId>] [--env=<key>]
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
		--app      Platform application id for ekairos domain ... (required)
		--env      Runtime environment key for ekairos domain ...
		--env-data Runtime env override as a JSON object for ekairos domain ...
		--data     JSON data for commands such as domain env register
		--title    Human title for commands such as domain env register
		--no-open  Print OAuth URL instead of opening a browser
		--dry-run  Validate OAuth discovery/registration without completing login

	Examples
	  $ ekairos --async
	  $ ekairos login
	  $ ekairos whoami --json
	  $ ekairos use --app=esolbay-platform --env=disal-development
	  $ ekairos domain query "{ accounting_documents: { $: { limit: 5 } } }"
	  $ ekairos create-app --demo
	  $ ekairos create-app ./supply-chain --next --install --smoke --json
	  $ ekairos domain introspect --app=<appId>
	  $ ekairos domain query "{ task_tasks: {} }" --app=<appId>
	  $ ekairos domain env list --app=<appId>
	  $ ekairos domain env register --app=<appId> --env=disal-demo --data='{"orgId":"org_..."}'
	  $ ekairos domain query "{ task_tasks: {} }" --app=<appId> --env=disal-demo
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
			envData: {
				type: 'string',
			},
			data: {
				type: 'string',
			},
			title: {
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
			refresh: {
				type: 'boolean',
				default: false,
			},
			project: {
				type: 'string',
			},
			line: {
				type: 'string',
			},
			word: {
				type: 'string',
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

	const { checkShadcnConfig, ensureEkairosRegistry, installComponent } = await import(
		'./lib/shadcn.js'
	);
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

	if (command === 'complete') {
		const { runCompleteCommand } = await import('./lib/completions.js');
		await runCompleteCommand(rawArgv.slice(1));
		return;
	}

	if (command === 'completion') {
		const { completionScript } = await import('./lib/completions.js');
		console.log(completionScript(commandArgs[0] ?? 'powershell'));
		return;
	}

	if (command === 'apps') {
		const { loadPlatformDirectory, refreshPlatformDirectory } = await import(
			'./lib/platform-directory.js'
		);
		const directory = cli.flags.refresh
			? await refreshPlatformDirectory(cli.flags.platform)
			: await loadPlatformDirectory({ platformUrl: cli.flags.platform });
		if (!directory) {
			console.error('Not signed in or platform unreachable. Run: ekairos login');
			process.exit(1);
		}
		const projectFilter = (cli.flags.project ?? '').trim();
		const applications = directory.applications.filter(
			(app) => !projectFilter || app.project === projectFilter,
		);
		if (cli.flags.json) {
			console.log(JSON.stringify({ ok: true, applications }, null, 2));
			return;
		}
		const byProject = new Map<string, typeof applications>();
		for (const app of applications) {
			const key = app.project ?? '(sin proyecto)';
			byProject.set(key, [...(byProject.get(key) ?? []), app]);
		}
		for (const [project, apps] of byProject) {
			console.log(`${project}`);
			for (const app of apps) {
				console.log(`  ${app.appId}  (${app.title})`);
				for (const environment of app.environments) {
					console.log(`    env: ${environment.key}`);
				}
			}
		}
		return;
	}

	if (command === 'use') {
		const hasUpdates =
			cli.flags.app !== undefined ||
			cli.flags.env !== undefined ||
			cli.flags.platform !== undefined;
		if (hasUpdates) {
			const { file, defaults } = await writeCliDefaults({
				app: cli.flags.app,
				env: cli.flags.env,
				platform: cli.flags.platform,
			});
			console.log(JSON.stringify({ ok: true, file, defaults }, null, 2));
			return;
		}
		const defaults = await readCliDefaults();
		console.log(JSON.stringify({ ok: true, defaults }, null, 2));
		return;
	}

	if (command === 'add') {
		await runAddCommand(commandArgs[0]);
		return;
	}

	if (command === 'create-app') {
		const { runCli: runDomainCli } = await import('@ekairos/domain/cli');
		const code = await runDomainCli(['create-app', ...rawArgv.slice(1)]);
		process.exit(code);
	}

	if (command === 'domain') {
		if (commandArgs[0] === 'create-app') {
			console.error('Use `ekairos create-app ...` for app creation.');
			process.exit(1);
		}
		const defaults = await readCliDefaults();
		const app = cli.flags.app || process.env.EKAIROS_APP || defaults.app;
		const env = cli.flags.env ?? process.env.EKAIROS_ENV ?? defaults.env;
		if (!app) {
			console.error(
				'ekairos domain runs platform-mediated and requires an application. Pass --app=<appId>, or set a default once with `ekairos use --app=<appId> --env=<key>`. Sign in first with `ekairos login`.',
			);
			process.exit(1);
		}

		// Environments are explicit: data operations never run against an
		// implicit target. introspect and env management are app-level.
		const operation = commandArgs[0] ?? 'introspect';
		const needsEnv = !['introspect', 'env'].includes(operation);
		if (needsEnv && !env && !cli.flags.envData) {
			console.error(
				`ekairos domain ${operation} requires an explicit environment. Pass --env=<key>, or set a default once with \`ekairos use --env=<key>\`. Discover environments with: ekairos domain env list --app=${app}`,
			);
			process.exit(1);
		}
		if (process.stderr.isTTY) {
			console.error(`→ app=${app}${env ? ` env=${env}` : ''}`);
		}

		const code = await runPlatformDomainCommand(commandArgs, {
			app,
			env,
			envData: cli.flags.envData,
			data: cli.flags.data,
			platformUrl: cli.flags.platform || defaults.platform,
			pretty: cli.flags.pretty || cli.flags.json,
			title: cli.flags.title,
		});
		process.exit(code);
	}

	if (command === 'dataset') {
		const { runDatasetCommand } = await import('./lib/dataset.js');
		await runDatasetCommand(commandArgs);
		return;
	}

	if (cli.flags.async || cli.flags.session) {
		try {
			const { createSession, loadSession, processAsyncStep } = await import(
				'./lib/session.js'
			);
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
		const [{ default: React }, { render }, { default: App }] = await Promise.all([
			import('react'),
			import('ink'),
			import('./app.js'),
		]);
		render(React.createElement(App));
	}
}

run();
