// Rôles de projet : les sous-agents Claude Code du projet visé (`.claude/agents/*.md`) deviennent des
// rôles perso, visibles seulement dans ce projet. Rien n'est copié : les fichiers sont relus à chaque
// appel, donc un changement poussé sur la branche est pris tout de suite. Les réglages propres à Nay
// (règle d'usage, chemins du diff, chaîne d'agents) vivent dans `.nay/roles.json` du checkout principal.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join } from 'node:path';

export const AGENTS_DIR = '.claude/agents';
export const OVERRIDES_FILE = '.nay/roles.json';
export const PATH_USAGE = 'selon-diff';
const OVERRIDE_FIELDS = ['usage', 'paths', 'agents'];
const MAX_INSTRUCTIONS = 100_000;
const WRITE_TOOLS = ['Edit', 'Write'];

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

// `checkout` : dossier de travail visé (sa branche fournit les agents) ; `root` : checkout principal,
// commun aux worktrees (il porte `.nay/roles.json`, exclu de Git). null hors dépôt Git.
export function locateProject(cwd, { run = git } = {}) {
  try {
    const checkout = run(['rev-parse', '--show-toplevel'], cwd);
    const common = run(['rev-parse', '--path-format=absolute', '--git-common-dir'], cwd);
    if (!isAbsolute(checkout) || !isAbsolute(common)) return null;
    return { checkout, root: dirname(common), name: basename(dirname(common)) };
  } catch {
    return null;
  }
}

function unquote(value) {
  const match = value.match(/^(["'])(.*)\1$/s);
  return match ? match[2] : value;
}

// Frontmatter YAML simple : `clé: valeur`, listes `[a, b]`, `a, b` ou en tirets, blocs `>` et `|`.
export function parseAgentFile(text) {
  const match = text.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)$/);
  if (!match) throw new Error('frontmatter absent (le fichier doit commencer par ---)');
  const fields = {};
  const lines = match[1].split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const pair = line.match(/^([A-Za-z][\w-]*):[ \t]*(.*)$/);
    if (!pair) throw new Error(`ligne de frontmatter illisible : ${line.trim()}`);
    const [, key, raw] = pair;
    let value = raw.trim();
    const block = [];
    while (index + 1 < lines.length && /^[ \t]+\S/.test(lines[index + 1])) block.push(lines[++index].trim());
    if (block.length && /^[>|]-?$/.test(value)) value = block.join(value.startsWith('>') ? ' ' : '\n');
    else if (block.length && !value && block.every((item) => item.startsWith('- '))) {
      value = block.map((item) => unquote(item.slice(2).trim()));
    } else if (block.length) value = [value, ...block].join(' ');
    fields[key] = typeof value === 'string' ? unquote(value) : value;
  }
  return { fields, body: match[2].trim() };
}

function toolList(value) {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) return value.map(String);
  return String(value).replace(/^\[|\]$/g, '').split(',').map((tool) => unquote(tool.trim())).filter(Boolean);
}

// Lecture seule si l'agent n'a ni Edit ni Write : `tools` sans eux, ou `disallowedTools` qui les retire.
export function agentMode(fields) {
  const tools = toolList(fields.tools);
  if (tools) return WRITE_TOOLS.some((tool) => tools.includes(tool)) ? 'write' : 'read';
  const denied = toolList(fields.disallowedTools) ?? [];
  return WRITE_TOOLS.every((tool) => denied.includes(tool)) ? 'read' : 'write';
}

function labelOf(id) {
  const words = id.replace(/-/g, ' ');
  return words[0].toUpperCase() + words.slice(1);
}

// `model:` reste une indication pour Claude Code : Nay choisit l'agent selon ses quotas.
export function agentRole(fields, body, { validateId }) {
  const errors = [];
  const id = fields.name;
  if (typeof id !== 'string' || !id) errors.push('name absent');
  else errors.push(...validateId(id));
  if (typeof fields.description !== 'string' || !fields.description.trim()) errors.push('description absente');
  if (body.length > MAX_INSTRUCTIONS) errors.push(`corps de plus de ${MAX_INSTRUCTIONS} caractères`);
  if (errors.length) return { errors };
  return { id, role: {
    label: labelOf(id), description: fields.description.trim(),
    ...(body ? { instructions: body } : {}),
    mode: agentMode(fields), usage: null, source: 'projet',
    ...(typeof fields.model === 'string' && fields.model ? { claudeModel: fields.model } : {}),
  }, errors: [] };
}

function readAgents(checkout, validateId) {
  const dir = join(checkout, AGENTS_DIR);
  let names;
  try {
    names = readdirSync(dir).filter((name) => name.endsWith('.md')).sort();
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { roles: {}, errors: [] };
    return { roles: {}, errors: [`${AGENTS_DIR} illisible : ${error.message}`] };
  }
  const roles = {};
  const errors = [];
  for (const name of names) {
    const file = `${AGENTS_DIR}/${name}`;
    try {
      const { fields, body } = parseAgentFile(readFileSync(join(dir, name), 'utf8'));
      const result = agentRole(fields, body, { validateId });
      if (result.errors.length) throw new Error(result.errors.join(' ; '));
      if (Object.hasOwn(roles, result.id)) throw new Error(`name « ${result.id} » déjà pris par ${roles[result.id].file}`);
      roles[result.id] = { ...result.role, file };
    } catch (error) {
      errors.push(`${file} ignoré : ${error.message}`);
    }
  }
  return { roles, errors };
}

