import * as THREE from 'three';
import type { BunkerContext, BunkerPart } from './index';
import { Kit, disposeGeometries, merge } from './furniture-parts/kit';
import { cableReel, campKitchen, chesterfield, crateDesk, duffel, foldingChair, mapTable, mapDrum, officerDesk, ruggedFrame, steelLectern, workbench, workshopChair } from './furniture-parts/models';

// The bunker's furniture: the same seats in the same places, in bunker style.
//  - Desks: worn wooden workbenches on steel trestles, each with a clamp work lamp, in place of each
//    desk's furniture (look.seats.get(id).furniture); the laptop anchor, the worker's seat and the
//    vacancy marker stay the office's (they're not in the handles).
//  - Chairs: old leather-and-steel workshop chairs, built under DeskView.chair so they turn as people
//    sit (and spin off with whoever's leaving); metal folding chairs round the war room's table.
//  - The bean bags (army duffel bags with a supply crate for a lap desk, also under DeskView.chair, so
//    they come out and go away with the office's) and the board agents' kiosks (steel lecterns, their
//    signs kept).
//  - The meeting room as a war room: a big map table (a city map, pins and string) in place of
//    look.meeting.table, and a drum of rolled-up maps in the corner.
//  - The loft: an officer's steel desk and a workshop chair for the boss, and a small chesterfield.
//  - The lounge: a worn leather chesterfield, duffel bags for its bean bags, a cable reel for a
//    coffee table, and a camp kitchen.
//  - Screens keep showing, only what's round them changes: rugged steel cases with cables round the TV,
//    the machine monitor and the boss's screen, riveted steel frames round the boards.
// It's all built when the bunker comes on and disposed of when it goes off, so the office pays nothing
// for it, and switching back and forth leaves nothing behind.
// Keep every collider, seat and interactable as it is: build to the same footprints (shared/layout.ts
// via ctx.layout: DESKS, DESK_SIZE, MEETING_TABLE, MEETING_SEATS, LOFT, TV…).
// Not here: walls, floor, ceiling, windows, lights (shell.ts), loose props and signs (props.ts),
// sound and effects (atmosphere.ts).

/** The meshes under `obj` that aren't text or pictures (a sign's plane has a map): what a frame or a desk is made of. */
function plainMeshes(obj: THREE.Object3D, except: THREE.Object3D[] = []): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || except.includes(m)) return;
    const mat = m.material as THREE.MeshBasicMaterial;
    if (!Array.isArray(mat) && mat.map) return;
    out.push(m);
  });
  return out;
}

/** Those of `meshes` whose own seat (an ancestor's `userData.interact.seatId`) is `seatId`. */
function ofSeat(meshes: THREE.Mesh[], seatId: string): THREE.Mesh[] {
  return meshes.filter((m) => {
    for (let o: THREE.Object3D | null = m; o; o = o.parent) if (o.userData.interact?.seatId === seatId) return true;
    return false;
  });
}

/**
 * Builds the bunker's desks, chairs, meeting room and lounge (when it comes on), and says which office
 * furniture they replace.
 */
