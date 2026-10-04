import type { BunkerContext, BunkerPart } from './index';

// The bunker's furniture: the same seats in the same places, in bunker style.
//  - Desks: worn wooden workbenches / steel desks in place of each desk's furniture
//    (look.seats.get(id).furniture), with chunky old monitors or field-radio style gear; the laptop
//    anchor, the worker's seat and the vacancy marker stay the office's (they're not in the handles).
//  - Chairs: stools / ammo-box seats / old office chairs in place of look.seats.get(id).chair. Add a
//    bunker chair under DeskView.chair (office.desks.get(id).chair) so it turns as people sit.
//  - The bean bags and board agents' kiosks (also in look.seats), the meeting room (look.meeting.room:
//    a war room with the big map table in place of look.meeting.table — use ctx.standIn so aiming at
//    it still works) and its chairs, the loft (look.loft), and the lounge (look.lounge: couch, coffee
//    table, bean bags, TV frame, kitchen) as a mess area.
// Keep every collider, seat and interactable as it is: build to the same footprints (shared/layout.ts
// via ctx.layout: DESKS, DESK_SIZE, MEETING_TABLE, MEETING_SEATS, LOFT, TV…).
// Not here: walls, floor, ceiling, windows, lights (shell.ts), loose props and signs (props.ts),
// sound and effects (atmosphere.ts).

/**
 * Builds the bunker's desks, chairs, meeting room and lounge into `ctx.group`, and says which office
 * furniture they replace. For now: nothing.
 */
export function buildFurniture(_ctx: BunkerContext): BunkerPart {
  return { dispose() {} };
}
