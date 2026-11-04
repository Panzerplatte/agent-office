import { strings } from './table';

/** The jump & run down on the street (world/jumprun.ts, client/jumprun.ts, shared/jumprun.ts), as `t('jumprun.<what>')`. */
export default strings(
  {
    sign: '🏁 JUMP & RUN',
    boardTitle: '🏁 Jump & Run · best times',
    boardEmpty: 'No times yet: cross the line!',
    clock: '⏱ {time}',
    clockCheckpoint: '⏱ {time} · 🚩 {n}/{of}',
    checkpoint: '🚩 Checkpoint {n} of {of}',
    back: '↩️ Back to checkpoint {n}',
    fell: '💥 Fell off: run over',
    done: '🏁 {time}',
    doneRank: '🏁 {time}: #{rank} on the board',
    doneBest: '🏁 {time}: your best yet, #{rank} on the board!',
    doneFirst: '🏆 {time}: the fastest yet!',
    record: '🏆 {name} ran the jump & run in {time}, the fastest yet',
    void: "🏁 That run didn't count",
    help: 'The jump & run on the street east of the building (out the garage’s open east side): cross the start line by the sign and the clock starts. Jump your way up the crates, pipes, scaffolding and containers (two platforms move) to the flag at the top. The red flags are checkpoints: fall off after one and you’re back on it, fall off before the first and the run’s over. The board at the start shows everyone’s best time',
  },
  {
    sign: '🏁 JUMP & RUN',
    boardTitle: '🏁 Jump & Run · Bestzeiten',
    boardEmpty: 'Noch keine Zeiten: über die Linie!',
    clock: '⏱ {time}',
    clockCheckpoint: '⏱ {time} · 🚩 {n}/{of}',
    checkpoint: '🚩 Checkpoint {n} von {of}',
    back: '↩️ Zurück zu Checkpoint {n}',
    fell: '💥 Runtergefallen: Lauf vorbei',
    done: '🏁 {time}',
    doneRank: '🏁 {time}: Platz {rank} auf der Tafel',
    doneBest: '🏁 {time}: deine beste Zeit, Platz {rank} auf der Tafel!',
    doneFirst: '🏆 {time}: die schnellste Zeit bisher!',
    record: '🏆 {name} hat den Jump & Run in {time} geschafft, so schnell wie noch keiner',
    void: '🏁 Der Lauf hat nicht gezählt',
    help: 'Der Jump & Run auf der Straße östlich vom Gebäude (durch die offene Ostseite der Garage): über die Startlinie beim Schild und die Uhr läuft. Spring über Kisten, Rohre, Gerüste und Container (zwei Plattformen bewegen sich) hoch zur Fahne ganz oben. Die roten Fähnchen sind Checkpoints: fällst du danach runter, stehst du wieder dort, fällst du vor dem ersten runter, ist der Lauf vorbei. Die Tafel am Start zeigt die Bestzeit von jedem',
  },
);
