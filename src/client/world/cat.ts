import * as THREE from 'three';
import { CAT_COATS, type CatAct, type CatState } from '../../shared/cat';
import { dogAt, legSeconds } from '../../shared/dog';
import type { Theme } from '../../shared/protocol';
import { catBow, catCape, catSantaHat, catWitchHat } from './costumes';
import type { Interactable } from './office';
import { disposeSprite, mesh, textSprite, toon, toonUnique } from './toon';
import { t } from '../i18n';

export interface CatSounds {
  meow(x: number, z: number): void;
  /** A purr for `seconds`, from where the cat is. */
  purr(x: number, z: number, seconds: number): void;
}

/** What the body eases toward for each thing it does. */
interface Pose {
  /** How far the whole cat sinks toward the floor. */
  drop: number;
  /** How far the front end tips up (sitting), or down (-, stretching). */
  sit: number;
  /** Front legs swung forward (+, lying, stretching) or tucked back under the chest (-, loafing). */
  front: number;
  /** Back legs folded forward under it. */
  rear: number;
  /** Head tipped down (+) or up (-). */
  nod: number;
  /** Eyes open (1), half shut and content, or shut (0). */
  eyes: number;
  /** How far back the tail leans from straight up: up and proud while it walks, along the floor lying. */
  tail: number;
  /** How far the tail wraps round sideways, lying or sitting. */
  curl: number;
  /** How far its tip hooks over. */
  hook: number;
}

const POSES: Record<CatAct | 'walk', Pose> = {
  walk: { drop: 0, sit: 0, front: 0, rear: 0, nod: 0, eyes: 1, tail: 0.3, curl: 0, hook: 0.45 },
  sit: { drop: 0.09, sit: 0.6, front: 0, rear: 1.4, nod: 0, eyes: 1, tail: 1.75, curl: 0.45, hook: 0 },
  purr: { drop: 0.09, sit: 0.6, front: 0, rear: 1.4, nod: -0.3, eyes: 0.3, tail: 0.35, curl: 0, hook: 0.6 },
  groom: { drop: 0.09, sit: 0.6, front: 0, rear: 1.4, nod: 0.25, eyes: 0.35, tail: 1.75, curl: 0.5, hook: 0 },
  loaf: { drop: 0.13, sit: 0, front: -1.35, rear: 1.3, nod: 0, eyes: 0.55, tail: 1.85, curl: 0.55, hook: 0 },
  nap: { drop: 0.14, sit: 0, front: 1.45, rear: 1.3, nod: 0.45, eyes: 0, tail: 1.9, curl: 0.85, hook: 0 },
  stretch: { drop: 0.02, sit: -0.4, front: 1.05, rear: 0, nod: -0.25, eyes: 0.25, tail: 0.35, curl: 0, hook: 0.3 },
};

/** Where the torso hinges (at the back hips), above the floor when standing. */
const HIP_Y = 0.2;
const HIP_Z = -0.12;
/** The front shoulders, from the hinge. */
const SHOULDER: [number, number] = [-0.01, 0.34];
const LEG = 0.19;
const HEAD_Y = 0.17;
const TAIL_SEGMENTS = 4;
const TAIL_SEG = 0.075;
/** How long it purrs for each pat (about as long as the server keeps it there). */
const PURR_S = 3.2;

/**
 * The office cat, as everyone on the floor sees it: a small cartoon cat with pointy ears, whiskers
 * and a long tail. It walks where the server says (see shared/cat.ts), sits, loafs with its paws
 * tucked in, curls up to nap, washes a paw, has a good stretch, and purrs when it's petted. Forward is +z.
 */
export class Cat {
  readonly root = new THREE.Group();
  readonly interactable: Interactable = { kind: 'cat', x: 0, z: 0, radius: 1.2 };
  private hips = new THREE.Group();
  private torso = new THREE.Group();
  private head = new THREE.Group();
  private tail: THREE.Group[] = [];
  private legs: { front: THREE.Group[]; rear: THREE.Group[] } = { front: [], rear: [] };
  private ears: THREE.Group[] = [];
  private eyes: THREE.Group[] = [];
  private coatMats: [THREE.MeshToonMaterial, THREE.MeshToonMaterial, THREE.MeshToonMaterial];
  private coat = -1;
  private tag: THREE.Sprite | null = null;
  private tagName = '';
  private bubble: { sprite: THREE.Sprite; kind: string; until: number } | null = null;

