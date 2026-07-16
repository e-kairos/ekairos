import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

export type CliDefaults = {
	app?: string;
	env?: string;
	platform?: string;
};

const DEFAULTS_DIR = '.ekairos';
const DEFAULTS_FILE = 'cli.json';

function defaultsPath(cwd = process.cwd()) {
	return join(cwd, DEFAULTS_DIR, DEFAULTS_FILE);
}

async function findDefaultsFile(cwd = process.cwd()): Promise<string | null> {
	let current = cwd;
	for (let depth = 0; depth < 24; depth += 1) {
		const candidate = join(current, DEFAULTS_DIR, DEFAULTS_FILE);
		try {
			await fs.access(candidate);
			return candidate;
		} catch {
			// keep walking up
		}
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
	return null;
}

export async function readCliDefaults(cwd = process.cwd()): Promise<CliDefaults> {
	const file = await findDefaultsFile(cwd);
	if (!file) return {};
	try {
		const parsed = JSON.parse(await fs.readFile(file, 'utf8'));
		return parsed && typeof parsed === 'object' ? (parsed as CliDefaults) : {};
	} catch {
		return {};
	}
}

export async function writeCliDefaults(
	updates: CliDefaults,
	cwd = process.cwd(),
): Promise<{ file: string; defaults: CliDefaults }> {
	const file = (await findDefaultsFile(cwd)) ?? defaultsPath(cwd);
	const current = await readCliDefaults(cwd);
	const defaults: CliDefaults = { ...current };
	for (const key of ['app', 'env', 'platform'] as const) {
		const value = updates[key];
		if (value === undefined) continue;
		if (value === '') delete defaults[key];
		else defaults[key] = value;
	}
	await fs.mkdir(dirname(file), { recursive: true });
	await fs.writeFile(file, `${JSON.stringify(defaults, null, 2)}\n`, 'utf8');
	return { file, defaults };
}
