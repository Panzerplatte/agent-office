# Entscheidung: Webdesign-Aufträge und Live-Vorschau

Debatte im Besprechungsraum, 4 Runden (Vorsitz, Pragmatiker, Skeptiker, Vereinfacher), 2026-10-04.

## Die Frage
1. Der Nutzer sagt „Baue eine Webseite für Unternehmen X aus Y“ oder schickt einen Link zur alten Seite. Dabei sollen die drei Design-Skills (`design-taste-frontend`, `emil-design-eng`, `web-design-guidelines`) genutzt werden, und jede Seite soll anders aussehen.
2. Die Seite soll während des Baus sichtbar sein. Ein Klick in der Dienste-Tafel öffnet sie in einem eigenen Fenster daneben. Dieses Fenster kann man im Meeting teilen, und es zeigt Änderungen der Worker sofort.

## Entschieden

### 0. Einrichtung, einmalig, ohne Code
- Die drei Design-Skills **auf dem Office-Rechner** unter `~/.claude/skills/<name>/` installieren.
  - Geprüft: Dort liegt heute nur `~/.claude/skills/synced/<uuid>` (docs, pdf, pptx, …), **keine** der drei.
  - Ohne diesen Schritt bewirkt alles Weitere nichts.
- Danach in einem Worker prüfen, ob sie sichtbar sind.
- Ein Repo `websites` als Etage anlegen: ein Ordner pro Kunde, ein Worktree pro Auftrag. Ein Repo pro Kunde wäre zu viel GitHub-Aufwand.
- Nur **Claude-Worker**: Codex- und OpenCode-Worker haben keine Skills.

### 1. Skill `webseite`, ohne Office-Code
Ablage: `~/.claude/skills/webseite/SKILL.md` auf Benutzerebene, also für jeden Worker auf jeder Etage und auch außerhalb des Office. Er wird ausgelöst durch den Satz „Baue eine Webseite für …“ oder durch eine URL. Ablauf:
1. **Prüfen**, ob die drei Skills vorhanden sind. Wenn nicht: laut abbrechen mit Installationshinweis, statt still eine Allerweltsseite zu bauen.
2. **Briefing** nach `brief.md`:
   - Bei einer URL die alte Seite per WebFetch lesen.
   - **Rechte-Regel:** Texte und Fakten übernehmen. Bilder und Logo nur vom Kunden selbst, sonst Platzhalter. Das Design der Altseite nicht kopieren.
   - Ohne URL: kurze Recherche zu Firma, Branche und Ort.
3. **Zufallsziehung aus der Shell** (`shuf -n1` je Achse), nicht vom Modell:
   - Achsen: Layout-Archetyp × Schriftpaar × Palette-Typ × Bildsprache.
   - Die letzten 5 Kombinationen aus dem Verlauf sind gesperrt. Gesperrt ist auch jede Ziehung, die einer davon in 3 von 4 Achsen gleicht (*Nachtrag*).
   - Das Ergebnis wird **vor dem Bauen** in `brief.md` festgeschrieben.
   - Im selben Schritt wird eine Zeile an den **globalen Verlauf** `~/.claude/webseite-verlauf.md` angehängt (*Nachtrag*, war Schritt 7). Die Datei liegt außerhalb der Repos und des Skill-Ordners, es wird nur angehängt.
4. `design-taste-frontend` setzt die gezogene Richtung um.
5. **Zuerst Vite scaffolden und `npm run dev` starten**, erst dann Inhalte bauen. So erscheint die Seite sofort in den Diensten und wächst live. **Ohne `--host`** und **ohne festen Port** bzw. `--strictPort`.
6. Bauen → `emil-design-eng` (Feinschliff, Bewegung) → `web-design-guidelines` (Prüfung, Mängel beheben).

Aufwand: etwa 1–2 h inkl. Test an zwei Beispielfirmen.

### 2. Office: Knopf „🖥 Vorschau“ in der Dienste-Tafel
- Ort: `src/client/ui/services.ts`, neben „Öffnen“.
- Aufruf: `window.open(previewUrl(port), 'ao-preview', 'popup,width=1280,height=900')`.
- **Ein fester Fenstername für alle Dienste.** Jeder Klick lädt in dasselbe Fenster. Man zieht es einmal auf den zweiten Bildschirm, teilt es einmal in Teams, Meet oder Zoom, und beim Wechsel zur nächsten Seite bleibt das Teilen bestehen.
- Live-Updates kommen vom HMR des Dev-Servers. Der Relay reicht HTTP und WebSocket-Upgrades schon durch (`server.ts` → `relayRequest`/`relayUpgrade`). Das Office baut keinen eigenen Reload.
- i18n de/en.
- Ein Absatz in `docs/features.md`: Einrichtung, Vorschau, Hinweis „nur Claude-Worker“.

