import { readCliDefaults } from './defaults.js';
import { loadPlatformDirectory } from './platform-directory.js';

const TOP_COMMANDS = [
	'login',
	'whoami',
	'logout',
	'token',
	'use',
	'apps',
	'domain',
	'dataset',
	'create-app',
	'add',
	'completion',
];

const DOMAIN_OPERATIONS = ['introspect', 'query', 'action', 'dataset', 'env'];
const DOMAIN_ENV_SUBCOMMANDS = ['list', 'register'];
const DOMAIN_FLAGS = [
	'--app=',
	'--env=',
	'--env-data=',
	'--data=',
	'--title=',
	'--platform=',
	'--pretty',
	'--json',
];

function tokenize(line: string): string[] {
	return line
		.replace(/^\S*ekairos(\.\w+)?\s*/i, '')
		.split(/\s+/)
		.filter(Boolean);
}

function flagValueFromLine(words: string[], name: string): string {
	for (const word of words) {
		if (word.startsWith(`${name}=`)) return word.slice(name.length + 1);
	}
	return '';
}

async function completeApps(prefix: string): Promise<string[]> {
	const directory = await loadPlatformDirectory({ preferCache: true });
	if (!directory) return [];
	return directory.applications
		.map((app) => app.appId)
		.filter((appId) => appId.startsWith(prefix));
}

async function completeEnvs(appId: string, prefix: string): Promise<string[]> {
	const directory = await loadPlatformDirectory({ preferCache: true });
	if (!directory) return [];
	const application = appId
		? directory.applications.find((app) => app.appId === appId)
		: null;
	const environments = application
		? application.environments
		: directory.applications.flatMap((app) => app.environments);
	return [...new Set(environments.map((environment) => environment.key))]
		.filter((key) => key.startsWith(prefix))
		.sort();
}

async function completeProjects(prefix: string): Promise<string[]> {
	const directory = await loadPlatformDirectory({ preferCache: true });
	if (!directory) return [];
	return [
		...new Set(
			directory.applications
				.map((app) => String(app.project ?? '').trim())
				.filter(Boolean),
		),
	]
		.filter((project) => project.startsWith(prefix))
		.sort();
}

/**
 * Candidate list for shell tab-completion. Input: the current command line
 * and the word being completed. Output: one candidate per line on stdout.
 */
export async function runCompleteCommand(rawArgs: string[]): Promise<void> {
	let line = '';
	let word = '';
	for (let index = 0; index < rawArgs.length; index += 1) {
		if (rawArgs[index] === '--line') line = rawArgs[index + 1] ?? '';
		if (rawArgs[index] === '--word') word = rawArgs[index + 1] ?? '';
	}

	const words = tokenize(line);
	// Drop the word under the cursor so position checks see only completed words.
	if (word && words[words.length - 1] === word) words.pop();

	const candidates = await computeCandidates(words, word);
	for (const candidate of candidates) {
		process.stdout.write(`${candidate}\n`);
	}
}

async function computeCandidates(words: string[], word: string): Promise<string[]> {
	// Value completion for --app= / --env= / --project= anywhere.
	if (word.startsWith('--app=')) {
		const apps = await completeApps(word.slice('--app='.length));
		return apps.map((appId) => `--app=${appId}`);
	}
	if (word.startsWith('--env=')) {
		const defaults = await readCliDefaults();
		const appId =
			flagValueFromLine(words, '--app') ||
			process.env.EKAIROS_APP ||
			defaults.app ||
			'';
		const envs = await completeEnvs(appId, word.slice('--env='.length));
		return envs.map((key) => `--env=${key}`);
	}
	if (word.startsWith('--project=')) {
		const projects = await completeProjects(word.slice('--project='.length));
		return projects.map((project) => `--project=${project}`);
	}

	const [command, ...rest] = words;

	if (!command) {
		return TOP_COMMANDS.filter((candidate) => candidate.startsWith(word));
	}

	if (command === 'domain') {
		const positionals = rest.filter((entry) => !entry.startsWith('--'));
		if (positionals.length === 0 && !word.startsWith('--')) {
			return DOMAIN_OPERATIONS.filter((candidate) => candidate.startsWith(word));
		}
		if (positionals[0] === 'env' && positionals.length === 1 && !word.startsWith('--')) {
			return DOMAIN_ENV_SUBCOMMANDS.filter((candidate) => candidate.startsWith(word));
		}
		if (word.startsWith('--') || word === '') {
			return DOMAIN_FLAGS.filter((candidate) => candidate.startsWith(word));
		}
		return [];
	}

	if (command === 'use' || command === 'apps') {
		const flags = ['--app=', '--env=', '--project=', '--platform=', '--refresh'];
		return flags.filter((candidate) => candidate.startsWith(word));
	}

	if (command === 'completion') {
		return ['powershell', 'bash', 'zsh'].filter((candidate) =>
			candidate.startsWith(word),
		);
	}

	if (words.length === 0) {
		return TOP_COMMANDS.filter((candidate) => candidate.startsWith(word));
	}

	return [];
}

export function completionScript(shell: string): string {
	if (shell === 'powershell') {
		return [
			'Register-ArgumentCompleter -Native -CommandName ekairos -ScriptBlock {',
			'    param($wordToComplete, $commandAst, $cursorPosition)',
			'    $line = $commandAst.ToString()',
			'    ekairos complete --line "$line" --word "$wordToComplete" 2>$null | ForEach-Object {',
			"        [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)",
			'    }',
			'}',
			'',
		].join('\n');
	}

	if (shell === 'bash') {
		return [
			'_ekairos_complete() {',
			'    local word="${COMP_WORDS[COMP_CWORD]}"',
			'    local line="${COMP_LINE}"',
			'    COMPREPLY=( $(ekairos complete --line "$line" --word "$word" 2>/dev/null) )',
			'}',
			'complete -F _ekairos_complete ekairos',
			'',
		].join('\n');
	}

	if (shell === 'zsh') {
		return [
			'_ekairos_complete() {',
			'    local -a candidates',
			'    candidates=( ${(f)"$(ekairos complete --line "$BUFFER" --word "$PREFIX" 2>/dev/null)"} )',
			'    compadd -a candidates',
			'}',
			'compdef _ekairos_complete ekairos',
			'',
		].join('\n');
	}

	throw new Error(`Unsupported shell: ${shell}. Use powershell, bash, or zsh.`);
}
