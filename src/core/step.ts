// One step of the whole game: 1/60 s. The same code runs in the browser and headless in Node.
import { stepGuide } from './guide.ts';
import { refreshBeasts, stepAnimals } from './animals.ts';
import { give, HOTBAR, promised, take } from './bag.ts';
import { placeItem, removeAt, setBuild, stepBuild } from './build.ts';
import { stepClock } from './clock.ts';
import { count } from './cond.ts';
import { buy, craft, sell } from './craft.ts';
import { holdSkip, skipCut, stepCut } from './cutscene.ts';
import { stepFishing } from './fishing.ts';
import { free, nearestFree, rebuildArea } from './grid.ts';
import { unwear, upgrade, wear } from './gear.ts';
import { endFun, stepFunFriend } from './fun.ts';
import { autoPick, enterArea, findTarget, pickUpDrops, stepHearts, stepHero } from './hero.ts';
import { askHint, stepHelp } from './hints.ts';
import { closeMini, miniLeaves, startMini, stepMini, winMini } from './minigames.ts';
import { postRead, stepPost } from './post.ts';
import { stepPots } from './pots.ts';
import { quizPick } from './quiz.ts';
import { regionHere, stepIsland } from './island.ts';
import { makeMob, stepMobs } from './mobs.ts';
import { refreshMarks, refreshNpcs, stepNpcs } from './npcs.ts';
import {
  applyFx,
  completeStep,
  engageHere,
  finishQuest,
  place,
  pollQuests,
  refreshQuests,
  stepSayLater,
  startQuest,
  stepTarget,
} from './quests.ts';
import { choose, kindChoice, skipTalk, stepTalk } from './talk.ts';
import { moveAllowed, pinSlot, tidyBag } from './tidy.ts';
import { stepLook } from './lookout.ts';
import { visitRoom } from './rooms.ts';
import type { Cmd, Game, Input } from './types.ts';

export const NO_INPUT: Input = {
  mx: 0,
  my: 0,
  act: false,
  hold: false,
  back: false,
  use: false,
  emote: false,
  fire: false,
  holdX: false,
  cmd: null,
};