### 3. Office: ein Tunnel für alle Vorschauen (`p<port>.localhost`)
- Hintergrund: Das Office läuft auf einem Server, der Designer sitzt an seinem eigenen Rechner. Heute braucht jeder Dienst-Port einen eigenen SSH-Tunnel. Neue Seite heißt neuer Port, und das geteilte `ao-preview`-Fenster zeigt „Verbindung fehlgeschlagen“. Genau der gewünschte Ablauf würde brechen.
- Änderung in `src/server/relay.ts`, `tunneledPort`:
  - Ist der Host `p<port>.localhost:<office-port>`, gilt der Port aus der Subdomain.
  - Das gilt nur, wenn `services.lookup` diesen Port einem Worker zuordnet.
  - Grund: `LOOPBACK_HOST` akzeptiert `*.localhost` heute zwar, nimmt aber den Port hinter dem Doppelpunkt und verwirft den Office-Port. Es ist also echte, aber kleine Arbeit (~10–20 Zeilen + Unit-Test).
- `previewUrl` im Client:
  - Wird das Office über `localhost` geöffnet (lokal oder über einen Tunnel): `p<port>.localhost:<location.port>`.
  - Sonst: das heutige `localhost:<port>` mit Tunnelhinweis.
- Anmeldung: `p<port>.localhost` ist ein eigener Cookie-Host. Beim ersten Aufruf je Seite erscheint deshalb einmal die **schon vorhandene** Relay-Anmeldeseite (`signInPage` → `RELAY_LOGIN` → Login → Reload). Am Auth-Code ändert sich nichts. Nicht versprechen, dass es ohne Anmeldung geht.
- Akzeptanztest:
  - Vite in einem Worker starten, eine Datei ändern: Das Popup aktualisiert sich (HMR über den Relay).
  - Auf einen zweiten Dienst wechseln: Er lädt im selben Fenster, das Teilen bleibt.

Aufwand für Punkt 2 und 3 in **einem PR**: etwa 1 Tag.

## Warum so
- Fast alles existiert schon: Die Dienste-Erkennung (`services.ts`), der Relay mit Login und WebSocket und der HMR von Vite. Gebaut wird nur das fehlende Stück, ein Knopf und eine Routing-Regel.
- „Immer unterschiedlich“ ist eine Frage des Prompts und des Zufalls, nicht von Code. Wählt das Modell selbst, landet es beim selben Lieblingslook. Erst die Shell-Ziehung mit globalem Verlauf erzwingt Abwechslung.
- Ein eigenes Fenster statt einer Einbettung ins Office lässt sich am besten teilen. Bildschirm-Teilen übernimmt das Meeting-Tool des Nutzers.

## Verworfene Optionen
| Option | Von | Warum verworfen |
|---|---|---|
| Pfad-Proxy `/svc/<port>/` | Skeptiker R1 | Bricht absolute Pfade (`/@vite/client`, `/_next`). Unnötig, weil der Relay schon nach Host-Header routet. In R2 selbst zurückgezogen. |
| iframe/Splitscreen im 3D-Office | – (von allen abgelehnt) | X-Frame-Options, zu klein, schlechter zu teilen als ein eigenes Fenster. |
| Eigener Watcher, Live-Reload-Injektion, Screenshot-Stream | – | HMR des Dev-Servers über den vorhandenen Relay reicht. |
| Ein Fenster pro Port (`vorschau-<port>`) | Vorsitz R1 | Neue Seite heißt neues Fenster, und das Teilen bricht ab. |
| Fester Vorschau-Port 4999 mit Server-Zuordnung | Pragmatiker R2 | Globaler Zustand auf dem Server: Klickt ein Kollege „Vorschau“, springt *dein* geteiltes Fenster mit. Etwa 1 Tag Aufwand. |
| Port-Bereich 5173–5179 + ein Tunnelbefehl mit 7× `-L` | Vorsitz R2, Vereinfacher R3 | Mit `--strictPort` kollidieren parallele Worker. Ab dem 8. Dienst ist Schluss. Ist beim Designer lokal schon ein Port belegt, scheitert der ganze Tunnel (`ExitOnForwardFailure`). Der Vorteil „kein Server-Code“ wiegt das nicht auf. Der Einwand „das Cookie fehlt auf `p<port>.localhost`“ trifft nicht zu, weil die Relay-Anmeldeseite genau diesen Fall abdeckt. |
| Nur Knopf, Tunnel weiter pro Port | Vereinfacher R2 | Lokal reicht das. Remote ist hier aber der Normalfall, und dann bricht das geteilte Fenster beim Seitenwechsel. |
| Prompt-Vorlage / Hire-Preset im Office | Skeptiker R1 | Doppelt zum Skill, der ohnehin über den Satz oder die URL ausgelöst wird. In R3 zurückgezogen. |
| Die 3 Skills ins Office-Repo kopieren | – | Fremde Skills: Lizenz und Updates unklar. |
| Verlauf im Kundenprojekt bzw. im `websites`-Repo | Pragmatiker R1/R2 | Er sieht nur einen Kunden bzw. hat eine Kopie pro Worktree. Parallele Aufträge sehen sich nicht, und es gibt Merge-Konflikte. |
| Verlauf im Skill-Ordner | Vorsitz R1/R2 | Der Skill-Ordner kann synchronisiert oder verwaltet sein, und das Schreiben dort ist fragil. → `~/.claude/webseite-verlauf.md` |
| `npm run dev -- --host` | Pragmatiker, Vereinfacher | Öffnet den Dev-Server ohne Office-Login im LAN, je nach Security Group auch öffentlich. Der Relay braucht es nicht. |
| Popup-Position `left=availWidth/2` | Vorsitz R1 | Browser ignorieren das über Monitore hinweg. Einmal hinziehen, der Browser merkt es sich. |

