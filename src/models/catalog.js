// Catalogue des modèles proposés par chaque CLI, pour créer des agents depuis l'interface.
import { execFile } from 'node:child_process';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { EFFORTS, loadEngineConfig, loadModelsConfig } from '../config.js';

export const PROVIDERS = ['codex', 'agy', 'claude'];
const EFFORT_SUFFIX = new RegExp(`^(.+)-(${EFFORTS.join('|')})$`);

// Nay ne transmet que ses propres niveaux d'effort ; les niveaux propres à un CLI (max, ultra) sont ignorés.
const naySupported = (efforts) => EFFORTS.filter((effort) => efforts.includes(effort));

export function parseCodexModels(text) {
  const { models } = JSON.parse(text);
  if (!Array.isArray(models)) throw new Error('Catalogue Codex sans liste de modèles');
  return models.filter((entry) => entry.visibility === 'list' && typeof entry.slug === 'string')
    .map((entry) => {
      const efforts = naySupported((entry.supported_reasoning_levels ?? []).map((level) => level.effort));
      return { model: entry.slug, label: entry.display_name || entry.slug,
        description: entry.description ?? '', efforts,
        defaultEffort: efforts.includes(entry.default_reasoning_level) ? entry.default_reasoning_level : null };
    });
}

// agy liste une ligne par variante (`gemini-4-neon-high`) : on les regroupe en un modèle
// `gemini-4-neon-{effort}`, le format attendu par config/agents.json.
export function parseAgyModels(text) {
  const groups = new Map();
  for (const line of text.split(/\r?\n/)) {
    const [id, name] = line.split('\t').map((part) => part?.trim());
    if (!id || name === undefined || !/^[\w.-]+$/.test(id)) continue;
    const match = EFFORT_SUFFIX.exec(id);
    const key = match ? `${match[1]}-{effort}` : id;
    const label = match ? name.replace(/\s*\([^)]*\)\s*$/, '') : name;
    const group = groups.get(key) ?? { model: key, label: label || id, description: '', efforts: [], defaultEffort: null };
    if (match) group.efforts.push(match[2]);
    groups.set(key, group);
  }
  if (!groups.size) throw new Error('Aucun modèle reconnu dans la sortie de agy');
  return [...groups.values()].map((group) => ({ ...group, efforts: naySupported(group.efforts) }));
}

export function claudeModels(config = loadModelsConfig()) {
  return config.claude.map((entry) => ({ model: entry.model, label: entry.label ?? entry.model,
    description: entry.description ?? '', efforts: [...EFFORTS], defaultEffort: null }));
}

function run(bin, args, config) {
  return new Promise((resolvePromise, reject) => {
    execFile(bin, args, { timeout: config.listTimeoutSec * 1000, maxBuffer: config.maxOutputBytes },
      (error, stdout, stderr) => {
        if (error) {
          const reason = error.killed ? `délai de ${config.listTimeoutSec} s dépassé`
            : (stderr.trim().split('\n').at(-1) || error.message);
          reject(new Error(reason));
        } else resolvePromise(stdout);
      });
  });
}

export function defaultListers(engine = loadEngineConfig(), config = loadModelsConfig()) {
  return {
    codex: async () => parseCodexModels(await run(engine.codexBin, ['debug', 'models'], config)),
    agy: async () => parseAgyModels(await run(engine.agyBin, ['models'], config)),
    claude: async () => claudeModels(config),
  };
}

// Un fournisseur en échec garde ses modèles du dernier catalogue connu, marqués `stale`.
export async function fetchCatalog({ listers = defaultListers(), previous = null, now = Date.now } = {}) {
  const fetchedAt = new Date(now()).toISOString();
  const results = await Promise.allSettled(PROVIDERS.map((provider) => listers[provider]()));
  const providers = {};
  PROVIDERS.forEach((provider, index) => {
    const result = results[index];
    if (result.status === 'fulfilled') {
      providers[provider] = { status: 'ok', fetchedAt, models: result.value };
      return;
    }
    const old = previous?.providers?.[provider];
    providers[provider] = { status: 'error', reason: result.reason?.message ?? String(result.reason),
      fetchedAt: old?.fetchedAt ?? null, stale: Boolean(old?.models?.length), models: old?.models ?? [] };
  });
  return { fetchedAt, providers };
}

// Garde le catalogue en mémoire et sur disque ; une seule lecture des CLI à la fois.
export function createCatalog({ root, config = loadModelsConfig(), listers, now = Date.now } = {}) {
  const cacheFile = resolve(root, config.cachePath);
  let current = null;
  let pending = null;

  async function load() {
    if (current) return current;
    try { current = JSON.parse(await readFile(cacheFile, 'utf8')); } catch { current = null; }
    return current;
  }

  async function save(catalog) {
    await mkdir(dirname(cacheFile), { recursive: true });
    const temporary = `${cacheFile}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`);
    await rename(temporary, cacheFile);
  }

  function refresh() {
    pending ??= load()
      .then((previous) => fetchCatalog({ listers: listers ?? defaultListers(undefined, config), previous, now }))
      .then(async (catalog) => {
        current = catalog;
        await save(catalog).catch((error) => process.stderr.write(`Catalogue non enregistré : ${error.message}\n`));
        return catalog;
      })
      .finally(() => { pending = null; });
    return pending;
  }

  return {
    refresh,
    refreshing: () => pending !== null,
    async get() { return (await load()) ?? refresh(); },
  };
}

export function findModel(catalog, cli, model) {
  return catalog?.providers?.[cli]?.models?.find((entry) => entry.model === model) ?? null;
}
