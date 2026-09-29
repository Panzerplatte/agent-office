import { strings } from '../table';

const s = (n: string | number, one: string, many: string) => (Number(n) === 1 ? one : many);

/** ui/prompt.ts: the prompt box, the confirm dialog and sending a worker with its own worktree home. */
export default strings(
  {
    // The prompt box
    'prompt.placeholder': 'What should the worker work on?',
    'prompt.label': 'Prompt',
    'prompt.worktreeTitle': 'Isolate this worker on its own branch so parallel workers never collide',
    'prompt.worktree': '🌿 Work in its own git worktree & branch',
    'prompt.send': 'Send ✨',
    'prompt.cancel': 'Cancel',
    'prompt.keys': 'Enter to send · Shift+Enter for a new line',

    // Confirming
    'prompt.neverMind': 'Never mind',

    // Sending a worker home
    'prompt.noAnswer': 'the office did not answer',
    'prompt.cleanupAll': 'Send home & delete both',
    'prompt.cleanupWorktree': 'Send home & delete worktree',
    'prompt.cleanupKeep': 'Send home',
    'prompt.deleteBoth': 'Delete the worktree and its branch',
    'prompt.deleteBothSub': 'Removes {path} and {branch}.',
    'prompt.deleteWorktree': 'Delete the worktree, keep the branch',
    'prompt.deleteWorktreeSub': '{branch} stays for a pull request or a later checkout.',
    'prompt.keepBoth': 'Keep both',
    'prompt.keepBothSub': 'Leaves everything as it is; agent-office prune tidies up later.',
    'prompt.checking': 'Checking what {branch} holds…',
    'prompt.sendHome': 'Send {name} home?',
    'prompt.sendHomeBody': 'This stops the session at {where} for everyone and frees the desk. {name} worked in its own worktree on 🌿 {branch}:',
    'prompt.checkFailed': 'Couldn’t check the worktree: {error}.',
    'prompt.gone': 'The worktree folder is already gone.',
    'prompt.dirty': (v) => `⚠️ ${v.n} uncommitted ${s(v.n, 'change', 'changes')} in the worktree — deleting it loses them.`,
    'prompt.unpushed': (v) => `⚠️ ${v.n} ${s(v.n, 'commit', 'commits')} on ${v.branch} that no remote has — deleting the branch loses them.`,
    'prompt.ahead': (v) => `${v.n} ${s(v.n, 'commit', 'commits')} on ${v.branch}, all pushed or merged.`,
    'prompt.clean': 'Nothing on the branch yet and a clean worktree: safe to delete.',
  },
  {
    // Das Prompt-Fenster
    'prompt.placeholder': 'Woran soll der Worker arbeiten?',
    'prompt.label': 'Prompt',
    'prompt.worktreeTitle': 'Diesen Worker auf einem eigenen Branch isolieren, damit parallele Worker sich nie in die Quere kommen',
    'prompt.worktree': '🌿 In einem eigenen Git-Worktree & Branch arbeiten',
    'prompt.send': 'Senden ✨',
    'prompt.cancel': 'Abbrechen',
    'prompt.keys': 'Enter zum Senden · Umschalt+Enter für eine neue Zeile',

    // Bestätigen
    'prompt.neverMind': 'Doch nicht',

    // Einen Worker nach Hause schicken
    'prompt.noAnswer': 'das Büro hat nicht geantwortet',
    'prompt.cleanupAll': 'Nach Hause schicken & beides löschen',
    'prompt.cleanupWorktree': 'Nach Hause schicken & Worktree löschen',
    'prompt.cleanupKeep': 'Nach Hause schicken',
    'prompt.deleteBoth': 'Worktree und Branch löschen',
    'prompt.deleteBothSub': 'Entfernt {path} und {branch}.',
    'prompt.deleteWorktree': 'Worktree löschen, Branch behalten',
    'prompt.deleteWorktreeSub': '{branch} bleibt für einen Pull Request oder einen späteren Checkout.',
    'prompt.keepBoth': 'Beides behalten',
    'prompt.keepBothSub': 'Lässt alles, wie es ist; agent-office prune räumt später auf.',
    'prompt.checking': 'Prüfe, was auf {branch} liegt…',
    'prompt.sendHome': '{name} nach Hause schicken?',
    'prompt.sendHomeBody': 'Das beendet die Sitzung an {where} für alle und macht den Schreibtisch frei. {name} hat in einem eigenen Worktree auf 🌿 {branch} gearbeitet:',
    'prompt.checkFailed': 'Der Worktree konnte nicht geprüft werden: {error}.',
    'prompt.gone': 'Der Worktree-Ordner ist schon weg.',
    'prompt.dirty': (v) => `⚠️ ${v.n} nicht committete ${s(v.n, 'Änderung', 'Änderungen')} im Worktree — wenn du ihn löschst, ${s(v.n, 'geht sie', 'gehen sie')} verloren.`,
    'prompt.unpushed': (v) => `⚠️ ${v.n} ${s(v.n, 'Commit', 'Commits')} auf ${v.branch}, ${s(v.n, 'den', 'die')} kein Remote hat — wenn du den Branch löschst, ${s(v.n, 'geht er', 'gehen sie')} verloren.`,
    'prompt.ahead': (v) => `${v.n} ${s(v.n, 'Commit', 'Commits')} auf ${v.branch}, alles gepusht oder gemergt.`,
    'prompt.clean': 'Noch nichts auf dem Branch und ein sauberer Worktree: kann gefahrlos gelöscht werden.',
  },
);