export function step(g: Game, inp: Input): void {
  const rt = g.rt;
  const s = g.s;
  rt.tick++;
  if (inp.cmd) runCmd(g, inp.cmd);
  // The Space that answered "Put it on?" is used up by the answer: it must not also swing or open a menu.
  if (inp.cmd?.c === 'wear' && inp.act) inp = { ...inp, act: false, hold: false };
  // a hint when she struggles: its clock counts only what she is doing (src/core/hints.ts)
  // (the Space that closed the hint card she asked for with H does nothing else)
  if (stepHelp(g, inp)) inp = { ...inp, act: false, hold: false, back: false, fire: false };
  if (rt.paused) {
    rt.wasPaused = true;
    return;
  }
  // a menu just closed: for a moment Space does not open a bench again (package 60: Space after crafting reopened it)
  if (rt.wasPaused) {
    rt.wasPaused = false;
    rt.shutT = 0.6;
  } else if (rt.shutT) rt.shutT = Math.max(0, rt.shutT - 1 / 60);
  s.ticks++;
  // A held direction counts once, then repeats slowly: for choices and the build cursor.
  let ex = 0;
  let ey = 0;
  if (inp.mx !== rt.navX || inp.my !== rt.navY) {
    ex = inp.mx !== rt.navX ? inp.mx : 0;
    ey = inp.my !== rt.navY ? inp.my : 0;
    rt.navX = inp.mx;
    rt.navY = inp.my;
    rt.navT = 0.28;
  } else if (inp.mx || inp.my) {
    rt.navT -= 1 / 60;
    if (rt.navT <= 0) {
      ex = inp.mx;
      ey = inp.my;
      rt.navT = 0.09;
    }
  }
  if (rt.nudgeT > 0) rt.nudgeT -= 1 / 60;
  // A held X skips a scene, also while one of its lines is up (a line puts the scene in talk mode).
  if (rt.cut) holdSkip(g, !!inp.holdX);
  else {
    rt.skip = 0;
    if (!inp.holdX) rt.skipHeld = false;
  }
  // package 73a: looking out over the island from a telescope or a window: the world waits until it ends
  if (rt.look && stepLook(g, inp)) return;
  // a talk, a scene or a menu took over in the middle of a turn on a swing: she gets off first (package 57a)
  if (rt.fun && rt.mode !== 'play') endFun(g);
  switch (rt.mode) {
    case 'talk':
      stepTalk(g, inp.act, ey, inp.back);
      stepNpcs(g);
      break;
    case 'cut':
      if (rt.talk) stepTalk(g, inp.act, ey, inp.back);
      stepCut(g, inp.act);
      break;
    case 'mini':
      if (rt.talk) stepTalk(g, inp.act, ey, inp.back);
      else stepMini(g, inp);
      break;
    case 'card': {
      const card = rt.card;
      if (!card) {
        rt.mode = 'play';
        break;
      }
      card.t += 1 / 60;
      // package 69: X closes a card as Space does
      if ((inp.act || inp.back) && card.t > 0.9) {
        rt.card = null;
        rt.mode = 'play';
        if (card.then) card.then();
      }
      break;
    }
    case 'fishing':
      stepFishing(g, inp.act, inp.back, inp.mx !== 0 || inp.my !== 0);
      stepNpcs(g);
      stepAnimals(g);
      stepClock(g);
      break;
    case 'build':
      stepBuild(g, inp, ex, ey);
      stepNpcs(g);
      stepAnimals(g);
      // a long stretch of building is saved on the same clock as play (issue 53)
      autosaveClock(g);
      break;
    default:
      if (rt.bedT) rt.bedT = Math.max(0, rt.bedT - 1 / 60);
      visitRoom(g);
      stepSayLater(g);
      stepHero(g, inp);
      stepHearts(g);
      pickUpDrops(g);
      autoPick(g);
      stepNpcs(g);
      stepFunFriend(g);
      stepAnimals(g);
      stepMobs(g);
      stepIsland(g);
      stepClock(g);
      // package 73b: her greenhouse pots grow at midday; the Post Office says when post waits
      if (rt.tick % 30 === 0) {
        stepPots(g);
        stepPost(g);
      }
      if (rt.tick % 12 === 0) pollQuests(g);
      if (rt.tick % 6 === 0) {
        const t = findTarget(g);
        rt.hint = rt.fun ? '' : t.hint;
        rt.hintObj = t.kind === 'obj' ? (t.objIndex ?? -1) : -1;
      }
      autosaveClock(g);
  }
  if (rt.dirty) {
    rt.dirty = false;
    refreshQuests(g);
    rebuildArea(g, s.area);
    if (!rt.fun && !free(g, s.area, s.x, s.y, 0.28)) {
      // Something solid appeared where she stands (a finished build site, a new wall): step her out of it.
      const out = nearestFree(g, s.area, Math.floor(s.x), Math.floor(s.y), 8);
      if (out) {
        s.x = out.x + 0.5;
        s.y = out.y + 0.5;
        rt.px = s.x;
        rt.py = s.y;
      }
    }
    // The same for her animals: a fence that appears under a chicken must not wedge it for good.
    // It is put down just outside any build site, never inside one: a pen must still be walked into.
    for (const a of s.animals) {
      if (a.area !== s.area || a.pen || free(g, a.area, a.x, a.y, 0.25)) continue;
      const sites = g.c.areas[a.area]!.sites;
      const inSite = (x: number, y: number) =>
        sites.some(
          (b) => x >= b.rect.x - 1 && y >= b.rect.y - 1 && x <= b.rect.x + b.rect.w && y <= b.rect.y + b.rect.h,
        );
      const tx = Math.floor(a.x);
      const ty = Math.floor(a.y);
      search: for (let r = 1; r <= 10; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            if (inSite(tx + dx, ty + dy) || !free(g, a.area, tx + dx + 0.5, ty + dy + 0.5, 0.25)) continue;
            a.x = tx + dx + 0.5;
            a.y = ty + dy + 0.5;
            break search;
          }
    }
    refreshNpcs(g);
    refreshBeasts(g);
    rt.questRev++;
  }
  if (rt.tick % 20 === 0 || rt.target === null) {
    followRegion(g);
    if (rt.mode === 'play') engageHere(g);
    rt.target = s.tracked ? stepTarget(g, s.tracked) : null;
    if (rt.tick % 60 === 0) refreshMarks(g);
  } else if (rt.targetUp && s.tracked && fightStep(g, s.tracked)) rt.target = stepTarget(g, s.tracked);
  if (rt.mode === 'play') stepGuide(g);
  if (rt.mode === 'play' && rt.q.length) rt.q.shift()!();
  // A scene or a talk has ended: save now that it is play again, and once more soon after in case the view was
  // busy (it skips a save asked for straight after another).
  if (rt.saveDue && rt.mode === 'play' && !rt.cut && !rt.talk) {
    rt.saveDue = false;
    rt.saveT = Math.min(rt.saveT, 2);
    g.ev.push({ t: 'save' });
  }
}

