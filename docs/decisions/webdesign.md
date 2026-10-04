# Entscheidung: Webdesign-Aufträge und Live-Vorschau

Debatte im Besprechungsraum, 4 Runden (Vorsitz, Pragmatiker, Skeptiker, Vereinfacher), 2026-10-04.

## Die Frage
1. Der Nutzer sagt „Baue eine Webseite für Unternehmen X aus Y“ oder schickt einen Link zur alten Seite. Dabei sollen die vier Design-Skills (`design-taste-frontend`, `emil-design-eng`, `web-design-guidelines`, `taste`) genutzt werden, und jede Seite soll anders aussehen.
2. Die Seite soll während des Baus sichtbar sein. Ein Klick in der Dienste-Tafel öffnet sie in einem eigenen Fenster daneben. Dieses Fenster kann man im Meeting teilen, und es zeigt Änderungen der Worker sofort.

## Entschieden

### 0. Einrichtung, einmalig, ohne Code
- Die Design-Skills **auf dem Office-Rechner** unter `~/.claude/skills/<name>/` installieren. Es sind drei, weil `taste` dasselbe ist wie `design-taste-frontend` (*Nachtrag*).
  - Vor der Installation lag dort nur `~/.claude/skills/synced/<uuid>` (docs, pdf, pptx, …), **keiner** der Design-Skills.
  - Ohne diesen Schritt bewirkt alles Weitere nichts.
- Danach in einem Worker prüfen, ob sie sichtbar sind.
- Ein Repo `websites` als Etage anlegen: ein Ordner pro Kunde, ein Worktree pro Auftrag. Ein Repo pro Kunde wäre zu viel GitHub-Aufwand.
- Nur **Claude-Worker**: Codex- und OpenCode-Worker haben keine Skills.

### 1. Skill `webseite`, ohne Office-Code
Ablage: `~/.claude/skills/webseite/SKILL.md` auf Benutzerebene, also für jeden Worker auf jeder Etage und auch außerhalb des Office. Er wird ausgelöst durch den Satz „Baue eine Webseite für …“ oder durch eine URL. Ablauf:
1. **Prüfen**, ob die drei Design-Skills vorhanden sind. Wenn nicht: laut abbrechen mit Installationshinweis, statt still eine Allerweltsseite zu bauen.
2. **Briefing** nach `brief.md`:
   - Bei einer URL die alte Seite per WebFetch lesen.
   - **Rechte-Regel:** Texte und Fakten übernehmen. Bilder und Logo nur vom Kunden selbst, sonst Platzhalter. Das Design der Altseite nicht kopieren.
   - Ohne URL: kurze Recherche zu Firma, Branche und Ort.
3. **Zufallsziehung aus der Shell** (`shuf -n1` je Achse), nicht vom Modell:
   - Achsen: Layout-Archetyp × Schriftpaar × Palette-Typ × Bildsprache.
   - Die letzten 5 Kombinationen aus dem Verlauf sind gesperrt. Gesperrt ist auch jede Ziehung, die einer davon in 3 von 4 Achsen gleicht (*Nachtrag*).
   - Das Ergebnis wird **vor dem Bauen** in `brief.md` festgeschrieben.
   - Im selben Schritt wird eine Zeile an den **globalen Verlauf** `~/.claude/webseite-verlauf.md` angehängt (*Nachtrag*, war Schritt 7). Die Datei liegt außerhalb der Repos und des Skill-Ordners, es wird nur angehängt.
4. `design-taste-frontend` setzt die gezogene Richtung um. Die Ziehung gilt dabei als sein „Design Read“. Bei einer URL arbeitet er im Modus „Redesign – Overhaul“, nie „Preserve“ (*Nachtrag*).
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
| Die Design-Skills ins Office-Repo kopieren | – | Fremde Skills: Lizenz und Updates unklar. |
| Verlauf im Kundenprojekt bzw. im `websites`-Repo | Pragmatiker R1/R2 | Er sieht nur einen Kunden bzw. hat eine Kopie pro Worktree. Parallele Aufträge sehen sich nicht, und es gibt Merge-Konflikte. |
| Verlauf im Skill-Ordner | Vorsitz R1/R2 | Der Skill-Ordner kann synchronisiert oder verwaltet sein, und das Schreiben dort ist fragil. → `~/.claude/webseite-verlauf.md` |
| `npm run dev -- --host` | Pragmatiker, Vereinfacher | Öffnet den Dev-Server ohne Office-Login im LAN, je nach Security Group auch öffentlich. Der Relay braucht es nicht. |
| Popup-Position `left=availWidth/2` | Vorsitz R1 | Browser ignorieren das über Monitore hinweg. Einmal hinziehen, der Browser merkt es sich. |

