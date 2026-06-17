import { readFile } from 'node:fs/promises';
import { Script } from 'node:vm';
import { getPlatformAccessToken, resolvePlatformUrl } from './platform-auth.js';

type PlatformDomainOptions = {
	app?: string;
	env?: string;
	platformUrl?: string;
	pretty?: boolean;
};

function asText(value: unknown) {
	return typeof value === 'string' ? value.trim() : '';
}

function normalizeDomainArgs(args: string[]) {
	const [first, ...rest] = args;
	if (!first) return ['introspect'];
	if (first.includes('.') && first !== 'query' && first !== 'action') {
		return ['action', first, ...rest];
	}
	return args;
}

async function readInput(input: string | undefined, field: string) {
	if (!input) {
		if (field === 'input') return {};
		throw new Error(`Missing ${field}.`);
	}

	const source = input === '-'
		? await new Promise<string>((resolve, reject) => {
			let data = '';
			process.stdin.setEncoding('utf8');
			process.stdin.on('data', (chunk) => {
				data += chunk;
			});
			process.stdin.on('end', () => resolve(data));
			process.stdin.on('error', reject);
		})
		: input.startsWith('@')
			? await readFile(input.slice(1), 'utf8')
			: input;

	return new Script(`(${source})`, { filename: `ekairos-domain-${field}.json5` })
		.runInNewContext(Object.freeze({}));
}

async function readEnv(input: string | undefined) {
	if (!input) return undefined;
	const env = await readInput(input, 'env');
	if (!env || typeof env !== 'object' || Array.isArray(env)) {
		throw new Error('--env must be a JSON object.');
	}
	return env as Record<string, unknown>;
}

async function buildPlatformBody(args: string[], appId: string, envInput?: string) {
	const normalized = normalizeDomainArgs(args);
	const [operation, ...rest] = normalized;
	const env = await readEnv(envInput);
	const withEnv = <T extends Record<string, unknown>>(body: T) =>
		env ? { ...body, env } : body;

	if (operation === 'introspect') {
		return withEnv({ appId, operation: 'introspect' });
	}

	if (operation === 'query') {
		return withEnv({
			appId,
			operation: 'query',
			query: await readInput(rest[0], 'query'),
		});
	}

	if (operation === 'action') {
		const action = asText(rest[0]);
		if (!action) throw new Error('Missing action name.');
		return withEnv({
			appId,
			operation: 'action',
			action,
			input: await readInput(rest[1], 'input'),
		});
	}

	if (operation === 'dataset') {
		return withEnv({
			appId,
			operation: 'dataset',
			query: await readInput(rest[0], 'query'),
		});
	}

	throw new Error(`Unsupported platform domain operation: ${operation}`);
}

export async function runPlatformDomainCommand(
	args: string[],
	options: PlatformDomainOptions,
) {
	const platformUrl = resolvePlatformUrl(options.platformUrl);
	const appId = asText(options.app);
	if (!appId) {
		throw new Error('Missing --app for platform domain command.');
	}

	const credentials = await getPlatformAccessToken(platformUrl);
	if (!credentials) {
		throw new Error(
			`Not signed in to ${platformUrl}. Run: ${
				options.platformUrl ? `ekairos login --platform=${platformUrl}` : 'ekairos login'
			}`,
		);
	}

	const body = await buildPlatformBody(args, appId, options.env);
	const headers: Record<string, string> = {
		authorization: `Bearer ${credentials.accessToken}`,
		'content-type': 'application/json',
	};

	const response = await fetch(`${platformUrl}/api/platform/domain/run`, {
		body: JSON.stringify(body),
		headers,
		method: 'POST',
	});
	const text = await response.text();
	let payload: unknown = text;
	try {
		payload = JSON.parse(text);
	} catch {
		// Keep raw response text.
	}

	if (typeof payload === 'string') {
		console.log(payload);
	} else {
		console.log(JSON.stringify(payload, null, options.pretty ? 2 : 0));
	}

	if (!response.ok) return 1;
	if (payload && typeof payload === 'object' && (payload as { ok?: unknown }).ok === false) {
		return 1;
	}
	return 0;
}
