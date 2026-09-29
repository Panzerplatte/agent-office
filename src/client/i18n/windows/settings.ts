import { strings } from '../table';

/** ui/settings.ts */
export default strings(
  {
    'settings.title': 'Settings',
    'settings.heading': '⚙️ Settings',

    // Camera
    'settings.cameraView': 'Camera view',
    'settings.viewFirst': '👀 First person',
    'settings.viewFirstNote': 'See through your own eyes. Click the office to look around with the mouse and click things to use them. Esc frees the mouse.',
    'settings.viewThird': '🎥 Third person',
    'settings.viewThirdNote': 'Follow your character from behind. Drag to orbit the camera, scroll to zoom, and click things to use them.',

    // Sound
    'settings.muted': 'Muted',
    'settings.mute': '🔇 Mute',
    'settings.unmute': '🔊 Unmute',
    'settings.officeSounds': 'Office sounds',
    'settings.soundsVolume': 'Office sounds volume',
    'settings.soundsNote': 'Workers typing, footsteps, the coffee machine, birds and rain outside, the dog, and the ding when a worker is done. Voice chat isn’t affected.',
    'settings.voiceChat': 'Voice chat',
    'settings.openMic': '🎙️ Open mic',
    'settings.pushToTalk': '✋ Push to talk',
    'settings.voiceNote': 'Either way, V joins voice, holding V talks and you’re muted once you let go, and M mutes or unmutes. With push to talk you join muted. Leave voice from the ☰ menu.',
    'settings.jukebox': '🎵 Jukebox',
    'settings.jukeboxVolume': 'Jukebox volume',
    'settings.jukeboxNote': 'The jukebox in the lounge. Everyone on the floor hears the same song, louder the closer they are to it; this is how loud it is for you alone.',

    // Outside
    'settings.outside': 'Outside',
    'settings.outsideLive': 'Everyone sees the same sky: the office’s clock and the live weather where it is.',
    'settings.outsideMade': 'Everyone sees the same sky: the office’s clock, and weather that comes and goes. Start the office with --city to use a real city’s forecast.',

    // Holiday theme
    'settings.holidayTheme': 'Holiday theme',
    'settings.themeAuto': '📅 By the calendar',
    'settings.themeHalloween': '🎃 Halloween',
    'settings.themeChristmas': '🎄 Christmas',
    'settings.themeOff': 'Off',
    'settings.themeNowHalloween': 'Halloween: the workers are zombies, your hands are an undead warlock’s, the dog’s in costume, the sky’s gone creepy and there are jack-o’-lanterns everywhere.',
    'settings.themeNowChristmas': 'Christmas: the workers are elves, your hands are in mittens, the dog’s Rudolph, and it’s snowing outside.',
    'settings.themeNowNone': 'No decorations up right now.',
    'settings.themeByCalendar': ' By the calendar it’s Halloween through October and Christmas through December.',
    'settings.sameForEveryone': 'It’s the same for everyone in the building.',
    'settings.sameForEveryoneBy': 'It’s the same for everyone in the building, set by {by}{when}.',

    // Desktop notifications
    'settings.desktopNotifications': 'Desktop notifications',
    'settings.notifyTurnOn': '🔔 Turn on notifications',
    'settings.notifyOn': '🔔 On',
    'settings.notifyOff': '🔕 Off',
    'settings.notifyShowOne': 'Show me one',
    'settings.notifyUnsupported': 'This browser can’t show notifications from the office here. They need https or localhost (an SSH tunnel counts).',
    'settings.notifyDenied': 'Your browser blocks notifications from the office. Allow them in the site settings (the icon left of the address), then open this again.',
    'settings.notifyNote': 'When a worker needs input or finishes while you’re in another tab or app, you get a notification. Click it to jump to that worker’s terminal. The tab title counts the workers waiting on someone either way.',

    // Team notifications
    'settings.teamNotifications': 'Team notifications (Slack / Discord)',
    'settings.webhookAria': 'Slack or Discord webhook URL',
    'settings.webhookOther': 'a webhook',
    'settings.save': 'Save',
    'settings.replace': 'Replace',
    'settings.sendTest': 'Send a test',
    'settings.remove': 'Remove',
    'settings.webhookNone': 'Paste an incoming webhook from Slack or Discord, and the office posts to that channel when a worker needs input or finishes and nobody has its terminal open. It’s for everyone in the office.',
    'settings.webhookFailed': '⚠️ Posting to {where} ({hint}) failed: {error}',
    'settings.webhookPosting': '📣 Posting to {where} ({hint}), set by {by} {when}{last}.',
    'settings.webhookLast': ' · last message {when}',

    // Default worker
    'settings.defaultWorker': '🤖 Default worker',
    'settings.agentBack': 'Back to {agent}',
    'settings.agentBackFallback': 'the --agent',
    'settings.agentNote': 'Every worker starts on this: hired at a desk, handed an issue or a pull request from the boards, taken off the queue, the board agents and meetings. Where you start one, ✏️ Edit picks another just for it.',
    'settings.setBy': ' Set by {by} {when}.',
    'settings.agentStartedWith': ' It’s the agent the office was started with, on its own default model.',
    'settings.adminsCanChange': ' Admins can change it.',

    // Prompts
    'settings.prompts': '📝 Prompts',
    'settings.promptsEdit': '📝 Edit the prompts…',
    'settings.promptsRead': '📝 Read the prompts…',
    'settings.promptsNote': 'What 🤖 Hand to a worker, 🔍 Review and the boards’ other buttons tell a worker, the note the queue adds to a task, the board agents’ briefs, the meeting room’s parts and the sign writer’s instructions. ',
    'settings.promptsRewritten': (v) => `${v.n} of them rewritten.`,
    'settings.promptsAsWritten': 'All as the office wrote them.',
    'settings.adminsCanRewrite': ' Admins can rewrite them.',

    // Worker limit
    'settings.workerLimit': '👷 Worker limit',
    'settings.limitAria': 'Most workers at once',
    'settings.setLimit': 'Set limit',
    'settings.limitRange': '1 to {n}',
    'settings.limitExample': 'e.g. 6',
    'settings.limitBack': 'Back to {n}',
    'settings.noLimit': 'No limit',
    'settings.limitNone': (v) => `No limit: the office hires a worker for every free seat. ${v.n} ${Number(v.n) === 1 ? 'is' : 'are'} here now, across every floor.`,
    'settings.limitAt': (v) => `At most ${v.limit} worker${Number(v.limit) === 1 ? '' : 's'} at once, across every floor (${v.n} now), shells and board agents too. Hiring past that is refused.`,
    'settings.limitCap': ' The office was started with --max-workers {n}, so it can’t go any higher.',

    // Leave on merge
    'settings.leaveLabel': '🎉 Workers whose pull request merged',
    'settings.leaveAria': 'Workers whose pull request merged',
    'settings.leaveGoHome': '🏠 Go home by themselves',
    'settings.leaveStay': '🪑 Stay until sent home',
    'settings.leaveOn': 'Once a worker’s pull request merges, it goes home as soon as it isn’t working or waiting on you and nobody has its terminal open, and its worktree and branch are deleted. A worktree with uncommitted changes, or commits that aren’t on GitHub, is kept.',
    'settings.leaveOff': 'A worker whose pull request merged stays at its desk, outlined in purple, until someone sends it home. Turned on, the ones already merged go too.',

    // Workspace folder
    'settings.workspaceLabel': '📁 Workspace folder',
    'settings.workspaceAria': 'Workspace folder',
    'settings.useDefault': 'Use the default',
    'settings.workspaceNote': 'New projects from the elevator are cloned into {dir}/<owner>/<repo> on the office’s machine.',
    'settings.workspaceAdmin': ' A checkout of the same repository that’s already there is used as it is. Floors you already have stay where they are.',
    'settings.workspaceNotAdmin': ' An admin can move it.',

    // Dog
    'settings.dogLabel': 'Office dog',
    'settings.dogAria': 'The dog’s name',
    'settings.rename': 'Rename',
    'settings.dogNote': '{name} lives on this floor. When a worker needs input, {name} runs to its desk and barks. Walk up and press E to pet it. A new name is for everyone on this floor.',

    // You
    'settings.yourCharacter': 'Your character',
    'settings.changeLook': '🧍 Change your look',
    'settings.changeLookName': '🧍 Change your look & name',
    'settings.signedIn': 'Signed in',
    'settings.signOut': '🚪 Sign out',
    'settings.signedInAs': 'As {name}, with your own account ({role}).',
    'settings.signedInShared': 'With the shared office password.',
    'settings.roleAdmin': 'admin',
    'settings.roleMember': 'member',
  },
  {
    'settings.title': 'Einstellungen',
    'settings.heading': '⚙️ Einstellungen',

    // Kamera
    'settings.cameraView': 'Kameraansicht',
    'settings.viewFirst': '👀 Ego-Perspektive',
    'settings.viewFirstNote': 'Sieh durch deine eigenen Augen. Klick ins Büro, um dich mit der Maus umzusehen, und klick Dinge an, um sie zu benutzen. Esc gibt die Maus wieder frei.',
    'settings.viewThird': '🎥 Third Person',
    'settings.viewThirdNote': 'Folge deiner Figur von hinten. Ziehen dreht die Kamera, Scrollen zoomt, und Klicken benutzt Dinge.',

    // Ton
    'settings.muted': 'Stumm',
    'settings.mute': '🔇 Stumm',
    'settings.unmute': '🔊 Ton an',
    'settings.officeSounds': 'Bürogeräusche',
    'settings.soundsVolume': 'Lautstärke der Bürogeräusche',
    'settings.soundsNote': 'Tippende Worker, Schritte, die Kaffeemaschine, Vögel und Regen draußen, der Hund und das Ding, wenn ein Worker fertig ist. Der Sprachchat bleibt davon unberührt.',
    'settings.voiceChat': 'Sprachchat',
    'settings.openMic': '🎙️ Offenes Mikro',
    'settings.pushToTalk': '✋ Push-to-Talk',
    'settings.voiceNote': 'So oder so: V tritt dem Sprachchat bei, solange du V hältst, sprichst du, und beim Loslassen bist du stumm; M schaltet stumm oder wieder laut. Mit Push-to-Talk trittst du stumm bei. Den Sprachchat verlässt du über das ☰-Menü.',
    'settings.jukebox': '🎵 Jukebox',
    'settings.jukeboxVolume': 'Lautstärke der Jukebox',
    'settings.jukeboxNote': 'Die Jukebox in der Lounge. Alle auf der Etage hören denselben Song, je näher sie dran sind, desto lauter; hier stellst du ein, wie laut er nur für dich ist.',

    // Draußen
    'settings.outside': 'Draußen',
    'settings.outsideLive': 'Alle sehen denselben Himmel: die Uhrzeit des Büros und das aktuelle Wetter dort.',
    'settings.outsideMade': 'Alle sehen denselben Himmel: die Uhrzeit des Büros und Wetter, das kommt und geht. Starte das Büro mit --city, um die Vorhersage einer echten Stadt zu nutzen.',

    // Feiertags-Deko
    'settings.holidayTheme': 'Feiertags-Deko',
    'settings.themeAuto': '📅 Nach Kalender',
    'settings.themeHalloween': '🎃 Halloween',
    'settings.themeChristmas': '🎄 Weihnachten',
    'settings.themeOff': 'Aus',
    'settings.themeNowHalloween': 'Halloween: Die Worker sind Zombies, deine Hände die eines untoten Hexers, der Hund ist verkleidet, der Himmel ist gruselig und überall stehen Kürbislaternen.',
    'settings.themeNowChristmas': 'Weihnachten: Die Worker sind Elfen, deine Hände stecken in Fäustlingen, der Hund ist Rudolph, und draußen schneit es.',
    'settings.themeNowNone': 'Gerade hängt keine Deko.',
    'settings.themeByCalendar': ' Nach Kalender ist den ganzen Oktober Halloween und den ganzen Dezember Weihnachten.',
    'settings.sameForEveryone': 'Das gilt für alle im Gebäude.',
    'settings.sameForEveryoneBy': 'Das gilt für alle im Gebäude, eingestellt von {by}{when}.',

    // Desktop-Benachrichtigungen
    'settings.desktopNotifications': 'Desktop-Benachrichtigungen',
    'settings.notifyTurnOn': '🔔 Benachrichtigungen einschalten',
    'settings.notifyOn': '🔔 An',
    'settings.notifyOff': '🔕 Aus',
    'settings.notifyShowOne': 'Zeig mir eine',
    'settings.notifyUnsupported': 'Dieser Browser kann hier keine Benachrichtigungen vom Büro anzeigen. Dafür braucht es https oder localhost (ein SSH-Tunnel zählt).',
    'settings.notifyDenied': 'Dein Browser blockiert Benachrichtigungen vom Büro. Erlaube sie in den Website-Einstellungen (das Symbol links neben der Adresse) und öffne das hier dann noch mal.',
    'settings.notifyNote': 'Wenn ein Worker eine Eingabe braucht oder fertig wird, während du in einem anderen Tab oder einer anderen App bist, bekommst du eine Benachrichtigung. Klick darauf, um direkt zum Terminal dieses Workers zu springen. Der Tab-Titel zählt so oder so die Worker, die auf jemanden warten.',

    // Team-Benachrichtigungen
    'settings.teamNotifications': 'Team-Benachrichtigungen (Slack / Discord)',
    'settings.webhookAria': 'Slack- oder Discord-Webhook-URL',
    'settings.webhookOther': 'einen Webhook',
    'settings.save': 'Speichern',
    'settings.replace': 'Ersetzen',
    'settings.sendTest': 'Test senden',
    'settings.remove': 'Entfernen',
    'settings.webhookNone': 'Füg einen eingehenden Webhook von Slack oder Discord ein, dann postet das Büro in diesen Kanal, wenn ein Worker eine Eingabe braucht oder fertig wird und niemand sein Terminal offen hat. Das gilt für alle im Büro.',
    'settings.webhookFailed': '⚠️ Posten an {where} ({hint}) fehlgeschlagen: {error}',
    'settings.webhookPosting': '📣 Postet an {where} ({hint}), eingestellt von {by} {when}{last}.',
    'settings.webhookLast': ' · letzte Nachricht {when}',

    // Standard-Worker
    'settings.defaultWorker': '🤖 Standard-Worker',
    'settings.agentBack': 'Zurück zu {agent}',
    'settings.agentBackFallback': 'dem --agent',
    'settings.agentNote': 'Damit startet jeder Worker: am Schreibtisch eingestellt, mit einem Issue oder Pull Request von den Boards beauftragt, aus der Warteschlange genommen, die Board-Agents und Besprechungen. Wo du einen startest, wählt ✏️ Bearbeiten einen anderen nur für ihn.',
    'settings.setBy': ' Eingestellt von {by} {when}.',
    'settings.agentStartedWith': ' Das ist der Agent, mit dem das Büro gestartet wurde, mit seinem eigenen Standardmodell.',
    'settings.adminsCanChange': ' Admins können das ändern.',

    // Prompts
    'settings.prompts': '📝 Prompts',
    'settings.promptsEdit': '📝 Prompts bearbeiten…',
    'settings.promptsRead': '📝 Prompts lesen…',
    'settings.promptsNote': 'Was 🤖 An einen Worker übergeben, 🔍 Review und die anderen Buttons der Boards einem Worker sagen, die Notiz, die die Warteschlange an eine Aufgabe hängt, die Briefings der Board-Agents, die Rollen im Besprechungsraum und die Anweisungen für den Schildermaler. ',
    'settings.promptsRewritten': (v) => (Number(v.n) === 1 ? '1 davon umgeschrieben.' : `${v.n} davon umgeschrieben.`),
    'settings.promptsAsWritten': 'Alle so, wie das Büro sie geschrieben hat.',
    'settings.adminsCanRewrite': ' Admins können sie umschreiben.',

    // Worker-Limit
    'settings.workerLimit': '👷 Worker-Limit',
    'settings.limitAria': 'Höchstens so viele Worker gleichzeitig',
    'settings.setLimit': 'Limit setzen',
    'settings.limitRange': '1 bis {n}',
    'settings.limitExample': 'z. B. 6',
    'settings.limitBack': 'Zurück auf {n}',
    'settings.noLimit': 'Kein Limit',
    'settings.limitNone': (v) => `Kein Limit: Das Büro stellt für jeden freien Platz einen Worker ein. Gerade ${Number(v.n) === 1 ? 'ist 1' : `sind ${v.n}`} da, über alle Etagen.`,
    'settings.limitAt': (v) => `Höchstens ${v.limit} Worker gleichzeitig, über alle Etagen (gerade ${v.n}), Shells und Board-Agents mitgezählt. Wer darüber hinaus einstellen will, wird abgewiesen.`,
    'settings.limitCap': ' Das Büro wurde mit --max-workers {n} gestartet, höher geht es also nicht.',

    // Nach dem Merge
    'settings.leaveLabel': '🎉 Worker mit gemergtem Pull Request',
    'settings.leaveAria': 'Worker mit gemergtem Pull Request',
    'settings.leaveGoHome': '🏠 Gehen von selbst nach Hause',
    'settings.leaveStay': '🪑 Bleiben, bis man sie heimschickt',
    'settings.leaveOn': 'Sobald der Pull Request eines Workers gemergt ist, geht er nach Hause, sobald er nicht mehr arbeitet oder auf dich wartet und niemand sein Terminal offen hat, und sein Worktree und Branch werden gelöscht. Ein Worktree mit nicht committeten Änderungen oder Commits, die nicht auf GitHub sind, bleibt erhalten.',
    'settings.leaveOff': 'Ein Worker, dessen Pull Request gemergt ist, bleibt lila umrandet an seinem Schreibtisch, bis ihn jemand nach Hause schickt. Schaltest du es ein, gehen auch die schon gemergten.',

    // Workspace-Ordner
    'settings.workspaceLabel': '📁 Workspace-Ordner',
    'settings.workspaceAria': 'Workspace-Ordner',
    'settings.useDefault': 'Standard verwenden',
    'settings.workspaceNote': 'Neue Projekte aus dem Aufzug werden auf dem Rechner des Büros nach {dir}/<owner>/<repo> geklont.',
    'settings.workspaceAdmin': ' Ein Checkout desselben Repositorys, das schon dort liegt, wird so verwendet, wie es ist. Etagen, die du schon hast, bleiben, wo sie sind.',
    'settings.workspaceNotAdmin': ' Ein Admin kann ihn verschieben.',

    // Hund
    'settings.dogLabel': 'Bürohund',
    'settings.dogAria': 'Name des Hundes',
    'settings.rename': 'Umbenennen',
    'settings.dogNote': '{name} wohnt auf dieser Etage. Wenn ein Worker eine Eingabe braucht, rennt {name} zu seinem Schreibtisch und bellt. Geh hin und drück E, um ihn zu streicheln. Ein neuer Name gilt für alle auf dieser Etage.',

    // Du
    'settings.yourCharacter': 'Deine Figur',
    'settings.changeLook': '🧍 Aussehen ändern',
    'settings.changeLookName': '🧍 Aussehen & Namen ändern',
    'settings.signedIn': 'Angemeldet',
    'settings.signOut': '🚪 Abmelden',
    'settings.signedInAs': 'Als {name}, mit deinem eigenen Konto ({role}).',
    'settings.signedInShared': 'Mit dem gemeinsamen Büro-Passwort.',
    'settings.roleAdmin': 'Admin',
    'settings.roleMember': 'Mitglied',
  },
);