## Offen
- **Office über eine öffentliche Domain** (TLS, kein localhost-Tunnel): `p<port>.localhost` greift dort nicht. Lösen ließe sich das mit Wildcard-DNS + Wildcard-Zertifikat (`p5173.office.example`). Erst angehen, wenn jemand so arbeitet.
- **„Vorschau folgt“:** Das Popup springt von selbst zum neuen Dienst des Workers (BroadcastChannel). Nur bauen, wenn es im Alltag fehlt. Ein Auto-Popup ohne Klick blockieren Browser ohnehin.
- **Inhalt der Stil-Achsen:** festgelegt im Skill (`~/.claude/skills/webseite/achsen/*.txt`): 12 Layout-Archetypen, 10 Schriftpaare (Google Fonts), 8 Palette-Typen, 6 Bildsprachen. Offen bleibt: nach 5–10 Seiten prüfen, ob die Seiten wirklich verschieden wirken.
- **Reihenfolge bei Konflikten zwischen den Skills** (`design-taste-frontend` gegen `web-design-guidelines`): Faustregel „Richtung vor Regeln, Regeln vor Abgabe“. Bei Barrierefreiheit gewinnen die Guidelines. Am ersten echten Auftrag nachschärfen.
- **Ob ein Worker die synchronisierten Skills (`synced/<uuid>`) auch unter ihrem Namen findet**, ist ungeklärt. Bis dahin gilt die Installation unter `~/.claude/skills/<name>/` aus Schritt 0.

## Nächste Schritte
1. **Erledigt (2026-10-04):** drei Design-Skills unter `~/.claude/skills/<name>/` installiert, jeweils mit einer `HERKUNFT.txt` (Quelle, Commit, Update-Befehl). `check-skills.sh` meldet alle drei. **Offen:** in einem neu gestarteten Worker prüfen, dass sie in der Skill-Liste stehen.
2. **Teilweise erledigt:** `~/.claude/skills/webseite/SKILL.md` ist geschrieben, dazu `check-skills.sh`, `draw.sh` und `achsen/*.txt`. Getestet sind der Abbruch bei fehlenden Skills und die Ziehung samt Sperre, auch bei parallelen Aufträgen. **Offen:** der Test an zwei Beispielfirmen.
3. **Erledigt:** Office-PR, aufgeteilt in zwei PRs:
   - #61: `p<port>.localhost`-Routing im Relay.
   - #62: Vorschau-Knopf, `previewUrl`, i18n, `docs/features.md`.
   - **Offen:** der Akzeptanztest aus Punkt 3 mit einem echten Vite-Dienst.
4. **Offen:** Das Repo `websites` als Etage anlegen (Schritt 0).

## Nachtrag beim Schreiben des Skills (2026-10-04)
Drei Abweichungen vom Meeting-Stand, alle im Ablauf oben schon eingearbeitet:
- **Verlauf bei der Ziehung statt am Ende (früher Schritt 7).**
  - Grund: Wird die Zeile erst bei der Abgabe geschrieben, sehen gleichzeitig laufende Aufträge die Ziehung des anderen nicht und können dieselbe Kombination ziehen.
  - Jetzt laufen Verlauf lesen, ziehen und anhängen in `draw.sh` unter einem Lock (`flock`).
  - Folge: Auch ein abgebrochener Auftrag sperrt seine Kombination für die nächsten 5 Ziehungen. Das ist gewollt: lieber eine Sperre zu viel als zwei gleiche Seiten.
- **Strengere Sperre: 3 von 4 Achsen.**
  - Grund: Bei 12 × 10 × 8 × 6 = 5760 Kombinationen greift eine Sperre nur auf exakt gleiche Kombinationen praktisch nie.
  - Ohne die Regel zählte „nur die Bildsprache ist anders“ schon als neue Seite.
- **`taste` ist `design-taste-frontend`, kein eigener Skill.**
  - Der Skill `design-taste-frontend` liegt im Repo [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill). „taste“ im Meeting meinte sehr wahrscheinlich dieses Repo.
  - Der einzige Skill, der wirklich `taste` heißt ([senlindesign/taste-skill](https://github.com/senlindesign/taste-skill)), passt nicht:
    - Er analysiert das Design einer fremden URL, um es nachzubauen. Das widerspricht der Rechte-Regel „Design der Altseite nicht kopieren“.
    - Er springt laut eigener Beschreibung bei jeder URL an.
    - Er hat keine Lizenz und braucht das Playwright-MCP.
  - Installiert sind:

    | Skill | Quelle | Lizenz |
    |---|---|---|
    | `design-taste-frontend` | Leonxlnx/taste-skill, `skills/taste-skill` | MIT |
    | `emil-design-eng` | emilkowalski/skills | MIT |
    | `web-design-guidelines` | vercel-labs/agent-skills | keine Lizenzdatei |