  private state: CatState | null = null;
  /** performance.now() when the current leg began. */
  private start = 0;
  private arriveAt = 0;
  private pose: Pose = { ...POSES.nap };
  private phase = 0;
  private t = 0;
  private placed = false;
  /** Dressed up for a holiday (see setCostume): what it's wearing, and its witch's cape. */
  private costume: Theme | null = null;
  private outfit: THREE.Object3D[] = [];
  private cape: THREE.Object3D | null = null;

  constructor(private sounds: CatSounds) {
    this.coatMats = [toonUnique(CAT_COATS[0][0]), toonUnique(CAT_COATS[0][1]), toonUnique(CAT_COATS[0][2])];
    this.build();
    this.root.visible = false;
    this.root.userData.interact = this.interactable;
  }

  /**
   * Dresses it up for a holiday: a witch's hat and a cape that flutters behind it for Halloween, a
   * Santa hat and a red bow on its collar for Christmas. Null takes it all off.
   */
  setCostume(theme: Theme | null) {
    if (theme === this.costume) return;
    this.costume = theme;
    for (const o of this.outfit) {
      o.removeFromParent();
      o.traverse((m) => (m as THREE.Mesh).geometry?.dispose());
    }
    // The cape's material is its own; the rest are shared toon ones.
    this.cape?.traverse((m) => ((m as THREE.Mesh).material as THREE.Material | undefined)?.dispose());
    this.outfit = [];
    this.cape = null;
    const wear = (parent: THREE.Object3D, o: THREE.Object3D) => {
      o.traverse((m) => ((m as THREE.Mesh).castShadow = true));
      parent.add(o);
      this.outfit.push(o);
    };
    if (theme === 'halloween') {
      wear(this.head, catWitchHat());
      const c = catCape();
      wear(this.torso, c.group);
      this.cape = c.cape;
    } else if (theme === 'christmas') {
      wear(this.head, catSantaHat());
      wear(this.head, catBow());
    }
  }

  /** Nothing to pet in a building without floors. */
  get interactables(): Interactable[] {
    return this.state ? [this.interactable] : [];
  }

  get name(): string {
    return this.state?.name ?? '';
  }

  /** A new leg of its day from the server; `start` is when it began, on performance.now()'s clock. */
  sync(state: CatState | null, start: number) {
    this.state = state;
    this.start = start;
    this.root.visible = !!state;
    if (!state) {
      this.placed = false;
      return;
    }
    if (state.coat !== this.coat) {
      this.coat = state.coat;
      CAT_COATS[state.coat % CAT_COATS.length].forEach((c, i) => this.coatMats[i].color.set(c));
    }
    if (state.name !== this.tagName) this.setTag(state.name);
    this.arriveAt = start + legSeconds(state) * 1000;
    // Just petted (not a pat from before this page loaded).
    if (state.act === 'purr' && state.petBy && performance.now() - start < 1000) {
      const p = dogAt(state, 0);
      this.sounds.purr(p.x, p.z, PURR_S);
      if (Math.random() < 0.5) this.sounds.meow(p.x, p.z);
      this.say('purr', `❤️ ${t('world.catPurr')}`, PURR_S);
    }
  }

  /** What it's up to, for the hint bar: "curled up asleep". */
  doing(): string {
    const s = this.state;
    if (!s) return '';
    if (performance.now() < this.arriveAt) {
      if (s.speed > 2) return t('world.catDashing');
      return t(s.act === 'nap' ? 'world.catOffToNap' : 'world.catStrolling');
    }
    switch (s.act) {
      case 'purr':
        return s.petBy ? t('world.catPurringAt', { who: s.petBy }) : t('world.catPurring');
      case 'nap':
        return t('world.catNapping');
      case 'loaf':
        return t('world.catLoafing');
      case 'groom':
        return t('world.catGrooming');
      case 'stretch':
        return t('world.catStretching');
      case 'sit':
        return t('world.catSitting');
      default:
        return '';
    }
  }

