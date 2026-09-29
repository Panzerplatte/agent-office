import test from 'node:test';
import assert from 'node:assert/strict';
import { LANGS, lang, setLang } from '../src/client/i18n/index.js';
import * as L from '../src/client/i18n/labels.js';
import { HAIR_COLOR_NAMES, HAIR_STYLES } from '../src/shared/avatar.js';
import { FRAMES, IMAGE_URL_ISSUES, checkImageUrl, type ImageUrlIssue } from '../src/shared/decor.js';
import { EMOTES } from '../src/shared/emotes.js';
import { DESKS, MEETING_SEATS, SEATING, STATIONS, BEANBAGS, STATION_AGENT, type StationKind } from '../src/shared/layout.js';
import { MEETING_PATTERNS, MEETING_PATTERN_IDS, OUTPUT_ISSUES, meetingSummary, outputIssue, outputProblem, type OutputIssue } from '../src/shared/meetings.js';
import type { Meeting } from '../src/shared/protocol.js';
import { DRINKS, ROOF_NAME } from '../src/shared/rooftop.js';

/** Every name the page gives a thing in the shared lists, in the current language. */
function everyLabel(): string[] {
  return [
    ...MEETING_PATTERN_IDS.flatMap((p) => [L.patternLabel(p), L.patternStem(p), L.patternBlurb(p), L.patternRoundsNote(p), ...L.patternRoles(p)]),
    ...(Object.keys(OUTPUT_ISSUES) as OutputIssue[]).map((issue) => L.outputIssueText({ issue })),
    ...[...DESKS, ...BEANBAGS, ...STATIONS, ...MEETING_SEATS].map(L.deskLabel),
    ...(Object.keys(STATION_AGENT) as StationKind[]).map(L.stationAgentName),
    ...SEATING.flatMap((s) => [L.seatLabel(s), L.seatNoun(s), L.seatOn(s)]),
    ...FRAMES.map(L.frameName),
    ...(Object.keys(IMAGE_URL_ISSUES) as ImageUrlIssue[]).map(L.imageUrlIssueText),
    L.roofName(),
    ...DRINKS.flatMap((d) => [L.drinkName(d), L.drinkBlurb(d)]),
    ...EMOTES.map(L.emoteLabel),
    ...HAIR_STYLES.map((_, i) => L.hairStyleName(i)),
    ...HAIR_COLOR_NAMES.map((_, i) => L.hairColorName(i)),
  ];
}

test('everything in the shared lists has a name in every language', () => {
  const was = lang();
  try {
    for (const { id } of LANGS) {
      setLang(id);
      for (const text of everyLabel()) assert.ok(text && !text.startsWith('data.') && !text.includes('{'), `${id}: ${text}`);
    }
  } finally {
    setLang(was);
  }
});

test('in English the page says what the shared lists say', () => {
  const was = lang();
  try {
    setLang('en');
    for (const p of MEETING_PATTERN_IDS) {
      const d = MEETING_PATTERNS[p];
      assert.deepEqual([L.patternLabel(p), L.patternBlurb(p), L.patternRoundsNote(p), L.patternRoles(p)], [d.label, d.blurb, d.roundsNote, [...d.roles]]);
    }
    for (const d of [...DESKS, ...BEANBAGS, ...STATIONS, ...MEETING_SEATS]) assert.equal(L.deskLabel(d), d.label);
    for (const [k, a] of Object.entries(STATION_AGENT)) assert.equal(L.stationAgentName(k as StationKind), a.name);
    for (const s of SEATING) assert.equal(L.seatLabel(s), s.label);
    for (const f of FRAMES) assert.equal(L.frameName(f), f.name);
    for (const [issue, text] of Object.entries(IMAGE_URL_ISSUES)) assert.equal(L.imageUrlIssueText(issue as ImageUrlIssue), text);
    assert.equal(L.roofName(), ROOF_NAME);
    for (const d of DRINKS) assert.deepEqual([L.drinkName(d), L.drinkBlurb(d)], [d.name, d.blurb]);
    for (const e of EMOTES) assert.equal(L.emoteLabel(e), e.label);
    HAIR_STYLES.forEach((s, i) => assert.equal(L.hairStyleName(i), s));
    HAIR_COLOR_NAMES.forEach((c, i) => assert.equal(L.hairColorName(i), c));
    for (const p of ['', '/etc/x', 'a/../b', '.git/x', 'x'.repeat(201), 'a\u0001b']) {
      const o = outputIssue(p)!;
      assert.equal(L.outputIssueText(o), outputProblem(p));
    }
  } finally {
    setLang(was);
  }
});

test('a link or an output path that won’t do says why in German too', () => {
  const was = lang();
  try {
    setLang('de');
    const bad = checkImageUrl('ftp://example.com/a.png');
    assert.ok('issue' in bad);
    assert.equal(bad.error, 'Only http and https links can hang on the wall');
    assert.equal(L.imageUrlIssueText(bad.issue), 'Nur http- und https-Links können an die Wand');
    assert.equal(L.outputIssueText(outputIssue('.agent-office/x.md')!), 'Die Ausgabe darf nicht in .agent-office/ liegen');
    assert.equal(outputIssue('docs/x.md'), undefined);
  } finally {
    setLang(was);
  }
});

test('a meeting’s summary line, in English as the server writes it and in German', () => {
  const m = {
    pattern: 'debate',
    status: 'done',
    round: 3,
    rounds: 3,
    tokens: 1_200_000,
    cost: 2.4,
    costKnown: true,
    output: 'docs/decisions/tabs.md',
    commit: 'abc1234',
    worktree: { branch: 'meeting/tabs' },
  } as unknown as Meeting;
  const stopped = { ...m, status: 'stopped', round: 2, reason: undefined } as unknown as Meeting;
  const was = lang();
  try {
    setLang('en');
    assert.equal(meetingSummary(m, L.meetingWords), meetingSummary(m));
    assert.equal(meetingSummary(stopped, L.meetingWords), meetingSummary(stopped));
    setLang('de');
    assert.match(meetingSummary(m, L.meetingWords), /^🗣️ Debatte · 3 Runden · [\d.]+M Tokens · .+ · ✅ docs\/decisions\/tabs\.md auf meeting\/tabs$/);
    assert.match(meetingSummary(stopped, L.meetingWords), /^🗣️ Debatte · in Runde 2 von 3 · .+ · ⛔ gestoppt$/);
  } finally {
    setLang(was);
  }
});