/** The autosave: once a minute of play or building. */
function autosaveClock(g: Game): void {
  g.rt.saveT -= 1 / 60;
  if (g.rt.saveT <= 0) {
    g.rt.saveT = 60;
    g.ev.push({ t: 'save' });
  }
}

/** Is this quest's current step a fight? (the star then follows its enemy every step) */
function fightStep(g: Game, qid: string): boolean {
  const q = g.s.quests[qid];
  return !!q && !q.done && g.c.quests[qid]?.steps[q.step]?.t === 'defeat';
}

/**
 * The goal shown is the goal of the place she is in (package 46): walking into a region whose main chapter is open
 * tracks that chapter. Only on the way in, so a quest she picks in the quest book stays until she walks somewhere new.
 */
function followRegion(g: Game): void {
  const rt = g.rt;
  if (rt.mode !== 'play') return;
  const r = regionHere(g);
  if (!r || r === rt.here) return;
  rt.here = r;
  // the goal line never leaves a quest she is on while it has a step left (package 53a)
  const on = g.s.tracked ? g.s.quests[g.s.tracked] : undefined;
  if (on && !on.done) return;
  for (const id of g.c.questOrder) {
    const def = g.c.quests[id]!;
    const q = g.s.quests[id];
    if (def.kind === 'main' && def.region === r && q && !q.done) {
      g.s.tracked = id;
      return;
    }
  }
}

