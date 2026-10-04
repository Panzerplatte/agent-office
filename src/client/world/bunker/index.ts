import * as THREE from 'three';
import type { Office, OfficeLook } from '../office';
import type { Sky } from '../sky';
import type { OfficeSound } from '../../sound';
import * as layout from '../../../shared/layout';
import { buildShell } from './shell';
import { buildFurniture } from './furniture';
import { buildProps } from './props';
import { buildAtmosphere } from './atmosphere';

// The bunker: a floor's other look (see shared/floorstyle.ts). The same floor, with the same desks,
// seats, colliders, walkways, boards and games, dressed as a cosy underground bunker: concrete, steel,
// a vaulted ceiling, cage lamps, workbenches and crates. Only the look changes, so nothing in here
// touches Office's colliders, nav, seats or interactables.
//
// Each area of the look is built by its own file, into the bunker's group, once at startup:
//   shell.ts       walls, floor, ceiling, windows and what's outside them, the lighting
//   furniture.ts   the desks, chairs and monitors, the meeting room and the lounge, in bunker style
//   props.ts       crates, oil drums, sandbags, the workshop corner, signs, the vehicle bay…
//   atmosphere.ts  ambient sound, the switching transition, flickering lights, dust
// While the bunker's on, the office meshes the parts name in `hideOffice` are hidden and the
// materials in `reskin` changed; switching back puts every one of them exactly as it was.

/** What the bunker needs from main.ts besides the office. */
export interface BunkerDeps {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** The sky's lights: it sets them every frame (Sky.update), and a part's update runs after it, so it may scale or tint them for that frame. */
  lights: { sun: THREE.DirectionalLight; hemi: THREE.HemisphereLight; ambient: THREE.AmbientLight };
  /** For reading the time of day (lampsOn, daylight); the bunker doesn't drive it. */
  sky: Sky;
  sound: OfficeSound;
}

/** What each part's build function gets. */
export interface BunkerContext {
  /** The bunker's own group, inside office.group (so it goes with the floor, e.g. hidden on the roof and in the casino, and is aimed at like the office). Shown only while the bunker's on. Add to it, never to office.group. */
  group: THREE.Group;
  office: Office;
  /** office.look: the handles to the office's appearance (see OfficeLook in world/office.ts). */
  look: OfficeLook;
  /** The floor plan (shared/layout.ts): FLOOR, WALL_HEIGHT, WALL_T, WINDOWS, DESKS, LOFT, MEETING_ROOM… */
  layout: typeof layout;
  deps: BunkerDeps;
  /**
   * Makes `bunkerObj` stand in for `officeObj` when aiming (crosshair E): it carries the same
   * `userData.interact`. Only needed for something that covers an office interactable which is
   * itself hidden, e.g. a bunker meeting table over the hidden one.
   */
  standIn(officeObj: THREE.Object3D, bunkerObj: THREE.Object3D): void;
}

/** A material's properties to change while the bunker's on (map, color, emissive…); index.ts puts the old ones back. */
export interface Reskin {
  /** One of OfficeLook's materials (wallMat, trimMat, floorMat, ceilingMat), or another unique one: never a shared toon() material. */
  material: THREE.Material;
  props: Record<string, unknown>;
}

/** What a part's build function gives back. */
export interface BunkerPart {
  /** Office meshes this part replaces: hidden while the bunker's on (their material swapped for an invisible one), back as they were when it's off. */
  hideOffice?: THREE.Mesh[];
  /** Office materials this part changes while the bunker's on. Colors (THREE.Color) are copied in and back. */
  reskin?: Reskin[];
  /** The bunker was switched on or off (after hideOffice/reskin applied, and before the first update). */
  set?(on: boolean): void;
  /** Every frame while the bunker's on (and the floor's showing), after the sky has set its lights; `t` in seconds. */
  update?(dt: number, t: number): void;
  dispose(): void;
}

export interface Bunker {
  /** The bunker look on (true) or the office's (false). */
  set(on: boolean): void;
  readonly on: boolean;
  /** Runs `paint` (office.setLook) on the office's own look, then puts the bunker's back over it, so switching floors in the bunker doesn't lose the next floor's colors. */
  repaint(paint: () => void): void;
  /** Each frame, after the sky's update: only does anything while the bunker's on. */
  update(dt: number): void;
  dispose(): void;
  /** The bunker's group (for tests and tools). */
  group: THREE.Group;
}

/** Hidden office meshes wear this: not drawn, not in the shadows, but still hit when aiming. */
const HIDDEN = new THREE.MeshBasicMaterial({ visible: false });

export function createBunker(office: Office, deps: BunkerDeps): Bunker {
  const group = new THREE.Group();
  group.name = 'bunker';
  group.visible = false;
  office.group.add(group);
  const ctx: BunkerContext = {
    group,
    office,
    look: office.look,
    layout,
    deps,
    standIn: (from, to) => {
      for (let o: THREE.Object3D | null = from; o; o = o.parent) {
        if (o.userData.interact) {
          to.userData.interact = o.userData.interact;
          return;
        }
      }
    },
  };
  const parts = [buildShell(ctx), buildFurniture(ctx), buildProps(ctx), buildAtmosphere(ctx)];

  /** What was hidden or changed, with how it was: to put back. */
  const hidden = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const changed: { material: THREE.Material; was: Record<string, unknown> }[] = [];
  let on = false;
  let t = 0;

  const assign = (m: THREE.Material, props: Record<string, unknown>) => {
    const rec = m as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(props)) {
      const cur = rec[k];
      if (cur instanceof THREE.Color && (v instanceof THREE.Color || typeof v === 'string' || typeof v === 'number')) cur.set(v as THREE.ColorRepresentation);
      else rec[k] = v;
    }
    m.needsUpdate = true;
  };

  const apply = (up: boolean) => {
    if (up) {
      for (const p of parts) {
        for (const m of p.hideOffice ?? []) {
          if (hidden.has(m)) continue;
          hidden.set(m, m.material);
          m.material = HIDDEN;
        }
        for (const r of p.reskin ?? []) {
          const rec = r.material as unknown as Record<string, unknown>;
          const was: Record<string, unknown> = {};
          for (const k of Object.keys(r.props)) was[k] = rec[k] instanceof THREE.Color ? (rec[k] as THREE.Color).clone() : rec[k];
          changed.push({ material: r.material, was });
          assign(r.material, r.props);
        }
      }
    } else {
      for (const [m, mat] of hidden) m.material = mat;
      hidden.clear();
      // Last changed first, so two parts changing one property end up as it was before both.
      for (const { material, was } of changed.reverse()) assign(material, was);
      changed.length = 0;
    }
  };

  const set = (want: boolean) => {
    if (want === on) return;
    on = want;
    apply(on);
    group.visible = on;
    for (const p of parts) p.set?.(on);
  };

  return {
    group,
    set,
    get on() {
      return on;
    },
    repaint(paint) {
      if (on) apply(false);
      paint();
      if (on) apply(true);
    },
    update(dt: number) {
      if (!on || !office.group.visible) return;
      t += dt;
      for (const p of parts) p.update?.(dt, t);
    },
    dispose() {
      set(false);
      for (const p of parts) p.dispose();
      group.removeFromParent();
    },
  };
}
