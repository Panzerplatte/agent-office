import { strings } from '../table';

/** ui/prompt.ts: the prompt window, the confirm dialog, and sending home a worker with its own worktree. */
export default strings(
  {
    'prompt.placeholder': 'What should the worker work on?',
    'prompt.aria': 'Prompt',
    'prompt.worktree': '🌿 Work in its own git worktree & branch',
    'prompt.worktreeTitle': 'Isolate this worker on its own branch so parallel workers never collide',
    'prompt.send': 'Send ✨',
    'prompt.cancel': 'Cancel',
    'prompt.keysHint': 'Enter to send · Shift+Enter for a new line',
    'prompt.neverMind': 'Never mind',
    'prompt.sendHomeTitle': 'Send {name} home?',
    'prompt.sendHomeBody': 'This stops the session at {where} for everyone and frees the desk. {name} worked in its own worktree on 🌿 {branch}:',
    'prompt.cleanupAll': 'Send home & delete both',
    'prompt.cleanupWorktree': 'Send home & delete worktree',
    'prompt.cleanupKeep': 'Send home',
    'prompt.choiceAll': 'Delete the worktree and its branch',
    'prompt.choiceAllNote': 'Removes {path} and {branch}.',
    'prompt.choiceWorktree': 'Delete the worktree, keep the branch',
    'prompt.choiceWorktreeNote': '{branch} stays for a pull request or a later checkout.',
    'prompt.choiceKeep': 'Keep both',
    'prompt.choiceKeepNote': 'Leaves everything as it is; agent-office prune tidies up later.',
    'prompt.checking': 'Checking what {branch} holds…',
    'prompt.noAnswer': 'the office did not answer',
    'prompt.checkFailed': "Couldn't check the worktree: {error}.",
    'prompt.worktreeGone': 'The worktree folder is already gone.',
    'prompt.dirty': (v) => `⚠️ ${v.n} uncommitted change${v.n === 1 ? '' : 's'} in the worktree — deleting it loses them.`,
    'prompt.unpushed': (v) => `⚠️ ${v.n} commit${v.n === 1 ? '' : 's'} on ${v.branch} that no remote has — deleting the branch loses them.`,
    'prompt.ahead': (v) => `${v.n} commit${v.n === 1 ? '' : 's'} on ${v.branch}, all pushed or merged.`,
    'prompt.safe': 'Nothing on the branch yet and a clean worktree: safe to delete.',
  },
  {
    'prompt.placeholder': 'Woran soll der Worker arbeiten?',
    'prompt.aria': 'Prompt',
    'prompt.worktree': '🌿 In eigenem Git-Worktree & Branch arbeiten',
    'prompt.worktreeTitle': 'Diesen Worker auf einen eigenen Branch setzen, damit sich parallele Worker nie in die Quere kommen',
    'prompt.send': 'Senden ✨',
    'prompt.cancel': 'Abbrechen',
    'prompt.keysHint': 'Enter zum Senden · Shift+Enter für eine neue Zeile',
    'prompt.neverMind': 'Doch nicht',
    'prompt.sendHomeTitle': '{name} heimschicken?',
    'prompt.sendHomeBody': 'Das beendet die Sitzung an {where} für alle und macht den Schreibtisch frei. {name} hat in einem eigenen Worktree auf 🌿 {branch} gearbeitet:',
    'prompt.cleanupAll': 'Heimschicken & beides löschen',
    'prompt.cleanupWorktree': 'Heimschicken & Worktree löschen',
    'prompt.cleanupKeep': 'Heimschicken',
    'prompt.choiceAll': 'Worktree und Branch löschen',
    'prompt.choiceAllNote': 'Entfernt {path} und {branch}.',
    'prompt.choiceWorktree': 'Worktree löschen, Branch behalten',
    'prompt.choiceWorktreeNote': '{branch} bleibt für einen Pull Request oder einen späteren Checkout.',
    'prompt.choiceKeep': 'Beides behalten',
    'prompt.choiceKeepNote': 'Lässt alles, wie es ist; agent-office prune räumt später auf.',
    'prompt.checking': 'Schaue nach, was auf {branch} liegt…',
    'prompt.noAnswer': 'das Office hat nicht geantwortet',
    'prompt.checkFailed': 'Konnte den Worktree nicht prüfen: {error}.',
    'prompt.worktreeGone': 'Der Worktree-Ordner ist schon weg.',
    'prompt.dirty': (v) =>
      v.n === 1
        ? '⚠️ 1 nicht committete Änderung im Worktree – beim Löschen geht sie verloren.'
        : `⚠️ ${v.n} nicht committete Änderungen im Worktree – beim Löschen gehen sie verloren.`,
    'prompt.unpushed': (v) =>
      v.n === 1
        ? `⚠️ 1 Commit auf ${v.branch}, den kein Remote hat – beim Löschen des Branches geht er verloren.`
        : `⚠️ ${v.n} Commits auf ${v.branch}, die kein Remote hat – beim Löschen des Branches gehen sie verloren.`,
    'prompt.ahead': (v) => (v.n === 1 ? `1 Commit auf ${v.branch}, gepusht oder gemergt.` : `${v.n} Commits auf ${v.branch}, alle gepusht oder gemergt.`),
    'prompt.safe': 'Noch nichts auf dem Branch und der Worktree ist sauber: kann gefahrlos weg.',
  },
);
