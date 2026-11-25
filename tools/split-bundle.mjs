// One-off: split the original single-file bundle into modules. Usage: node split.mjs <original.html> <outDir>
import fs from 'node:fs';
import path from 'node:path';

const [src, out] = process.argv.slice(2);
const L = fs.readFileSync(src, 'utf8').split('\n');
const lines = (a, b) => L.slice(a - 1, b).join('\n');

const shaders = {
  common: [666, 716], scene: [718, 785], shadow: [787, 796], glass: [798, 857], fx: [859, 935],
  post: [937, 961], outline: [963, 1017], bloom: [1019, 1067], final: [1069, 1133],
};
const mods = [
  ['engine/gfx.ts', 507, 630],
  ['engine/mesh.ts', 632, 664],
  ['engine/renderer.ts', 1135, 1834],
  ['engine/camera.ts', 1836, 1874],
  ['engine/input.ts', 1876, 2054],
  ['engine/time.ts', 2056, 2156],
  ['math/vec.ts', 2158, 2231],
  ['audio/audio-engine.ts', 2233, 2400],
  ['audio/synths.ts', 2401, 2507],
  ['levels/builder.ts', 2509, 2610],
  ['levels/act1.ts', 2611, 2837],
  ['levels/act2.ts', 2839, 3062],
  ['levels/act3.ts', 3064, 3386],
  ['levels/index.ts', 3388, 3393],
  ['ui/ui.ts', 3395, 3733],
  ['save.ts', 3735, 3777],
  ['ui/debug-overlay.ts', 3779, 3814],
  ['engine/mesh-builder.ts', 3816, 3922],
  ['levels/themes.ts', 3924, 3995],
  ['physics/static-world.ts', 3997, 4303],
  ['physics/nav-grid.ts', 4305, 4581],
  ['levels/level-mesh.ts', 4583, 4612],
  ['math/rng.ts', 4614, 4638],
  ['render/mesh-library.ts', 4640, 4790],
  ['game/items.ts', 4792, 4824],
  ['game/enemy.ts', 4826, 5196],
  ['game/world.ts', 5198, 6062],
  ['game/player.ts', 6064, 6159],
  ['game/time-scale.ts', 6161, 6190],
  ['render/fx.ts', 6192, 6453],
  ['render/viewmodel.ts', 6455, 6569],
  ['game/replay.ts', 6571, 6621],
  ['render/pose.ts', 6623, 6694],
  ['game/game.ts', 6696, 7392],
  ['main.ts', 7394, 7418],
];

// top-level declarations -> module
const owner = new Map();
const declRe = /^(?:var|let|const|function|async function|class)\s+([A-Za-z_$][\w$]*)/;
for (const [file, a, b] of mods) {
  for (let i = a; i <= b; i++) {
    const m = declRe.exec(L[i - 1]);
    if (m) owner.set(m[1], file);
  }
}
for (const n of Object.keys(shaders)) owner.set(`${n}_default`, `shaders/${n}.wgsl`);
owner.set('mat4', 'wgpu-matrix');
owner.set('vec3', 'wgpu-matrix');

// names that are reassigned at module level must stay `let`
const reassigned = new Set(['nextMeshId']);

const strip = (code) => code
  .replace(/`(?:\\.|[^`\\])*`/g, (s) => s.replace(/\$\{([^}]*)\}/g, ' $1 ').replace(/[^\s${}]/g, ' '))
  .replace(/"(?:\\.|[^"\\])*"/g, '""')
  .replace(/'(?:\\.|[^'\\])*'/g, "''");

const rel = (from, to) => {
  if (to === 'wgpu-matrix') return 'wgpu-matrix';
  let r = path.relative(path.dirname(from), to).replace(/\.ts$/, '');
  if (!r.startsWith('.')) r = './' + r;
  return to.endsWith('.wgsl') ? r + '?raw' : r;
};

fs.mkdirSync(path.join(out, 'shaders'), { recursive: true });
for (const [n, [a, b]] of Object.entries(shaders)) {
  const body = lines(a, b).replace(/^var \w+ = `\n?/, '').replace(/\n?`;\s*$/, '\n');
  fs.writeFileSync(path.join(out, 'shaders', `${n}.wgsl`), body);
}

for (const [file, a, b] of mods) {
  let body = lines(a, b);
  const scan = strip(body);
  const needed = new Map();
  for (const [name, mod] of owner) {
    if (mod === file) continue;
    const re = new RegExp(`(?<![\\w$.])${name.replace(/\$/g, '\\$')}(?![\\w$])(?!\\s*:(?!:))`);
    if (re.test(scan)) {
      if (!needed.has(mod)) needed.set(mod, []);
      needed.get(mod).push(name);
    }
  }
  const imports = [...needed].sort(([x], [y]) => x.localeCompare(y)).map(([mod, names]) =>
    mod.endsWith('.wgsl')
      ? `import ${names[0]} from '${rel(file, mod)}';`
      : `import { ${names.sort().join(', ')} } from '${rel(file, mod)}';`);
  if (file !== 'main.ts') {
    body = body.replace(/^(var|let|const|function|async function|class)\s+([A-Za-z_$][\w$]*)/gm, (m0, kw, name) => {
      const k = kw === 'var' ? (reassigned.has(name) ? 'let' : 'const') : kw;
      return `export ${k} ${name}`;
    });
  }
  const header = file === 'main.ts' ? [`import './ui/style.css';`, ...imports] : imports;
  const full = (header.length ? header.join('\n') + '\n\n' : '') + body + '\n';
  fs.mkdirSync(path.dirname(path.join(out, file)), { recursive: true });
  fs.writeFileSync(path.join(out, file), full);
}
fs.mkdirSync(path.join(out, 'ui'), { recursive: true });
fs.writeFileSync(path.join(out, 'ui/style.css'), lines(9, 493).trimEnd() + '\n');
console.log('modules', mods.length, 'names', owner.size);
