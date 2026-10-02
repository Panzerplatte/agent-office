import { HAIR_COLOR_NAMES, HAIR_STYLES } from '../../shared/avatar';
import type { ImageUrlIssue } from '../../shared/decor';
import type { EmoteId } from '../../shared/emotes';
import { DESK_BY_ID, type DeskDef, type SeatDef, type StationKind } from '../../shared/layout';
import { MEETING_PATTERNS, type MeetingWords, type OutputIssue } from '../../shared/meetings';
import type { MeetingPattern } from '../../shared/protocol';
import type { DrinkId } from '../../shared/rooftop';
import { t, type Key } from './index';

// What the page calls the things in the shared lists, in your language (the texts are in data.ts).

const say = (key: string, vars?: Record<string, string | number>) => t(`data.${key}` as Key, vars);

/** "Debate". */
export const patternLabel = (p: MeetingPattern) => say(`pattern.${p}.label`);
/** What goes before "meeting" in one word ("Debatten" in "Debatten-Meeting"); the label in English. */
export const patternStem = (p: MeetingPattern) => say(`pattern.${p}.stem`);
export const patternBlurb = (p: MeetingPattern) => say(`pattern.${p}.blurb`);
export const patternRoundsNote = (p: MeetingPattern) => say(`pattern.${p}.roundsNote`);
/** A role per chair, the head of the table first. */
export const patternRoles = (p: MeetingPattern) => MEETING_PATTERNS[p].roles.map((_, i) => say(`pattern.${p}.role${i + 1}`));
/** The role of a chair the pattern has none for. */
export const meetingWorkerN = (n: number) => say('meeting.workerN', { n });

/** meetingSpend and meetingSummary's words, in your language. */
export const meetingWords: MeetingWords = {
  label: patternLabel,
  tokens: (n) => say('meeting.tokens', { n }),
  rounds: (n) => say('meeting.rounds', { n }),
  roundOf: (round, of, stopped) => say(stopped ? 'meeting.inRoundOf' : 'meeting.roundOf', { round, of }),
  get stopped() {
    return say('meeting.stopped');
  },
  get postedOnPr() {
    return say('meeting.postedOnPr');
  },
  couldntPost: (error) => say('meeting.couldntPost', { error }),
  onBranch: (branch) => say('meeting.onBranch', { branch }),
  inWorktree: (branch) => say('meeting.inWorktree', { branch }),
};

/** Why a meeting can't write where it's asked to (see outputIssue). */
export const outputIssueText = (o: { issue: OutputIssue; dir?: string }) => say(`output.${o.issue}`, { dir: o.dir ?? '' });

/** "Desk 3", "Bean bag 2", "Issues board", "Head of the table"… */
export function deskLabel(d: DeskDef): string {
  if (d.station) return stationName(d.station);
  const n = Number(/\d+$/.exec(d.id)?.[0]);
  if (d.room) return n === 1 ? say('desk.head') : say('desk.chair', { n });
  return say(d.beanbag ? 'desk.beanbag' : 'desk.desk', { n });
}
/** The desk with this id's label, if there is one. */
export function deskLabelOf(id: string): string | undefined {
  const d = DESK_BY_ID.get(id);
  return d && deskLabel(d);
}
export const stationName =(k: StationKind) => say(`station.${k}`);
export const stationAgentName = (k: StationKind) => say(`agent.${k}`);

/** "🛋️ Couch". */
export const seatLabel = (s: SeatDef) => say(`seat.${s.kind}`);
/** "couch", for "No room on that couch". */
export const seatNoun = (s: SeatDef) => say(`seat.${s.kind}.noun`);
/** "🛋️ on the couch". */
export const seatOn = (s: SeatDef) => say(`seat.${s.kind}.on`);

/** A frame by its English name in shared/decor FRAMES. */
export const frameName = (f: { name: string }) => say(`frame.${f.name.toLowerCase()}`);
export const imageUrlIssueText = (issue: ImageUrlIssue) => say(`imageUrl.${issue}`);

export const roofName = () => say('roof.name');
export const casinoName = () => say('casino.name');
export const drinkName = (d: { id: DrinkId }) => say(`drink.${d.id}`);
export const drinkBlurb = (d: { id: DrinkId }) => say(`drink.${d.id}.blurb`);

export const emoteLabel = (e: { id: EmoteId }) => say(`emote.${e.id}`);

/** "Dark brown" -> "darkBrown". */
const camel = (name: string) => name.toLowerCase().replace(/ (\w)/g, (_, c: string) => c.toUpperCase());
/** The i-th of shared/avatar's HAIR_STYLES. */
export const hairStyleName = (i: number) => say(`hairStyle.${camel(HAIR_STYLES[i])}`);
/** The i-th of shared/avatar's HAIR_COLOR_NAMES. */
export const hairColorName = (i: number) => say(`hairColor.${camel(HAIR_COLOR_NAMES[i])}`);