## Offen
- **Office über eine öffentliche Domain** (TLS, kein localhost-Tunnel): `p<port>.localhost` greift dort nicht. Lösen ließe sich das mit Wildcard-DNS + Wildcard-Zertifikat (`p5173.office.example`). Erst angehen, wenn jemand so arbeitet.
- **„Vorschau folgt“:** Das Popup springt von selbst zum neuen Dienst des Workers (BroadcastChannel). Nur bauen, wenn es im Alltag fehlt. Ein Auto-Popup ohne Klick blockieren Browser ohnehin.
- **Inhalt der Stil-Achsen:** festgelegt im Skill (`~/.claude/skills/webseite/achsen/*.txt`): 12 Layout-Archetypen, 12 Schriftpaare (selbst gehostet über `@fontsource`), 9 Palette-Typen, 6 Bildsprachen; seit dem Nachtrag „Modern-Regel“ nur zeitgemäße Optionen. Offen bleibt: nach 5–10 Seiten prüfen, ob die Seiten wirklich verschieden wirken.
- **Reihenfolge bei Konflikten zwischen den Skills** (`design-taste-frontend` gegen `web-design-guidelines`): Faustregel „Richtung vor Regeln, Regeln vor Abgabe“. Bei Barrierefreiheit gewinnen die Guidelines. Am ersten echten Auftrag nachschärfen.
- **Ob ein Worker die synchronisierten Skills (`synced/<uuid>`) auch unter ihrem Namen findet**, ist ungeklärt. Bis dahin gilt die Installation unter `~/.claude/skills/<name>/` aus Schritt 0.

## Nächste Schritte
1. **Erledigt (2026-10-04):** Die drei Skills liegen auf dem Office-Rechner unter `~/.claude/skills/<name>/`, je mit `HERKUNFT.txt` (Quelle, Commit, Update-Befehl). **Offen:** in einem Worker prüfen, ob sie sichtbar sind.
2. **Teilweise erledigt:** `~/.claude/skills/webseite/SKILL.md` ist geschrieben, dazu `check-skills.sh`, `draw.sh` und `achsen/*.txt`. Getestet sind der Abbruch bei fehlenden Skills und die Ziehung samt Sperre, auch bei parallelen Aufträgen. **Offen:** der Test an zwei Beispielfirmen. Er braucht Schritt 1.
3. **Erledigt:** Office-PR, aufgeteilt in zwei PRs:
   - #61: `p<port>.localhost`-Routing im Relay.
   - #62: Vorschau-Knopf, `previewUrl`, i18n, `docs/features.md`.
   - **Offen:** der Akzeptanztest aus Punkt 3 mit einem echten Vite-Dienst.
4. **Offen:** Das Repo `websites` als Etage anlegen (Schritt 0).

## Nachtrag beim Schreiben des Skills (2026-10-04)
Zwei Abweichungen vom Meeting-Stand, beide im Ablauf oben schon eingearbeitet:
- **Verlauf bei der Ziehung statt am Ende (früher Schritt 7).**
  - Grund: Wird die Zeile erst bei der Abgabe geschrieben, sehen gleichzeitig laufende Aufträge die Ziehung des anderen nicht und können dieselbe Kombination ziehen.
  - Jetzt laufen Verlauf lesen, ziehen und anhängen in `draw.sh` unter einem Lock (`flock`).
  - Folge: Auch ein abgebrochener Auftrag sperrt seine Kombination für die nächsten 5 Ziehungen. Das ist gewollt: lieber eine Sperre zu viel als zwei gleiche Seiten.
- **Strengere Sperre: 3 von 4 Achsen.**
  - Grund: Bei 12 × 10 × 8 × 6 = 5760 Kombinationen greift eine Sperre nur auf exakt gleiche Kombinationen praktisch nie.
  - Ohne die Regel zählte „nur die Bildsprache ist anders“ schon als neue Seite.

