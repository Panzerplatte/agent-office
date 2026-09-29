import { strings } from '../table';

/** ui/cabinet.ts: the arcade cabinet in the lounge (its screen's own texts are in blocks.ts). */
export default strings(
  {
    'cabinet.watchingLabel': '{name} playing {game}',
    'cabinet.stopPlaying': '✕ Stop playing',
    'cabinet.stopWatching': '✕ Stop watching',
    'cabinet.keys': '← → move · ↑ turn · ↓ faster · Space drop · C hold · P pause',
    'cabinet.watching': '👀 Watching {name}',
    'cabinet.lostGame': '🕹️ The office lost track of your game, so here’s a new one',
    'cabinet.steppedAway': '{name} stepped away from the arcade',
    'cabinet.openTerminal': '💬 Open its terminal',
    'cabinet.carryOn': '▶ Carry on',
    'cabinet.needsInput': '🙋 {name} needs input{desk}',
    'cabinet.needsYou': '{name} needs you{desk}',
    'cabinet.onTheTable': '🏆 #{rank} on the table! Enter: again',
    'cabinet.playAgain': 'Enter to play again',
    'cabinet.backSoon': 'Back in a moment',
    'cabinet.pressToCarryOn': 'PRESS E TO CARRY ON',
    'cabinet.atDesk': ' at {desk}',
    'cabinet.atStation': ' at the {desk}',
  },
  {
    'cabinet.watchingLabel': '{name} spielt {game}',
    'cabinet.stopPlaying': '✕ Aufhören',
    'cabinet.stopWatching': '✕ Nicht mehr zuschauen',
    'cabinet.keys': '← → bewegen · ↑ drehen · ↓ schneller · Leertaste fallen lassen · C halten · P Pause',
    'cabinet.watching': '👀 Du schaust {name} zu',
    'cabinet.lostGame': '🕹️ Das Büro hat dein Spiel verloren, hier ist ein neues',
    'cabinet.steppedAway': '{name} hat den Spielautomaten verlassen',
    'cabinet.openTerminal': '💬 Sein Terminal öffnen',
    'cabinet.carryOn': '▶ Weiterspielen',
    'cabinet.needsInput': '🙋 {name} braucht eine Eingabe{desk}',
    'cabinet.needsYou': '{name} braucht dich{desk}',
    'cabinet.onTheTable': '🏆 Platz {rank} in der Bestenliste! Enter: nochmal',
    'cabinet.playAgain': 'Enter für ein neues Spiel',
    'cabinet.backSoon': 'Gleich wieder da',
    'cabinet.pressToCarryOn': 'DRÜCK E ZUM WEITERSPIELEN',
    // Desk names come in English from the layout, so German just puts them in brackets.
    'cabinet.atDesk': ' ({desk})',
    'cabinet.atStation': ' ({desk})',
  },
);