export function readOverrides(root) {
  const file = join(root, OVERRIDES_FILE);
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw new Error(`${OVERRIDES_FILE} illisible : ${error.message}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (cause) {
    throw new Error(`${OVERRIDES_FILE} : JSON invalide (${cause.message})`);
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`${OVERRIDES_FILE} doit contenir un objet`);
  return data;
}

export function writeOverrides(root, data) {
  const file = join(root, OVERRIDES_FILE);
  mkdirSync(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(data, null, 2)}\n`, { flag: 'wx' });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}

const isText = (value) => typeof value === 'string' && value.trim() !== '';

export function validateOverride(id, override, { usages, agentNames }) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return ['réglage invalide (objet attendu)'];
  const errors = [];
  const extra = Object.keys(override).filter((key) => !OVERRIDE_FIELDS.includes(key));
  if (extra.length) errors.push(`champs inconnus : ${extra.join(', ')}`);
  const { usage, paths, agents } = override;
  if (usage !== undefined && usage !== null && !Object.hasOwn(usages, usage)) {
    errors.push(`usage : ${Object.keys(usages).join(', ')} ou null`);
  }
  if (paths !== undefined && (!Array.isArray(paths) || !paths.length || !paths.every(isText))) {
    errors.push('paths : liste non vide de motifs');
  }
  if (usage === PATH_USAGE && paths === undefined) errors.push(`usage ${PATH_USAGE} : paths requis`);
  if (agents !== undefined) {
    if (!Array.isArray(agents) || !agents.length || !agents.every(isText)) errors.push('agents : liste non vide');
    else {
      const unknown = agents.filter((agent) => !agentNames.includes(agent));
      if (unknown.length) errors.push(`agents inconnus : ${unknown.join(', ')}`);
      if (new Set(agents).size !== agents.length) errors.push('agents : doublon');
    }
  }
  return errors;
}

// Rôles du projet visé, réglages `.nay/roles.json` appliqués. N'échoue jamais : les fichiers
// invalides sont rendus dans `errors` (affichés par check-config) et ignorés.
export function readProjectRoles(cwd, { validateId, usages, agentNames, locate = locateProject }) {
  const project = cwd ? locate(cwd) : null;
  if (!project) return { project: null, roles: {}, errors: [] };
  const { roles, errors } = readAgents(project.checkout, validateId);
  let overrides = {};
  try {
    overrides = readOverrides(project.root);
  } catch (error) {
    errors.push(`${error.message} : réglages ignorés`);
  }
  for (const [id, override] of Object.entries(overrides)) {
    if (!Object.hasOwn(roles, id)) {
      errors.push(`${OVERRIDES_FILE} : ${id} ignoré (aucun agent ${AGENTS_DIR} de ce nom)`);
      continue;
    }
    const problems = validateOverride(id, override, { usages, agentNames });
    if (problems.length) {
      errors.push(`${OVERRIDES_FILE} : ${id} ignoré (${problems.join(' ; ')})`);
      continue;
    }
    roles[id] = { ...roles[id], ...override };
  }
  return { project, roles, errors };
}

// Motif de chemin : `**` traverse les dossiers, `*` et `?` restent dans un segment.
export function globToRegExp(glob) {
  let pattern = '';
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index];
    if (char === '*' && glob[index + 1] === '*') {
      const slashAfter = glob[index + 2] === '/';
      const atStart = index === 0 || glob[index - 1] === '/';
      if (atStart && slashAfter) {
        pattern += '(?:.*/)?';
        index += 2;
      } else if (atStart && index + 2 === glob.length && index > 0) {
        pattern = `${pattern.slice(0, -1)}(?:/.*)?`;
        index += 1;
      } else {
        pattern += '.*';
        index += 1;
      }
    } else if (char === '*') pattern += '[^/]*';
    else if (char === '?') pattern += '[^/]';
    else pattern += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${pattern}$`);
}

export function touchesPaths(files, globs) {
  const patterns = globs.map(globToRegExp);
  return files.some((file) => patterns.some((pattern) => pattern.test(file.replace(/^\.\//, ''))));
}

// Chaîne d'agents d'un rôle de projet : `agents` de `.nay/roles.json`, sinon celle du relecteur.
export function withRoleChains(delegation, roles) {
  const chains = Object.entries(roles).filter(([, role]) => role.source === 'projet')
    .map(([id, role]) => [id, role.agents ?? delegation.relecteur?.parDefaut ?? []]);
  return chains.length ? { ...delegation, ...Object.fromEntries(chains) } : delegation;
}

// `nay usage` sur un rôle de projet : la règle va dans `.nay/roles.json`, pas dans la config globale.
export function saveProjectUsage(root, id, usage, paths) {
  const overrides = readOverrides(root);
  const entry = { ...(overrides[id] ?? {}), usage };
  if (paths?.length) entry.paths = paths;
  if (usage === PATH_USAGE && !entry.paths?.length) {
    throw new Error(`${PATH_USAGE} : donne au moins un motif de chemin (ex. "**/*.vue")`);
  }
  writeOverrides(root, { ...overrides, [id]: entry });
  return entry;
}
