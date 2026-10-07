// The toasts the server sends, in English and German side by side. The server fills in the English
// as the toast's text, for browsers from before these keys, and sends the key and its params along,
// so the browser can show it in your language (the client's `notices` table takes these in).

export type NoticeParams = Record<string, string | number>;
/** Plain with `{name}` placeholders, or a function of its params where the wording changes (plurals). */
export type NoticeText = string | ((p: NoticeParams) => string);

/** A toast's text, and when it's one of ours, the key and params to say it in your language. */
export interface Notice {
  text: string;
  key?: string;
  params?: NoticeParams;
}

function table<const E extends Record<string, NoticeText>>(en: E, de: { [K in keyof E]: NoticeText }) {
  return { en, de: de as Record<string, NoticeText> };
}

const s = (n: string | number) => (Number(n) === 1 ? '' : 's');

const PATTERNS_DE: Record<string, string> = {
  debate: 'Debatten',
  lead: 'Leitungs',
  mapreduce: 'Map-Reduce',
  redblue: 'Rot-/Blau',
  review: 'Review',
};

export const NOTICES = table(
  {
    // The building and its floors
    'floor.removed': '🛗 {who} took {name} off the building',
    'floor.removedRode': '🛗 {who} took {name} off the building, so you rode the elevator to {next}',
    'floor.removedLast': '🛗 {who} took {name}, the last floor, off the building',
    'floor.pickOne': 'Take the elevator to a floor first',
    'floor.noBuilding': 'There is no building to go up on yet',
    'floor.noBasement': 'There is no building over the casino yet',
    'floor.cloning': "That floor is still being cloned — it'll be ready in a moment",
    'floor.noSuch': 'No such floor',
    'floor.adding': '🛗 {who} is adding a floor for {repo}…',
    'floor.added': '🛗 New floor: {name}, added by {who}',
    'workspace.moved': '📁 {who} moved the workspace folder to {dir}',
    'workspace.reset': '📁 {who} put the workspace folder back to {dir}',
    'dog.named': '🐶 {who} named the dog {name}',
    'cat.named': '🐱 {who} named the cat {name}',

    // Workers
    'agent.unknown': 'Unknown agent provider',
    'worker.shell': '{who} opened a shell at a desk',
    'worker.hired': '{who} hired {name}',
    'worker.hiredIssue': '{who} hired {name} for issue #{issue}',
    'worker.hiredTask': '{who} hired {name} with a task',
    'worker.noSuch': 'No such worker',
    'worker.sentHome': '{who} sent {name} home',
    'worker.asked': '{who} asked the {name} something',
    'worker.handedIssue': '{who} handed issue #{issue} to {name}',
    'worker.wentHomeMerged': '🏠 {name} went home: PR #{pr} merged',
    'worker.hostStopped': "The workers' terminal host stopped — resuming them",
    'worker.freshStart': "{name}'s last conversation couldn't be resumed — starting a fresh one",
    'worker.startFailed': 'Could not start {what}: {error}',
    'worktree.keptWork': (p) =>
      `Kept ${p.name}'s worktree and branch ${p.branch} — it has ${
        p.checkError !== undefined
          ? `could not check it (${p.checkError})`
          : [p.dirty ? `${p.dirty} uncommitted change${s(p.dirty)}` : '', p.unpushed ? `${p.unpushed} unpushed commit${s(p.unpushed)}` : ''].filter(Boolean).join(', ')
      }`,
    'worktree.kept': "Kept {name}'s worktree and branch {branch}",
    'worktree.deleted': "Deleted {name}'s worktree and branch {branch}",
    'worktree.deletedKeptBranch': "Deleted {name}'s worktree and kept branch {branch}",
    'worktree.deleteFailed': "Couldn't delete {name}'s worktree: {error}",

    // Changes at a desk, pull requests and issues
    'changes.committed': "{who} committed “{subject}” at {name}'s desk",
    'changes.discardedFile': "{who} discarded the changes to {file} at {name}'s desk",
    'changes.discarded': (p) => `${p.who} discarded ${p.n} uncommitted change${s(p.n)} at ${p.name}'s desk`,
    'changes.discardedAll': "{who} discarded the uncommitted changes at {name}'s desk",
    'changes.prOpened': '{who} opened a pull request for {name}: {url}',
    'pr.exists': "{name}'s branch already has PR #{number}",
    'pr.opened': '{who} opened PR #{number} for {name}',
    'pr.dirty': '{name} still has uncommitted changes in its worktree — they are not in the PR',
    'pr.autoMerge': '{who} set PR #{number} to merge once its checks pass',
    'pr.merged': '🎉 {who} merged PR #{number}',
    'pr.mergedOnGitHub': '🎉 PR #{number} merged: {title}',
    'pr.closed': '{who} closed PR #{number} without merging',
    'pr.commented': '💬 {who} commented on PR #{number}',
    'pr.labeled': '🏷️ {who} labeled PR #{number}: {labels}',
    'issue.commented': '💬 {who} commented on issue #{number}',
    'issue.labeled': '🏷️ {who} labeled issue #{number}: {labels}',
    'issue.closed': (p) => `${p.who} closed issue #${p.number}${p.notPlanned ? ' as not planned' : ''}${p.dropped ? ' and took it off the queue' : ''}`,
    'issue.claimFailed': "Couldn't assign issue #{issue} on GitHub: {error}",

    // The queue
    'queue.queuedIssue': '📋 {who} queued issue #{issue}',
    'queue.queuedTask': '📋 {who} queued a task',
    'queue.agentQueuedIssue': '📋 The {agent} queued issue #{issue}',
    'queue.agentQueuedTask': '📋 The {agent} queued “{title}”',
    'queue.finished': '📋 {who} finished {task}',
    'queue.stopped': '📋 {who} stopped before finishing {task} — requeue it from the queue board',
    'queue.madeRoom': '📋 {name} went home after {task} to make room for the next task',
    'queue.startFailed': "📋 Couldn't start {task}: {error}",
    'queue.satDown': '📋 {name} sat down at {desk} to work on {task}',
    'queue.empty': '📋 The queue is empty: every task is done 🎉',

    // Meetings
    'meeting.called': (p) =>
      `🤝 ${p.by} called a ${p.label} meeting: “${p.title}” (${p.count} workers, ${p.rounds} round${s(p.rounds)} at most, ${p.tokens} tokens)`,
    'meeting.cleared': '🤝 {by} cleared the meeting room',
    'meeting.done': (p) => `🤝 The ${p.label} meeting on “${p.title}” is done: it wrote ${p.output}`,
    'meeting.reviewPosted': "🔍 Posted the panel's review on PR #{pr}",
    'meeting.reviewFailed': "Couldn't post the panel's review on PR #{pr}: {error}",
    'meeting.commitFailed': "Couldn't commit {output} on {branch}: {error}",
    'meeting.stopped': '⛔ The meeting on “{title}” stopped in round {round}: {reason}',
    'meeting.keptWorktree': (p) =>
      `Kept the “${p.title}” meeting's worktree and branch ${p.branch}: ${p.error ?? `${p.dirty} uncommitted change${s(p.dirty)}`}`,
    'meeting.tidyFailed': "Couldn't tidy away the meeting's worktree: {error}",

    // Office settings, for admins
    'admin.floors': 'Only admins can take a floor off the building',
    'admin.workspace': 'Only admins can move the workspace folder',
    'admin.prompts': 'Only admins can change the office’s prompts',
    'admin.defaultWorker': 'Only admins can pick the office’s default worker',
    'admin.workerLimit': 'Only admins can change the worker limit',
    'admin.accounts': 'Only admins can manage accounts',
    'webhook.on': '📣 {who} set up team notifications',
    'webhook.off': '{who} turned off team notifications',
    'webhook.tested': '📣 Sent a test message',
    'theme.halloween': '🎃 {who} dressed the office up for Halloween',
    'theme.christmas': '🎄 {who} dressed the office up for Christmas',
    'theme.off': '{who} took the holiday decorations down',
    'theme.auto': '📅 {who} set the decorations to follow the calendar',
    'theme.autoHalloween': "📅 {who} set the decorations to follow the calendar (it's Halloween 🎃 season)",
    'theme.autoChristmas': "📅 {who} set the decorations to follow the calendar (it's Christmas 🎄 season)",
    'floorStyle.bunker': '🛢️ {who} turned the office into a bunker',
    'floorStyle.office': '🏢 {who} turned the bunker back into an office',
    'prompt.rewrote': '📝 {who} rewrote the “{label}” prompt',
    'prompt.reset': '📝 {who} put the default “{label}” prompt back',
    'defaultWorker.set': '🤖 {who} set the office’s default worker',
    'defaultWorker.reset': '🤖 {who} put the office’s default worker back to {cmd}',
    'leaveOnMerge.on': '🏠 {who} set workers to go home by themselves once their pull request merges',
    'leaveOnMerge.off': "🪑 {who} set workers whose pull request merged to stay until they're sent home",
    'workerLimit.range': 'The worker limit is a whole number from 1 to {max}',
    'workerLimit.set': '⚙️ {who} set the worker limit to {limit}',
    'workerLimit.off': '⚙️ {who} took the worker limit off',
    'workerLimit.reset': '⚙️ {who} put the worker limit back to {limit} (--max-workers)',
    'budget.passed': (p) => `💸 Today's spend passed the ${p.budget} budget (${p.spent})${p.paused ? ' — no new hires until tomorrow' : ''}`,
    'upgrade.started': '{who} is upgrading the office — it restarts when the new version is built',

    // Accounts
    'account.invited': '{who} invited {name} to the office',
    'account.removed': "{who} removed {name}'s access",
    'account.revoked': "{who} revoked {name}'s account",
    'account.notSelfRevoke': "You can't revoke your own account",
    'account.notSelfRole': "You can't change your own role",
    'account.madeAdmin': '{who} made {name} an admin',
    'account.noLongerAdmin': '{name} is no longer an admin',
    'password.needAccount': 'Sign in with an admin account of your own first, or nobody could get back in',
    'password.on': '{who} switched the shared office password back on',
    'password.off': '🔑 {who} switched off the shared office password — everyone signs in with their own account now',

    // Fun and games
    'picture.hung': '🖼️ {who} hung “{title}”',
    'picture.hungUntitled': '🖼️ {who} hung a picture',
    'picture.down': '{who} took down “{title}”',
    'picture.downUntitled': '{who} took down a picture',
    'picture.stood': '🖼️ {who} put “{title}” on a desk',
    'picture.stoodUntitled': '🖼️ {who} put a picture on a desk',
    'jukebox.radio': '📻 {who} tuned the jukebox to {title}',
    'jukebox.playing': '🎵 {who} put on “{title}”',
    'jukebox.skipped': '⏭️ {who} skipped to “{title}”',
    'jukebox.off': '🔇 {who} turned the jukebox off',
    'jukebox.noSuchTune': "The jukebox doesn't have that one",
    'jukebox.noLink': 'Paste a link to a stream or an audio file',
    'jukebox.longLink': 'That link is too long',
    'jukebox.notLink': "That isn't a web link. Paste an address that starts with https://",
    'jukebox.notHttp': 'Only http and https links can play on the jukebox',
    'tv.showing': '📺 {name} is showing {title} on the TV',
    'tv.notService': "Port {port} isn't a worker's service on this floor",
    'golive.started': '🚀 {name} is putting {service} live …',
    'golive.notClaude': "{name} isn't a Claude worker: only Claude knows how to put a website live",
    'golive.asleep': "{name} isn't running: wake them up (R) and press 🚀 Go live again",
    'golive.busy': '{name} is busy right now: wait until they are done, then press 🚀 Go live again',
    'golive.again': '{service} is already going live: try again in {s} s',
    'gallery.set': '🌐 {who} set the Demo-Galerie to {url}',
    'gallery.off': '🌐 {who} removed the Demo-Galerie',
    'gallery.notLink': "That isn't a web address. Paste the gallery's Render URL, starting with https://",
    'gallery.notHttps': 'The Demo-Galerie needs an https:// address (without a login in it)',
    'arcade.busy': '{name} is on the arcade — press E there to watch',
    'arcade.tooMany': "🕹️ That's a lot of new games in a row, so this one won't go on the high-score table",
    'arcade.lost': "🕹️ The office couldn't follow this game, so its score won't go on the high-score table",
    'arcade.highScore': '🏆 {name} set a new arcade high score: {score}',
    'snake.busy': '{name} is playing Snake — press E there to watch',
    'snake.lost': "🐍 The office couldn't follow this game, so its score won't go on the high-score table",
    'snake.highScore': '🐍 {name} set a new Snake high score: {score}',
    'chips.creditOwed': '🏦 You still owe {owed} chips on your credit (about {wait} of project work): pay it back before the next one',
    'chips.creditAmount': '🏦 The bank gives credit in set amounts only (10,000 chips at most)',
    'chips.creditCasino': '🏦 Credit is at the cashier, down in the casino',
    'chips.creditPaid': '🏦 Your credit is paid back: the bank will give you another one',
    'housebank.owner': '🏛️ Only the owner of the house bank can take chips out of it',
    'housebank.amount': '🏛️ Take out a whole number of chips, 1 or more',
    'housebank.balance': '🏛️ The house bank only holds {total} chips',
    'housebank.casino': '🏛️ The house bank is at the cashier, down in the casino',
    'housebank.withdrew': '🏛️ You took {amount} chips out of the house bank',
    'housebank.ownerSet': '{who} made {name} the owner of the house bank',
    'housebank.ownerNone': '{who} took the house bank away from its owner: nobody owns it now',
    'shop.casino': '🛍️ The shop is down in the casino, through the door in the south-west corner',
    'shop.chips': '🛍️ That costs {price} chips and you have {balance}',
    'shop.owned': '🛍️ You have that already: put it on or take it off in the shop',
    'shop.item': "🛍️ The shop doesn't sell that",
  },
  {
    'floor.removed': '🛗 {who} hat {name} aus dem Gebäude genommen',
    'floor.removedRode': '🛗 {who} hat {name} aus dem Gebäude genommen, also bist du mit dem Aufzug nach {next} gefahren',
    'floor.removedLast': '🛗 {who} hat {name}, die letzte Etage, aus dem Gebäude genommen',
    'floor.pickOne': 'Fahr zuerst mit dem Aufzug auf eine Etage',
    'floor.noBuilding': 'Es gibt noch kein Gebäude, in das du hochfahren könntest',
    'floor.noBasement': 'Über dem Casino steht noch kein Gebäude',
    'floor.cloning': 'Diese Etage wird noch geklont — sie ist gleich bereit',
    'floor.noSuch': 'Diese Etage gibt es nicht',
    'floor.adding': '🛗 {who} fügt eine Etage für {repo} hinzu…',
    'floor.added': '🛗 Neue Etage: {name}, hinzugefügt von {who}',
    'workspace.moved': '📁 {who} hat den Arbeitsordner nach {dir} verlegt',
    'workspace.reset': '📁 {who} hat den Arbeitsordner auf {dir} zurückgesetzt',
    'dog.named': '🐶 {who} hat den Hund {name} genannt',
    'cat.named': '🐱 {who} hat die Katze {name} genannt',

    'agent.unknown': 'Unbekannter Agent-Anbieter',
    'worker.shell': '{who} hat an einem Schreibtisch eine Shell geöffnet',
    'worker.hired': '{who} hat {name} eingestellt',
    'worker.hiredIssue': '{who} hat {name} für Issue #{issue} eingestellt',
    'worker.hiredTask': '{who} hat {name} mit einer Aufgabe eingestellt',
    'worker.noSuch': 'Diesen Worker gibt es nicht',
    'worker.sentHome': '{who} hat {name} nach Hause geschickt',
    'worker.asked': '{who} hat {name} etwas gefragt',
    'worker.handedIssue': '{who} hat Issue #{issue} an {name} übergeben',
    'worker.wentHomeMerged': '🏠 {name} ist nach Hause gegangen: PR #{pr} gemergt',
    'worker.hostStopped': 'Der Terminal-Host der Worker ist ausgefallen — sie werden fortgesetzt',
    'worker.freshStart': '{name}s letztes Gespräch ließ sich nicht fortsetzen — es beginnt ein neues',
    'worker.startFailed': '{what} konnte nicht gestartet werden: {error}',
    'worktree.keptWork': (p) =>
      `Worktree und Branch ${p.branch} von ${p.name} behalten — ${
        p.checkError !== undefined
          ? `konnte nicht geprüft werden (${p.checkError})`
          : `darin ${[p.dirty ? (Number(p.dirty) === 1 ? '1 nicht committete Änderung' : `${p.dirty} nicht committete Änderungen`) : '', p.unpushed ? (Number(p.unpushed) === 1 ? '1 nicht gepushter Commit' : `${p.unpushed} nicht gepushte Commits`) : ''].filter(Boolean).join(', ')}`
      }`,
    'worktree.kept': 'Worktree und Branch {branch} von {name} behalten',
    'worktree.deleted': 'Worktree und Branch {branch} von {name} gelöscht',
    'worktree.deletedKeptBranch': 'Worktree von {name} gelöscht, Branch {branch} behalten',
    'worktree.deleteFailed': 'Worktree von {name} konnte nicht gelöscht werden: {error}',

    'changes.committed': '{who} hat „{subject}“ an {name}s Schreibtisch committet',
    'changes.discardedFile': '{who} hat die Änderungen an {file} an {name}s Schreibtisch verworfen',
    'changes.discarded': (p) =>
      `${p.who} hat ${Number(p.n) === 1 ? '1 nicht committete Änderung' : `${p.n} nicht committete Änderungen`} an ${p.name}s Schreibtisch verworfen`,
    'changes.discardedAll': '{who} hat die nicht committeten Änderungen an {name}s Schreibtisch verworfen',
    'changes.prOpened': '{who} hat einen Pull Request für {name} geöffnet: {url}',
    'pr.exists': 'Der Branch von {name} hat schon PR #{number}',
    'pr.opened': '{who} hat PR #{number} für {name} geöffnet',
    'pr.dirty': '{name} hat noch nicht committete Änderungen im Worktree — sie sind nicht im PR',
    'pr.autoMerge': '{who} hat PR #{number} auf automatisches Mergen gestellt, sobald die Checks durch sind',
    'pr.merged': '🎉 {who} hat PR #{number} gemergt',
    'pr.mergedOnGitHub': '🎉 PR #{number} gemergt: {title}',
    'pr.closed': '{who} hat PR #{number} ohne Mergen geschlossen',
    'pr.commented': '💬 {who} hat PR #{number} kommentiert',
    'pr.labeled': '🏷️ {who} hat die Labels von PR #{number} geändert: {labels}',
    'issue.commented': '💬 {who} hat Issue #{number} kommentiert',
    'issue.labeled': '🏷️ {who} hat die Labels von Issue #{number} geändert: {labels}',
    'issue.closed': (p) =>
      `${p.who} hat Issue #${p.number}${p.notPlanned ? ' als nicht geplant' : ''} geschlossen${p.dropped ? ' und aus der Warteschlange genommen' : ''}`,
    'issue.claimFailed': 'Issue #{issue} konnte auf GitHub nicht zugewiesen werden: {error}',

    'queue.queuedIssue': '📋 {who} hat Issue #{issue} in die Warteschlange gestellt',
    'queue.queuedTask': '📋 {who} hat eine Aufgabe in die Warteschlange gestellt',
    'queue.agentQueuedIssue': '📋 {agent} hat Issue #{issue} in die Warteschlange gestellt',
    'queue.agentQueuedTask': '📋 {agent} hat „{title}“ in die Warteschlange gestellt',
    'queue.finished': '📋 {who} hat {task} erledigt',
    'queue.stopped': '📋 {who} hat vor dem Ende von {task} aufgehört — stell es über die Warteschlange neu ein',
    'queue.madeRoom': '📋 {name} ist nach {task} nach Hause gegangen, um Platz für die nächste Aufgabe zu machen',
    'queue.startFailed': '📋 {task} konnte nicht gestartet werden: {error}',
    'queue.satDown': '📋 {name} hat sich an {desk} gesetzt, um an {task} zu arbeiten',
    'queue.empty': '📋 Die Warteschlange ist leer: alle Aufgaben erledigt 🎉',

    'meeting.called': (p) =>
      `🤝 ${p.by} hat ein ${PATTERNS_DE[p.pattern] ?? p.label}-Meeting einberufen: „${p.title}“ (${p.count} Worker, höchstens ${p.rounds} ${Number(p.rounds) === 1 ? 'Runde' : 'Runden'}, ${p.tokens} Tokens)`,
    'meeting.cleared': '🤝 {by} hat den Besprechungsraum geräumt',
    'meeting.done': (p) => `🤝 Das ${PATTERNS_DE[p.pattern] ?? p.label}-Meeting zu „${p.title}“ ist fertig: es hat ${p.output} geschrieben`,
    'meeting.reviewPosted': '🔍 Das Review des Panels ist auf PR #{pr} gepostet',
    'meeting.reviewFailed': 'Das Review des Panels konnte nicht auf PR #{pr} gepostet werden: {error}',
    'meeting.commitFailed': '{output} konnte nicht auf {branch} committet werden: {error}',
    'meeting.stopped': '⛔ Das Meeting zu „{title}“ wurde in Runde {round} beendet: {reason}',
    'meeting.keptWorktree': (p) =>
      `Worktree und Branch ${p.branch} des Meetings „${p.title}“ behalten: ${p.error ?? (Number(p.dirty) === 1 ? '1 nicht committete Änderung' : `${p.dirty} nicht committete Änderungen`)}`,
    'meeting.tidyFailed': 'Der Worktree des Meetings konnte nicht aufgeräumt werden: {error}',

    'admin.floors': 'Nur Admins können eine Etage aus dem Gebäude nehmen',
    'admin.workspace': 'Nur Admins können den Arbeitsordner verlegen',
    'admin.prompts': 'Nur Admins können die Prompts des Büros ändern',
    'admin.defaultWorker': 'Nur Admins können den Standard-Worker des Büros wählen',
    'admin.workerLimit': 'Nur Admins können das Worker-Limit ändern',
    'admin.accounts': 'Nur Admins können Konten verwalten',
    'webhook.on': '📣 {who} hat Team-Benachrichtigungen eingerichtet',
    'webhook.off': '{who} hat Team-Benachrichtigungen ausgeschaltet',
    'webhook.tested': '📣 Testnachricht gesendet',
    'theme.halloween': '🎃 {who} hat das Büro für Halloween geschmückt',
    'theme.christmas': '🎄 {who} hat das Büro für Weihnachten geschmückt',
    'theme.off': '{who} hat die Festtagsdeko abgenommen',
    'theme.auto': '📅 {who} lässt die Deko jetzt dem Kalender folgen',
    'theme.autoHalloween': '📅 {who} lässt die Deko jetzt dem Kalender folgen (es ist Halloween-Zeit 🎃)',
    'theme.autoChristmas': '📅 {who} lässt die Deko jetzt dem Kalender folgen (es ist Weihnachtszeit 🎄)',
    'floorStyle.bunker': '🛢️ {who} hat das Büro in einen Bunker verwandelt',
    'floorStyle.office': '🏢 {who} hat den Bunker wieder in ein Büro verwandelt',
    'prompt.rewrote': '📝 {who} hat den Prompt „{label}“ umgeschrieben',
    'prompt.reset': '📝 {who} hat den Standard-Prompt „{label}“ wiederhergestellt',
    'defaultWorker.set': '🤖 {who} hat den Standard-Worker des Büros festgelegt',
    'defaultWorker.reset': '🤖 {who} hat den Standard-Worker des Büros auf {cmd} zurückgesetzt',
    'leaveOnMerge.on': '🏠 {who} hat eingestellt, dass Worker von selbst nach Hause gehen, sobald ihr Pull Request gemergt ist',
    'leaveOnMerge.off': '🪑 {who} hat eingestellt, dass Worker mit gemergtem Pull Request bleiben, bis man sie nach Hause schickt',
    'workerLimit.range': 'Das Worker-Limit ist eine ganze Zahl von 1 bis {max}',
    'workerLimit.set': '⚙️ {who} hat das Worker-Limit auf {limit} gesetzt',
    'workerLimit.off': '⚙️ {who} hat das Worker-Limit aufgehoben',
    'workerLimit.reset': '⚙️ {who} hat das Worker-Limit auf {limit} zurückgesetzt (--max-workers)',
    'budget.passed': (p) => `💸 Die heutigen Ausgaben haben das Budget von ${p.budget} überschritten (${p.spent})${p.paused ? ' — bis morgen keine Neueinstellungen' : ''}`,
    'upgrade.started': '{who} aktualisiert das Büro — es startet neu, sobald die neue Version gebaut ist',

    'account.invited': '{who} hat {name} ins Büro eingeladen',
    'account.removed': '{who} hat {name} den Zugang entzogen',
    'account.revoked': '{who} hat das Konto von {name} gesperrt',
    'account.notSelfRevoke': 'Du kannst dein eigenes Konto nicht sperren',
    'account.notSelfRole': 'Du kannst deine eigene Rolle nicht ändern',
    'account.madeAdmin': '{who} hat {name} zum Admin gemacht',
    'account.noLongerAdmin': '{name} ist kein Admin mehr',
    'password.needAccount': 'Melde dich zuerst mit einem eigenen Admin-Konto an, sonst käme niemand mehr herein',
    'password.on': '{who} hat das gemeinsame Büro-Passwort wieder eingeschaltet',
    'password.off': '🔑 {who} hat das gemeinsame Büro-Passwort ausgeschaltet — jetzt meldet sich jeder mit dem eigenen Konto an',

    'picture.hung': '🖼️ {who} hat „{title}“ aufgehängt',
    'picture.hungUntitled': '🖼️ {who} hat ein Bild aufgehängt',
    'picture.down': '{who} hat „{title}“ abgehängt',
    'picture.downUntitled': '{who} hat ein Bild abgehängt',
    'picture.stood': '🖼️ {who} hat „{title}“ auf einen Schreibtisch gestellt',
    'picture.stoodUntitled': '🖼️ {who} hat ein Bild auf einen Schreibtisch gestellt',
    'jukebox.radio': '📻 {who} hat die Jukebox auf {title} eingestellt',
    'jukebox.playing': '🎵 {who} hat „{title}“ aufgelegt',
    'jukebox.skipped': '⏭️ {who} ist zu „{title}“ weitergesprungen',
    'jukebox.off': '🔇 {who} hat die Jukebox ausgeschaltet',
    'jukebox.noSuchTune': 'Diesen Titel hat die Jukebox nicht',
    'jukebox.noLink': 'Füge einen Link zu einem Stream oder einer Audiodatei ein',
    'jukebox.longLink': 'Dieser Link ist zu lang',
    'jukebox.notLink': 'Das ist kein Weblink. Füge eine Adresse ein, die mit https:// beginnt',
    'jukebox.notHttp': 'Nur http- und https-Links können auf der Jukebox laufen',
    'tv.showing': '📺 {name} zeigt {title} auf dem TV',
    'tv.notService': 'Port {port} ist kein Dienst eines Workers auf dieser Etage',
    'golive.started': '🚀 {name} stellt {service} live …',
    'golive.notClaude': '{name} ist kein Claude-Worker: Nur Claude weiß, wie eine Webseite live geht',
    'golive.asleep': '{name} läuft nicht: Weck den Worker auf (R) und drück noch mal 🚀 Live gehen',
    'golive.busy': '{name} arbeitet gerade: Warte, bis der Worker fertig ist, und drück dann noch mal 🚀 Live gehen',
    'golive.again': '{service} geht schon live: Versuch es in {s} s noch mal',
    'gallery.set': '🌐 {who} hat die Demo-Galerie auf {url} gesetzt',
    'gallery.off': '🌐 {who} hat die Demo-Galerie entfernt',
    'gallery.notLink': 'Das ist keine Webadresse. Füge die Render-URL der Galerie ein, mit https:// am Anfang',
    'gallery.notHttps': 'Die Demo-Galerie braucht eine https://-Adresse (ohne Login darin)',
    'arcade.busy': '{name} spielt gerade am Automaten — drück dort E zum Zuschauen',
    'arcade.tooMany': '🕹️ Das sind viele neue Spiele hintereinander, deshalb kommt dieses nicht in die Highscore-Liste',
    'arcade.lost': '🕹️ Das Büro konnte diesem Spiel nicht folgen, deshalb kommt der Punktestand nicht in die Highscore-Liste',
    'arcade.highScore': '🏆 {name} hat einen neuen Arcade-Highscore aufgestellt: {score}',
    'snake.busy': '{name} spielt gerade Snake — drück dort E zum Zuschauen',
    'snake.lost': '🐍 Das Büro konnte diesem Spiel nicht folgen, deshalb kommt der Punktestand nicht in die Highscore-Liste',
    'snake.highScore': '🐍 {name} hat einen neuen Snake-Highscore aufgestellt: {score}',
    'chips.creditOwed': '🏦 Auf deinem Kredit sind noch {owed} Chips offen (ca. {wait} Projektarbeit): erst abbezahlen, dann gibt’s den nächsten',
    'chips.creditAmount': '🏦 Die Bank gibt Kredit nur in festen Beträgen (höchstens 10.000 Chips)',
    'chips.creditCasino': '🏦 Kredit gibt’s an der Kasse, unten im Casino',
    'chips.creditPaid': '🏦 Dein Kredit ist abbezahlt: die Bank gibt dir wieder einen',
    'housebank.owner': '🏛️ Nur die Besitzerin oder der Besitzer der Hausbank kann Chips abheben',
    'housebank.amount': '🏛️ Heb eine ganze Zahl an Chips ab, mindestens 1',
    'housebank.balance': '🏛️ In der Hausbank sind nur {total} Chips',
    'housebank.casino': '🏛️ Die Hausbank ist an der Kasse, unten im Casino',
    'housebank.withdrew': '🏛️ Du hast {amount} Chips aus der Hausbank abgehoben',
    'housebank.ownerSet': '{who} hat {name} die Hausbank übergeben',
    'housebank.ownerNone': '{who} hat der Hausbank ihre Besitzerin oder ihren Besitzer genommen: niemand besitzt sie jetzt',
    'shop.casino': '🛍️ Der Shop ist unten im Casino, durch die Tür in der Südwestecke',
    'shop.chips': '🛍️ Das kostet {price} Chips, und du hast {balance}',
    'shop.owned': '🛍️ Das hast du schon: an- und ablegen kannst du es im Shop',
    'shop.item': '🛍️ Das gibt es im Shop nicht',
  },
);

export type NoticeKey = keyof typeof NOTICES.en;

/** `text` with each `{name}` in it replaced by `params.name`, or the function's words for them. */
export function fill(text: NoticeText, params: NoticeParams = {}): string {
  if (typeof text === 'function') return text(params);
  return text.replace(/\{(\w+)\}/g, (all, name: string) => (name in params ? String(params[name]) : all));
}

/** A toast in English, with what a browser needs to say it in your language. */
export function notice(key: NoticeKey, params: NoticeParams = {}): Notice {
  return { text: fill(NOTICES.en[key], params), key, params };
}

/** A notice as it is, or plain English text from somewhere without a key (an error git or GitHub gave). */
export function asNotice(n: string | Notice): Notice {
  return typeof n === 'string' ? { text: n } : n;
}