## Nachtrag: Vorschau auf dem Office-TV (2026-10-04)
- **Drei Skills statt vier.** Das Meeting nannte zusätzlich `taste`. Gemeint ist `design-taste-frontend` (aus Leonxlnx/taste-skill), kein eigener Skill. Der einzige Skill, der wirklich `taste` heißt, kopiert das Design einer URL, hat keine Lizenz und widerspricht der Regel „das Design der Altseite nicht kopieren“. Die Zahlen oben sind entsprechend korrigiert.
- **Die Vorschau aus Punkt 2 und 3 lädt bei uns nicht.** `p<port>.localhost` funktioniert nur, wenn das Office über `localhost` geöffnet wird (lokal oder per SSH-Tunnel). Unsere Leute öffnen das Office remote, also bleibt das Popup leer. Das war unter „Offen“ (öffentliche Domain) schon absehbar; es ist der Normalfall.
- **Neu: Der Office-SERVER öffnet die Seite selbst** und zeigt sie auf dem Lounge-TV der Etage im 3D-Office.
  - `src/server/tvbrowser.ts`: ein headless Chromium (playwright-core) auf dem Office-Rechner. Dort funktioniert `http://localhost:<port>` einfach, HMR inklusive, weil es ein normaler Browser ist.
  - Gestreamt per DevTools-Screencast als JPEG an alle auf der Etage: ~8 Bilder/s, ~15 während jemand das TV im Vollbild hat, nichts, wenn niemand auf der Etage ist.
  - Bedienen darf jeder auf der Etage (Maus, Tastatur, zurück/vor/neu laden, Desktop 1280×720 oder Mobil 390×844). Es ist ein gemeinsamer Fernseher.
  - Nur Dienste, die die Dienste-Tafel als Worker-Dienst dieser Etage listet. Navigation nur innerhalb von `localhost:<port>`; Popups, Downloads und andere Ursprünge sind gesperrt.
  - Eine laufende Bildschirmfreigabe hat auf dem TV Vorrang.
  - Chromium: `AGENT_OFFICE_CHROMIUM`, sonst `<Office-Home>/chromium/chromium`, sonst `~/.local/share/agent-office/chromium/chromium` (ein eigenständiges Chromium, das keine Systembibliotheken braucht), sonst das von Playwright (`npx playwright-core install chromium`), sonst ein System-Chrome/Chromium. Eins, das nicht startet, wird übersprungen.
- Das Popup aus Punkt 2 bleibt für den lokalen Fall. Ins Meeting-Tool teilen ist damit nicht mehr nötig: Wer auf der Etage ist, sieht die Seite auf dem TV.

## Nachtrag: Modern-Regel (2026-10-05)
Rückmeldung: Einige Seiten wirkten veraltet, vor allem durch klassische Serifen. Seitdem gilt im Skill eine **Modern-Regel** (Web 2025/2026: Linear, Vercel, Stripe, Framer-Agenturseiten), egal was gezogen wird:
- **Schriftpaare:** nur moderne Groteskschriften (Inter Tight, Geist, Plus Jakarta Sans, Sora, Space Grotesk, Unbounded, Syne, Bricolage Grotesque, Archivo, Outfit, Familjen Grotesk, Instrument Sans …). Playfair Display, Cormorant Garamond, DM Serif Display, Newsreader und Fraunces sind raus. Einzige Serife: Instrument Serif, nur kursiv für einzelne Wörter in Headlines, nie im Fließtext.
- **Achsen:** „Long-Read“ (Marginalien) und „Sidebar“ (wie ein Handbuch) sind durch **Product-Showcase** und **Stat-Hero** ersetzt; „Erdtöne“ wird zu „Warme Neutrale“, neu ist „Hell + Verlauf“; „Schwarzweiß körnig“ wird zu „Schwarzweiß kontrastreich“ (ohne Korn).
- **Gestaltung:** große, selbstbewusste Typo-Skala, viel Weißraum, dezente Radien, aktuelle UI-Muster. Keine Drop Caps, Kapitälchen-Köpfe, Papier- oder Korn-Texturen, Ornamente oder skeuomorphen Rahmen. Die Regel geht an `design-taste-frontend` mit.
- **Prüfung vor „Live gehen“:** `schrift-pruefen.mjs` (in `live-pruefen.sh`) verweigert jede Schriftfamilie im gebauten CSS, die nicht in `achsen/schrift.txt` steht oder verboten ist. Seiten mit einem alten Schriftpaar müssen vor dem Livegang auf ein aktuelles Paar umgestellt werden.
- Alte Namen im Verlauf brechen die Ziehung nicht: Sie zählen in der Sperre mit, gleichen aber keiner neuen Option.
