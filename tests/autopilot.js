// Playwright play-test autopilot for STILLFRAME (dev server only: needs window.__game).
// It plays through real DOM input events (keyboard, mouse buttons, pointer-lock mouse deltas),
// reading game state only to decide what a player would do next.
// Usage from Playwright:  await page.addScriptTag({ path: 'tests/autopilot.js' });
//                         await page.evaluate(() => window.__autopilot.playLevel(0));
(() => {
  const canvas = () => document.getElementById('gfx');
  const key = (code, down) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, bubbles: true }));
  const mouse = (button, down) => (down ? canvas() : window).dispatchEvent(new MouseEvent(down ? 'mousedown' : 'mouseup', { button, bubbles: true }));
  const look = (dx, dy) => window.dispatchEvent(new MouseEvent('mousemove', { movementX: dx, movementY: dy }));
  const frame = () => new Promise((r) => requestAnimationFrame(r));
  const angleDiff = (a, b) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
  const GUNS = new Set(['pistol', 'scatter', 'carbine']);

  const held = { KeyW: false, KeyA: false, KeyS: false, KeyD: false };
  const setKey = (code, on) => { if (held[code] !== on) { held[code] = on; key(code, on); } };
  const releaseAll = () => Object.keys(held).forEach((k) => setKey(k, false));

  let pendingRelease = [];
  const tap = (kind, codeOrButton) => {
    if (kind === 'key') key(codeOrButton, true); else mouse(codeOrButton, true);
    pendingRelease.push([kind, codeOrButton]);
  };
  const flushReleases = () => {
    for (const [kind, c] of pendingRelease) { if (kind === 'key') key(c, false); else mouse(c, false); }
    pendingRelease = [];
  };

  function aimAt(g, target) {
    const p = g.player;
    const eye = [p.pos[0], p.pos[1] + 1.6, p.pos[2]];
    const dx = target[0] - eye[0], dy = target[1] - eye[1], dz = target[2] - eye[2];
    const wantYaw = Math.atan2(-dx, -dz);
    const wantPitch = Math.atan2(dy, Math.hypot(dx, dz));
    const sens = 22e-4 * g.save.settings.sensitivity;
    const dYaw = angleDiff(wantYaw, p.yaw);
    const dPitch = wantPitch - p.pitch;
    const clampPx = (v) => Math.max(-40, Math.min(40, v));
    look(clampPx(-dYaw / sens), clampPx(-dPitch / sens));
    return Math.hypot(dYaw, dPitch);
  }

  // Walk towards `dest` (camera faces `aimTarget`), with optional sideways dodge.
  function walk(g, dest, dodge = 0) {
    const p = g.player;
    const dx = dest[0] - p.pos[0], dz = dest[2] - p.pos[2];
    const d = Math.hypot(dx, dz);
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    const f = d > 0.05 ? (dx * fx + dz * fz) / d : 0;
    const r = d > 0.05 ? (dx * rx + dz * rz) / d : 0;
    setKey('KeyW', !dodge && d > 0.3 && f > 0.35);
    setKey('KeyS', !dodge && d > 0.3 && f < -0.35);
    setKey('KeyD', (d > 0.3 && r > 0.35) || dodge > 0);
    setKey('KeyA', (d > 0.3 && r < -0.35) || dodge < 0);
  }

  // A bullet heading for us: return which side to step to (-1 left, +1 right), else 0.
  function dodgeDir(g) {
    const p = g.player;
    const eye = [p.pos[0], p.pos[1] + 1.2, p.pos[2]];
    for (const b of g.world.projectiles) {
      if (!b.alive || b.ownerId === 0) continue;
      const v = b.vel, vl = Math.hypot(v[0], v[1], v[2]);
      const rel = [eye[0] - b.pos[0], eye[1] - b.pos[1], eye[2] - b.pos[2]];
      const along = (rel[0] * v[0] + rel[1] * v[1] + rel[2] * v[2]) / vl;
      if (along < 0 || along > 12) continue;
      const cx = b.pos[0] + v[0] / vl * along - eye[0], cz = b.pos[2] + v[2] / vl * along - eye[2];
      if (Math.hypot(cx, cz) > 0.9) continue;
      const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
      return (cx * rx + cz * rz) > 0 ? -1 : 1;
    }
    return 0;
  }

  async function playLevel(index, { timeoutMs = 120000, maxDeaths = 25 } = {}) {
    const g = window.__game;
    const log = { level: null, deaths: [], result: null, realTime: 0 };
    const proto = Object.getPrototypeOf(g.world);
    if (!proto.__wrapped) {
      const orig = proto.killPlayer;
      proto.killPlayer = function (dir) {
        if (this.player.alive && !this.player.invulnerable) {
          const pp = this.player.pos;
          const near = this.enemies.filter((e) => e.alive).map((e) => `${e.kind}@${Math.hypot(e.pos[0] - pp[0], e.pos[2] - pp[2]).toFixed(1)}m${e.weapon ? '+' + e.weapon.kind : ''}`);
          window.__autopilot.lastDeath = { simTime: +this.simTime.toFixed(2), pos: pp.map((v) => +v.toFixed(1)), near, bullet: dir[1] === 0 ? 'melee?' : 'shot' };
        }
        return orig.call(this, dir);
      };
      proto.__wrapped = true;
    }
    if (index !== null) g.ui.handlers.onPlayLevel(index);
    log.level = g.def.id;
    const t0 = performance.now();
    let lastState = '';
    while (performance.now() - t0 < timeoutMs) {
      await frame();
      flushReleases();
      const s = g.state;
      if (s !== lastState && s === 'dead') {
        log.deaths.push(window.__autopilot.lastDeath ?? { unknown: true });
        releaseAll();
        if (log.deaths.length >= maxDeaths) { log.result = 'gave up'; break; }
      }
      lastState = s;
      if (s === 'results') { log.result = 'cleared'; break; }
      if (s !== 'playing') { releaseAll(); continue; }

      const w = g.world, p = g.player, item = w.player.held;
      const enemies = w.enemies.filter((e) => e.alive && e.spawnT >= 1);
      const dist = (a) => Math.hypot(a[0] - p.pos[0], a[2] - p.pos[2]);
      const exit = g.def.exit;
      if (!enemies.length) {
        // Time only advances while we move: keep moving so spawns can finish.
        const spawning = w.enemies.find((e) => e.alive);
        if (exit) { const [x0, z0, x1, z1] = exit.rect; walk(g, [(x0 + x1) / 2, 0, (z0 + z1) / 2]); }
        else if (spawning) { aimAt(g, [spawning.pos[0], spawning.pos[1] + 1.4, spawning.pos[2]]); setKey('KeyW', false); setKey('KeyS', false); setKey('KeyA', (performance.now() / 600 | 0) % 2 === 0); setKey('KeyD', (performance.now() / 600 | 0) % 2 === 1); }
        else releaseAll();
        continue;
      }
      const visible = (e) => w.static.lineClear([p.pos[0], p.pos[1] + 1.6, p.pos[2]], [e.pos[0], e.pos[1] + 1.4, e.pos[2]]);
      enemies.sort((a, b) => (visible(b) - visible(a)) || dist(a.pos) - dist(b.pos));
      const e = enemies[0];
      const head = [e.pos[0], e.pos[1] + 1.55, e.pos[2]];
      const dodge = dodgeDir(g);
      const props = w.props.filter((pr) => pr.alive && !pr.thrown && Math.abs(pr.pos[1] - p.pos[1]) < 1.5);
      const gunProp = props.filter((pr) => GUNS.has(pr.item.kind)).sort((a, b) => dist(a.pos) - dist(b.pos))[0];
      const anyProp = props.sort((a, b) => dist(a.pos) - dist(b.pos))[0];

      if (item && GUNS.has(item.kind) && item.ammo > 0) {
        const err = aimAt(g, head);
        const strafe = (performance.now() / 400 | 0) % 2 ? 1 : -1;
        if (visible(e)) { walk(g, p.pos, dodge || (w.player.fireCooldown > 0 ? strafe : 0)); if (err < 0.03 && w.player.fireCooldown <= 0) tap('mouse', 0); }
        else walk(g, e.pos, dodge);
      } else if (item && !GUNS.has(item.kind) && item.kind !== 'blade' && dist(e.pos) < 9 && visible(e)) {
        const d = dist(e.pos), t = d / 15;
        const err = aimAt(g, [head[0], head[1] + 0.5 * 16 * t * t - 1.2 * t, head[2]]);
        walk(g, p.pos, dodge || (w.player.fireCooldown > 0 ? ((performance.now() / 400 | 0) % 2 ? 1 : -1) : 0));
        if (err < 0.03) tap('mouse', 0);
      } else if (item && GUNS.has(item.kind)) {
        aimAt(g, head); walk(g, e.pos, dodge);
        tap('mouse', 0); // empty gun: throw it (cooldowns run on sim time, so keep moving)
      } else if (!item && (gunProp && dist(gunProp.pos) < 12 || anyProp && dist(anyProp.pos) < 4 && dist(e.pos) > 3)) {
        const pr = gunProp && dist(gunProp.pos) < 12 ? gunProp : anyProp;
        aimAt(g, pr.pos);
        walk(g, pr.pos, dodge);
        if (w.aimProp === pr || dist(pr.pos) < 1.2) tap('key', 'KeyE');
      } else {
        const err = aimAt(g, [e.pos[0], e.pos[1] + 1.25, e.pos[2]]);
        // Armed enemy about to fire: sidestep instead of walking into the shot.
        const armed = e.weapon && GUNS.has(e.weapon.kind) && visible(e);
        const danger = armed && dist(e.pos) > 2 && e.aimTimer <= 0 && e.fireCooldown < 0.3;
        walk(g, e.pos, dodge || (danger ? ((performance.now() / 500 | 0) % 2 ? 1 : -1) : 0));
        if (dist(e.pos) < 1.8 && err < 0.4) tap('mouse', 0);
      }
    }
    releaseAll(); flushReleases();
    log.realTime = +((performance.now() - t0) / 1000).toFixed(1);
    if (!log.result) log.result = 'timeout';
    return log;
  }

  window.__autopilot = { playLevel, lastDeath: null };
})();
