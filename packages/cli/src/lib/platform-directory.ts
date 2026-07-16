import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { PlatformApi, type PlatformApplication } from '@ekairos/platform';
import { getPlatformAccessToken, resolvePlatformUrl } from './platform-auth.js';

export type PlatformDirectory = {
	fetchedAt: number;
	platformUrl: string;
	applications: PlatformApplication[];
};

const CACHE_TTL_MS = 10 * 60 * 1000;

function cachePath() {
	const root = process.env.EKAIROS_CLI_HOME?.trim() || join(homedir(), '.ekairos');
	return join(root, 'directory-cache.json');
}

async function readCache(): Promise<PlatformDirectory | null> {
	try {
		const parsed = JSON.parse(await fs.readFile(cachePath(), 'utf8'));
		if (!parsed || !Array.isArray(parsed.applications)) return null;
		return parsed as PlatformDirectory;
	} catch {
		return null;
	}
}

async function writeCache(directory: PlatformDirectory) {
	try {
		const file = cachePath();
		await fs.mkdir(dirname(file), { recursive: true });
		await fs.writeFile(file, JSON.stringify(directory), 'utf8');
	} catch {
		// cache is best effort
	}
}

/**
 * Applications + environments visible to the signed-in user, cached on disk
 * for 10 minutes so completions stay fast. `preferCache` returns stale data
 * rather than blocking on the network (used by tab-completion).
 */
export async function loadPlatformDirectory(options?: {
	platformUrl?: string;
	preferCache?: boolean;
}): Promise<PlatformDirectory | null> {
	const platformUrl = resolvePlatformUrl(options?.platformUrl);
	const cached = await readCache();
	const fresh =
		cached &&
		cached.platformUrl === platformUrl &&
		Date.now() - cached.fetchedAt < CACHE_TTL_MS;

	if (cached && (fresh || options?.preferCache) && cached.platformUrl === platformUrl) {
		return cached;
	}

	const credentials = await getPlatformAccessToken(platformUrl).catch(() => null);
	if (!credentials) return cached?.platformUrl === platformUrl ? cached : null;

	try {
		const platform = new PlatformApi({
			auth: { token: credentials.accessToken },
			platformUrl,
		});
		const applications = await platform.apps.list();
		const directory: PlatformDirectory = {
			fetchedAt: Date.now(),
			platformUrl,
			applications,
		};
		await writeCache(directory);
		return directory;
	} catch {
		return cached?.platformUrl === platformUrl ? cached : null;
	}
}

export async function refreshPlatformDirectory(platformUrl?: string) {
	try {
		await fs.rm(cachePath(), { force: true });
	} catch {
		// ignore
	}
	return await loadPlatformDirectory({ platformUrl });
}