export function runCmd(g: Game, cmd: Cmd): void {
  const s = g.s;
  switch (cmd.c) {
    case 'craft':
      craft(g, cmd.recipe, cmd.times ?? 1);
      return;
    case 'hot':
      if (cmd.i >= 0 && cmd.i < HOTBAR) s.hot = cmd.i;
      return;
    case 'move': {
      const a = s.bag[cmd.from] ?? null;
      const b = s.bag[cmd.to] ?? null;
      if (cmd.from === cmd.to || cmd.from < 0 || cmd.to < 0 || cmd.from >= s.bag.length || cmd.to >= s.bag.length)
        return;
      // package 74 (I11): a pinned thing stays on its button
      if (!moveAllowed(g, cmd.from, cmd.to)) return;
      if (a && b && a.id === b.id) {
        const max = g.c.items[a.id]!.stack ?? 99;
        const t = Math.min(a.n, max - b.n);
        b.n += t;
        a.n -= t;
        if (a.n === 0) s.bag[cmd.from] = null;
      } else {
        s.bag[cmd.from] = b;
        s.bag[cmd.to] = a;
      }
      return;
    }
    case 'chest': {
      const chest = s.chests[cmd.chest];
      if (!chest) return;
      const src = cmd.toChest ? s.bag : chest;
      const dst = cmd.toChest ? chest : s.bag;
      const sl = src[cmd.from];
      if (!sl) return;
      const max = g.c.items[sl.id]!.stack ?? 99;
      for (let i = 0; i < dst.length && sl.n > 0; i++) {
        const d = dst[i];
        if (d && d.id === sl.id && d.n < max) {
          const t = Math.min(sl.n, max - d.n);
          d.n += t;
          sl.n -= t;
        }
      }
      for (let i = 0; i < dst.length && sl.n > 0; i++)
        if (!dst[i]) {
          dst[i] = { id: sl.id, n: sl.n };
          sl.n = 0;
        }
      if (sl.n === 0) src[cmd.from] = null;
      g.ev.push({ t: 'sfx', id: 'tick' });
      return;
    }
    case 'drop': {
      const sl = s.bag[cmd.slot];
      if (!sl) return;
      s.bag[cmd.slot] = null;
      s.drops.push({
        area: s.area,
        x: s.x + (s.dir === 'left' ? -1.2 : s.dir === 'right' ? 1.2 : 0),
        y: s.y + (s.dir === 'up' ? -1.2 : s.dir === 'down' ? 1.2 : 0),
        id: sl.id,
        n: sl.n,
        put: true,
      });
      return;
    }
    case 'eat': {
      const sl = s.bag[cmd.slot];
      const heal = sl ? g.c.items[sl.id]!.heal : 0;
      if (!sl || !heal || s.hp >= s.maxHp) return;
      if (count(g, sl.id) <= promised(g, sl.id)) {
        g.ev.push({ t: 'toast', kind: 'info', text: 'keep_that' });
        return;
      }
      take(g, sl.id, 1);
      s.hp = Math.min(s.maxHp, s.hp + heal);
      g.ev.push({ t: 'sfx', id: 'eat' });
      return;
    }
    case 'track':
      if (s.quests[cmd.quest] && !s.quests[cmd.quest]!.done) {
        s.tracked = cmd.quest;
        g.rt.target = null;
        g.rt.questRev++;
      }
      return;
    case 'build':
      setBuild(g, cmd.on);
      return;
    case 'bsel':
      if (g.rt.build) g.rt.build.sel = Math.max(0, g.rt.build.sel + cmd.d);
      return;
    case 'place':
      placeItem(g, cmd.item, cmd.x, cmd.y, cmd.rot ?? 0, cmd.text);
      return;
    case 'remove':
      removeAt(g, cmd.x, cmd.y);
      return;
    case 'buy':
      buy(g, cmd.stall, cmd.i, cmd.n ?? 1);
      return;
    case 'sell':
      sell(g, cmd.slot, cmd.n ?? 1);
      return;
    case 'travel': {
      if (!s.signs.includes(cmd.sign)) return;
      const p = place(g, 'sign_' + cmd.sign);
      if (!p) return;
      enterArea(g, p.area, p.x + 0.5, p.y + 0.5, 'down');
      g.ev.push({ t: 'act', kind: 'travel', id: cmd.sign });
      return;
    }
    case 'hero':
      if (!s.heroes.includes(cmd.id) || cmd.id === s.hero) return;
      s.hero = cmd.id;
      g.rt.dirty = true;
      g.ev.push({ t: 'sfx', id: 'sparkle' });
      g.ev.push({ t: 'fx', id: 'sparkle', x: s.x, y: s.y, n: 8 });
      g.ev.push({ t: 'act', kind: 'hero', id: cmd.id });
      return;
    case 'koala':
      // The koala is always Koala (phase 2, part A): nobody is named by the player.
      return;
    case 'sleep':
      return;
    case 'read': {
      // package 73b: a note in "Your post" at the Post Office
      if (cmd.letter.startsWith('post:')) {
        postRead(g, cmd.letter);
        return;
      }
      const i = s.inbox.indexOf(cmd.letter);
      if (i < 0) return;
      s.inbox.splice(i, 1);
      if (!s.letters.includes(cmd.letter)) s.letters.push(cmd.letter);
      const gift = g.c.letters[cmd.letter]?.gift;
      if (gift) applyFx(g, { give: gift });
      g.ev.push({ t: 'act', kind: 'letter', id: cmd.letter });
      g.rt.dirty = true;
      return;
    }
    case 'choose':
      // package 73b: a tap on an answer in the school quiz
      if (g.rt.mini?.game === 'quiz') quizPick(g, cmd.i);
      else choose(g, cmd.i);
      return;
    case 'opt':
      (s.opts as any)[cmd.key] = cmd.value;
      return;
    case 'accept':
      startQuest(g, cmd.quest, true);
      return;
    case 'signtext': {
      const p = s.placed.find((x) => x.k === cmd.k);
      if (p) p.text = cmd.text.slice(0, 40);
      return;
    }
    case 'name': {
      const a = s.animals.find((x) => x.k === cmd.k);
      if (a) a.name = cmd.name.trim().slice(0, 12);
      return;
    }
    case 'photo':
      if (!s.flags.photo) give(g, 'photo_frame', 1);
      s.flags.photo = 1;
      s.counts.photo = cmd.friends.length;
      cmd.friends.forEach((f, i) => {
        s.flags['photo:' + i + ':' + f] = 1;
      });
      return;
    case 'wear':
      wear(g, cmd.item);
      return;
    case 'unwear':
      unwear(g, cmd.slot);
      return;
    case 'upgrade':
      upgrade(g, cmd.item);
      return;
    case 'debug':
      debug(g, cmd.what, cmd.arg);
      return;
    case 'hint':
      askHint(g);
      return;
    case 'tidy':
      tidyBag(g);
      return;
    case 'pin':
      pinSlot(g, cmd.slot);
      return;
    case 'back':
      kindBack(g);
      return;
  }
}