  update(dt: number) {
    const s = this.state;
    if (!s) return;
    this.t += dt;
    const now = performance.now();
    const at = dogAt(s, (now - this.start) / 1000);
    const pos = this.root.position;
    if (!this.placed || Math.hypot(pos.x - at.x, pos.z - at.z) > 3) {
      pos.set(at.x, 0, at.z);
      this.root.rotation.y = at.heading;
      this.placed = true;
    } else {
      const k = 1 - Math.exp(-dt * 12);
      pos.x += (at.x - pos.x) * k;
      pos.z += (at.z - pos.z) * k;
      let turn = at.heading - this.root.rotation.y;
      turn = Math.atan2(Math.sin(turn), Math.cos(turn));
      this.root.rotation.y += turn * (1 - Math.exp(-dt * 9));
    }
    this.interactable.x = pos.x;
    this.interactable.z = pos.z;
    this.animate(dt, at.moving ? 'walk' : s.act, at.moving ? s.speed : 0);
  }

  // ---- The model ----------------------------------------------------------------------------------

  private build() {
    const [fur, light, pink] = this.coatMats;
    const ink = toon('#1d1d1d');
    this.root.add(this.hips);
    this.hips.add(this.torso);
    this.torso.position.set(0, HIP_Y, HIP_Z);

    const body = mesh(new THREE.CapsuleGeometry(0.09, 0.24, 6, 14), fur, 0, 0.03, 0.15);
    body.rotation.x = Math.PI / 2;
    this.torso.add(body);
    const belly = mesh(new THREE.SphereGeometry(0.08, 12, 10), light, 0, -0.02, 0.27);
    belly.scale.set(0.95, 1, 0.8);
    this.torso.add(belly);

    // Head, looking down +z: round, with a little muzzle, pointy ears and whiskers.
    this.head.position.set(0, HEAD_Y, 0.35);
    this.torso.add(this.head);
    const skull = mesh(new THREE.SphereGeometry(0.1, 18, 14), fur);
    skull.scale.set(1.08, 0.95, 0.95);
    this.head.add(skull);
    for (const sx of [-1, 1]) {
      const cheek = mesh(new THREE.SphereGeometry(0.037, 10, 8), light, sx * 0.03, -0.032, 0.075);
      cheek.scale.set(1, 0.8, 0.9);
      this.head.add(cheek);
    }
    this.head.add(mesh(new THREE.SphereGeometry(0.016, 8, 6), pink, 0, -0.008, 0.1, false));
    for (const sx of [-1, 1]) {
      // Green eyes with slit pupils (black ones alone would vanish on a black cat).
      const eye = new THREE.Group();
      eye.position.set(sx * 0.042, 0.02, 0.083);
      const iris = mesh(new THREE.SphereGeometry(0.021, 10, 8), toon('#a6d65a'), 0, 0, 0, false);
      iris.scale.set(0.95, 1, 0.7);
      eye.add(iris);
      const pupil = mesh(new THREE.SphereGeometry(0.016, 8, 6), ink, 0, 0, 0.007, false);
      pupil.scale.set(0.35, 1.05, 0.7);
      eye.add(pupil);
      this.eyes.push(eye);
      this.head.add(eye);
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.055, 0.07, -0.005);
      pivot.rotation.z = -sx * 0.35;
      const ear = mesh(new THREE.ConeGeometry(0.038, 0.08, 4), fur, 0, 0.035, 0);
      ear.rotation.y = Math.PI / 4;
      ear.scale.set(1, 1, 0.5);
      pivot.add(ear);
      const inner = mesh(new THREE.ConeGeometry(0.024, 0.052, 4), pink, 0, 0.028, 0.012, false);
      inner.rotation.y = Math.PI / 4;
      inner.scale.set(1, 1, 0.35);
      pivot.add(inner);
      this.ears.push(pivot);
      this.head.add(pivot);
      for (const dy of [-0.012, 0.004]) {
        const whisker = mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.11, 4), toon('#e8e8e8'), sx * 0.085, -0.03 + dy, 0.085, false);
        whisker.rotation.z = Math.PI / 2 + sx * dy * 8;
        whisker.rotation.y = -sx * 0.35;
        this.head.add(whisker);
      }
    }
    const collar = mesh(new THREE.TorusGeometry(0.07, 0.014, 6, 18), toon('#4cc9f0'), 0, -0.075, -0.035, false);
    collar.rotation.x = Math.PI / 2 + 0.5;
    this.head.add(collar);
    this.head.add(mesh(new THREE.SphereGeometry(0.018, 10, 8), toon('#ffd166', { emissive: '#5a4300' }), 0, -0.1, 0.02, false));

    // Tail: a chain of segments from the base, so it can stand up, hook over at the tip, or wrap round.
    let parent: THREE.Object3D = this.torso;
    for (let i = 0; i < TAIL_SEGMENTS; i++) {
      const seg = new THREE.Group();
      if (i === 0) seg.position.set(0, 0.04, -0.07);
      else seg.position.y = TAIL_SEG;
      const r = 0.022 - i * 0.002;
      seg.add(mesh(new THREE.CapsuleGeometry(r, TAIL_SEG - r, 4, 8), fur, 0, TAIL_SEG / 2, 0));
      parent.add(seg);
      this.tail.push(seg);
      parent = seg;
    }

    const leg = (parent: THREE.Group, x: number, y: number, z: number, r: number) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);
      pivot.add(mesh(new THREE.CapsuleGeometry(r, LEG - 2 * r - 0.02, 4, 8), fur, 0, -(LEG - 0.02) / 2, 0));
      const paw = mesh(new THREE.SphereGeometry(0.032, 10, 8), light, 0, -LEG + 0.02, 0.012);
      paw.scale.set(1, 0.7, 1.2);
      pivot.add(paw);
      parent.add(pivot);
      return pivot;
    };
    for (const sx of [-1, 1]) {
      this.legs.front.push(leg(this.torso, sx * 0.05, SHOULDER[0], SHOULDER[1], 0.028));
      this.legs.rear.push(leg(this.hips, sx * 0.058, HIP_Y + SHOULDER[0], HIP_Z, 0.036));
    }
    this.root.traverse((o) => ((o as THREE.Mesh).castShadow = true));
  }

  private setTag(name: string) {
    this.tagName = name;
    if (this.tag) {
      this.root.remove(this.tag);
      disposeSprite(this.tag);
    }
    this.tag = textSprite(`🐱 ${name}`, { bg: '#fffaf3', size: 30 });
    this.tag.position.y = 0.75;
    this.root.add(this.tag);
  }

  /** A bubble over its head for a moment: ❤️ Purr…, 💤. */
  private say(kind: string, text: string, seconds: number) {
    if (this.bubble?.kind === kind && this.bubble.sprite.userData.text === text) {
      this.bubble.until = this.t + seconds;
      return;
    }
    this.hush();
    const sprite = textSprite(text, { bg: '#ffffff', size: 34 });
    sprite.userData.text = text;
    this.root.add(sprite);
    this.bubble = { sprite, kind, until: this.t + seconds };
  }

  private hush() {
    if (!this.bubble) return;
    this.root.remove(this.bubble.sprite);
    disposeSprite(this.bubble.sprite);
    this.bubble = null;
  }

  private animate(dt: number, act: CatAct | 'walk', speed: number) {
    const target = POSES[act];
    const k = 1 - Math.exp(-dt * 6);
    const p = this.pose;
    for (const key of Object.keys(p) as (keyof Pose)[]) p[key] += (target[key] - p[key]) * k;
    const t = this.t;

    // Gait: a soft-footed walk, diagonal legs together; a bounding run when it bolts.
    const walking = act === 'walk';
    if (walking) this.phase += dt * (6 + speed * 5);
    const stride = walking ? Math.min(0.85, 0.4 + speed * 0.15) : 0;
    const swing = Math.sin(this.phase) * stride;
    this.hips.position.y = -p.drop + (walking ? Math.abs(Math.sin(this.phase)) * 0.02 : 0);
    this.torso.rotation.x = -p.sit;

    // Front legs stay upright when it sits (and stretch to reach the floor); lying, they reach forward.
    const shoulderY = HIP_Y - p.drop + SHOULDER[0] * Math.cos(p.sit) + SHOULDER[1] * Math.sin(p.sit);
    const reach = THREE.MathUtils.clamp(shoulderY / (HIP_Y + SHOULDER[0]), 0.3, 2.2);
    const [fl, fr] = this.legs.front;
    const [rl, rr] = this.legs.rear;
    // Washing: one front paw comes up to its mouth and back, over and over.
    const lick = act === 'groom' ? 0.9 + Math.sin(t * 5) * 0.25 : 0;
    fl.rotation.x = p.sit - p.front + swing - lick;
    fr.rotation.x = p.sit - p.front - swing;
    for (const f of this.legs.front) f.scale.y = THREE.MathUtils.lerp(reach, 1, Math.min(1, Math.abs(p.front) / POSES.nap.front));
    rl.rotation.x = -p.rear - swing;
    rr.rotation.x = -p.rear + swing;

    // Head: level when sitting, down to its paw washing, nuzzling up into a pat, tucked in asleep.
    const grooming = act === 'groom';
    this.head.rotation.x = p.sit * 0.85 + p.nod + (grooming ? Math.sin(t * 5) * 0.12 : 0);
    this.head.position.y = HEAD_Y - p.nod * 0.05 - (act === 'nap' ? 0.04 : 0);
    this.head.rotation.y = act === 'purr' ? Math.sin(t * 1.6) * 0.18 : grooming ? -0.25 : act === 'loaf' ? Math.sin(t * 0.3) * 0.35 : 0;
    this.head.rotation.z = act === 'purr' ? Math.sin(t * 1.1) * 0.15 : 0;

    // Ears: a twitch now and then; flat and happy while it purrs.
    const twitch = t % 5.7 < 0.15 ? 0.3 : 0;
    this.ears.forEach((e, i) => {
      const sx = i ? 1 : -1;
      e.rotation.z = -sx * (0.35 + (act === 'purr' ? 0.25 : 0) + (i ? twitch : 0));
    });

    // Eyes: shut asleep, half shut and content, or a slow blink now and then.
    const blink = p.eyes > 0.5 && t % 5.1 < 0.14 ? 0.1 : p.eyes;
    for (const e of this.eyes) e.scale.y = Math.max(0.1, blink);

    // Tail: up and swaying while it walks, a slow flick round its feet sitting, a happy quiver purring.
    const sway = walking ? Math.sin(this.phase * 0.5) * 0.25 : act === 'purr' ? Math.sin(t * 18) * 0.05 : act === 'nap' ? 0 : Math.sin(t * 1.3) * 0.12;
    this.tail.forEach((seg, i) => {
      if (i === 0) {
        seg.rotation.x = -p.tail;
        seg.rotation.z = sway;
      } else {
        seg.rotation.x = i === TAIL_SEGMENTS - 1 ? p.hook : p.hook * 0.3;
        seg.rotation.z = p.curl + sway * (0.5 + i * 0.3);
      }
    });
    // The witch's cape billows out behind it on the move, and settles over it at rest.
    if (this.cape) this.cape.rotation.x = walking ? 0.12 + Math.min(0.35, speed * 0.12) + Math.sin(this.phase * 2) * 0.06 : Math.sin(t * 1.2) * 0.02;
    // Breathing, and a rumble through its body while it purrs.
    this.torso.scale.setScalar(act === 'nap' ? 1 + Math.sin(t * 2) * 0.025 : act === 'purr' ? 1 + Math.sin(t * 50) * 0.006 : 1);

    // Bubbles: 💤 while it naps, gone when it's up.
    if (act === 'nap' && !this.bubble) this.say('nap', '💤', 1e9);
    if (this.bubble) {
      const b = this.bubble;
      if ((b.kind === 'nap' && act !== 'nap') || this.t > b.until) this.hush();
      else {
        const rise = b.kind === 'purr' ? (1 - (b.until - this.t) / PURR_S) * 0.3 : Math.sin(t * 2) * 0.03;
        b.sprite.position.y = 0.98 - p.drop + rise;
      }
    }
    if (this.tag) this.tag.position.y = 0.75 - p.drop * 0.8;
  }
}