export function buildFurniture(ctx: BunkerContext): BunkerPart {
  const { office, look, layout } = ctx;

  // The office's own frames round its screens and boards: the screens stay, these go.
  const frameOf = (screen: THREE.Mesh) => screen.parent!.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh && c !== screen);
  const machineFrame = frameOf(office.machineScreen);
  const boardFrames = Object.values(office.boardMeshes).map((face) => ({ face, frame: frameOf(face) }));
  const meetingFrame = frameOf(office.meetingBoard);
  // The boss's desk upstairs: the screen's group, all but the screen and the BOSS plate.
  const bossDesk = office.bossScreen.parent!;
  const bossChair = ofSeat(look.loft, 'boss-chair');
  const bossFurniture = plainMeshes(bossDesk, [office.bossScreen]).filter((m) => !bossChair.includes(m));
  const loftCouch = ofSeat(look.loft, 'loft-couch');

  const hideOffice: THREE.Mesh[] = [];
  for (const [, s] of look.seats) hideOffice.push(...s.furniture.filter((m) => !(m.material as THREE.MeshBasicMaterial).map), ...s.chair);
  hideOffice.push(...look.lounge.couch, ...look.lounge.table, ...look.lounge.beanbags, ...look.lounge.tv, ...look.lounge.kitchen, ...look.meeting.table);
  hideOffice.push(...machineFrame, ...boardFrames.flatMap((b) => b.frame), ...meetingFrame, ...bossFurniture, ...bossChair, ...loftCouch);

  /** What's built while the bunker's on: the kit, this part's group in ctx.group, and what went under the office's own chairs and bean bags. */
  let built: { kit: Kit; root: THREE.Group; under: THREE.Object3D[] } | null = null;

  const build = () => {
    const kit = new Kit();
    // Everything that stands still goes in here, and is merged into a few meshes at the end.
    const statics = new THREE.Group();
    const under: THREE.Object3D[] = [];
    /** `model` where `theirs` (a child of office.group) is: same place, same turn. */
    const placeLike = (model: THREE.Object3D, theirs: THREE.Object3D) => {
      model.position.copy(theirs.position);
      model.quaternion.copy(theirs.quaternion);
      statics.add(model);
      return model;
    };
    /** Added (merged) under one of the office's own objects (a chair, a bean bag), so it moves and shows with it. */
    const into = (parent: THREE.Object3D, model: THREE.Object3D) => {
      const child = merge(model);
      parent.add(child);
      under.push(child);
    };

    // Desks, bean bags, kiosks and the meeting chairs.
    let i = 0;
    for (const view of office.desks.values()) {
      const def = view.def;
      i++;
      if (def.station) placeLike(steelLectern(kit, layout.STATION_AGENT[def.station].color), view.group);
      else if (def.beanbag) {
        // The bean bag's own group is its chair, at the seat; the lap desk is out in front of it.
        const bag = new THREE.Group();
        bag.add(duffel(kit, i));
        const crate = crateDesk(kit);
        crate.position.z = -0.8;
        bag.add(crate);
        into(view.chair, bag);
      } else if (def.room) into(view.chair, foldingChair(kit));
      else {
        placeLike(workbench(kit, i), view.group);
        into(view.chair, workshopChair(kit, i));
      }
    }

    // The war room: the map table where the meeting table was, and a drum of maps in the corner.
    placeLike(mapTable(kit), look.meeting.table[0].parent!);
    const drum = mapDrum(kit);
    drum.position.set(layout.FLOOR.maxX - 0.5, 0, layout.FLOOR.maxZ - 0.5);
    statics.add(drum);

    // The lounge: the couch, its bean bags, the coffee table and the kitchen.
    placeLike(chesterfield(kit, 4.2), look.lounge.couch[0].parent!);
    placeLike(cableReel(kit), look.lounge.table[0].parent!);
    look.lounge.beanbags.forEach((_bean, i) => {
      const seat = layout.SEATING_BY_ID.get(`lounge-beanbag-${i + 1}`)!;
      const bag = duffel(kit, 20 + i);
      bag.position.set(seat.x, 0, seat.z);
      // The seat faces rotY; a duffel faces -z, its back rest behind it.
      bag.rotation.y = seat.rotY + Math.PI;
      statics.add(bag);
    });
    placeLike(campKitchen(kit), look.lounge.kitchen[0].parent!);

    // Screens, in rugged cases: the TV (its frame is the lounge's), the machine monitor and the boss's.
    const { TV, MACHINE_MONITOR } = layout;
    placeLike(ruggedFrame(kit, TV.width + 0.3, TV.height + 0.3, { border: 0.17, drop: 1.4 }), office.tvScreen.parent!);
    placeLike(ruggedFrame(kit, MACHINE_MONITOR.width + 0.2, MACHINE_MONITOR.height + 0.2, { border: 0.1, depth: 0.1, drop: 1.3 }), office.machineScreen.parent!);
    // The boards keep their faces; only their frames turn to riveted steel.
    for (const face of [...boardFrames.map((b) => b.face), office.meetingBoard]) {
      const { width, height } = (face.geometry as THREE.PlaneGeometry).parameters;
      placeLike(ruggedFrame(kit, width + 0.3, height + 0.3, { border: 0.15, depth: 0.12, color: '#6a6f62' }), face.parent!);
    }

    // Upstairs: the boss's officer desk with the screen in a steel case, the workshop chair, the chesterfield.
    const desk = placeLike(officerDesk(kit), bossDesk);
    const screen = office.bossScreen;
    const { width: sw, height: sh } = (screen.geometry as THREE.PlaneGeometry).parameters;
    const screenCase = ruggedFrame(kit, sw + 0.12, sh + 0.12, { border: 0.07, depth: 0.08, back: true });
    screenCase.position.set(screen.position.x, screen.position.y, screen.position.z - 0.045);
    desk.add(screenCase);
    if (bossChair.length) {
      // Where the office's chair is at the desk, as big.
      const theirs = bossChair[0].parent!;
      const chair = workshopChair(kit, 1);
      chair.position.copy(theirs.position);
      chair.scale.copy(theirs.scale);
      desk.add(chair);
    }
    if (loftCouch.length) {
      // The loft's couch is the lounge's turned round: its back to the east wall.
      const small = new THREE.Group();
      small.add(chesterfield(kit, 2.4));
      small.children[0].rotation.y = Math.PI;
      placeLike(small, loftCouch[0].parent!);
    }

    // One mesh per material for all of it. It isn't aimed at: the ray goes on to the hidden office
    // piece in the same place (hidden meshes still count for aiming), which says what it is.
    const root = merge(statics);
    root.name = 'bunker-furniture';
    root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.raycast = () => {};
    });
    ctx.group.add(root);
    built = { kit, root, under };
  };

  const teardown = () => {
    if (!built) return;
    for (const o of [built.root, ...built.under]) {
      o.removeFromParent();
      disposeGeometries(o);
    }
    built.kit.dispose();
    built = null;
  };

  return {
    hideOffice,
    set(on) {
      if (on && !built) build();
      else if (!on) teardown();
    },
    dispose() {
      teardown();
    },
  };
}