/** Test and debug hooks. Never bound to a key in the release build. */
function debug(g: Game, what: string, arg?: string | number): void {
  const s = g.s;
  switch (what) {
    case 'give': {
      const [id, n] = String(arg).split(':');
      applyFx(g, { give: { [id!]: Number(n ?? 1) } });
      return;
    }
    case 'tp': {
      const p = place(g, String(arg));
      if (p) enterArea(g, p.area, p.x + 0.5, p.y + 0.5, 'down');
      return;
    }
    case 'time':
      s.time = Number(arg);
      g.rt.dirty = true;
      return;
    case 'flag':
      applyFx(g, { flags: [String(arg)] });
      return;
    case 'quest':
      startQuest(g, String(arg));
      return;
    case 'step':
      completeStep(g, String(arg));
      return;
    case 'finish': {
      const id = String(arg);
      if (!s.quests[id]) startQuest(g, id);
      const def = g.c.quests[id]!;
      let guard = 0;
      while (s.quests[id] && !s.quests[id]!.done && s.quests[id]!.step < def.steps.length && guard++ < 99)
        completeStep(g, id);
      if (s.quests[id] && !s.quests[id]!.done) finishQuest(g, id);
      return;
    }
    case 'skip':
      skipTalk(g);
      if (g.rt.cut) skipCut(g);
      if (g.rt.mini) winMini(g, Number(arg ?? 3));
      if (g.rt.card) {
        const c = g.rt.card;
        g.rt.card = null;
        g.rt.mode = 'play';
        if (c.then) c.then();
      }
      return;
    case 'heal':
      s.hp = s.maxHp;
      return;
    case 'spawn': {
      // "zombie:20": mobs in a ring round her, for the stress scene
      const [id, n] = String(arg).split(':');
      for (let i = 0; i < Number(n ?? 1); i++) {
        const a = (i / Number(n ?? 1)) * Math.PI * 2;
        const m = makeMob(g, id!, s.x + Math.cos(a) * (4 + (i % 3)), s.y + Math.sin(a) * (3 + (i % 2)));
        m.tag = 'story';
        m.calm = true;
      }
      return;
    }
    case 'crowd': {
      // n walking, talking friends round her, for the stress scene
      const ids = Object.keys(g.c.chars).filter((c) => g.c.chars[c]!.role !== 'boss' && c !== s.hero);
      for (let i = 0; i < Number(arg ?? 25); i++) {
        const a = (i / Number(arg ?? 25)) * Math.PI * 2;
        const x = s.x + Math.cos(a) * (3 + (i % 4));
        const y = s.y + Math.sin(a) * (2 + (i % 3));
        g.rt.npcs.push({
          k: g.rt.nextK++,
          id: ids[i % ids.length]!,
          kind: 'npc',
          area: s.area,
          x,
          y,
          px: x,
          py: y,
          dir: 'down',
          clip: i % 3 ? 'walk' : 'talk',
          ct: i * 0.1,
          hx: x,
          hy: y,
          roam: 0,
          path: null,
          pi: 0,
          wait: 999,
          mark: 0,
          talkT: 9999,
        });
      }
      return;
    }
    case 'mini':
      // with a game name it starts that game (for the bots and for looking at a game); with none it closes one
      // ("targets@3" plays it for the gold cup)
      if (arg) {
        const [game, cup] = String(arg).split('@');
        startMini(g, game!, null, '', Number(cup ?? 0) || 0);
      } else closeMini(g);
      return;
    case 'hero':
      if (!s.heroes.includes(String(arg))) s.heroes.push(String(arg));
      s.hero = String(arg);
      g.rt.dirty = true;
      return;
  }
}

/**
 * Package 69: Escape (the view sends it): on a mini-game's start card, "Not now" (she leaves without playing); on its
 * end card, done; on a question, the kind answer; on a card, close it.
 */
function kindBack(g: Game): void {
  const t = g.rt.talk;
  if (t) {
    if (t.choices && t.shown >= t.text.length) {
      const k = kindChoice(t.lines[t.i]);
      if (k >= 0) choose(g, k);
    }
    return;
  }
  const m = g.rt.mini;
  // the start card, the end card, or a game she may leave mid-round (Hide and Seek)
  if (m && (m.st === 0 || m.st === 2 || miniLeaves(m))) {
    if (m.t > 0.3) closeMini(g);
    return;
  }
  const c = g.rt.card;
  if (c && g.rt.mode === 'card' && c.t > 0.9) {
    g.rt.card = null;
    g.rt.mode = 'play';
    if (c.then) c.then();
  }
}
