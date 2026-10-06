# SG Dominator

Userscripty čtou stránky hry (tabulky hráčů ras a mapu galaxie) ve tvém přihlášeném prohlížeči a posílají
je na lokální server. Server vyhodnotí pravidla a pošle alert na Discord a/nebo Telegram.

## Spuštění

```
npm start
```

Vyžaduje Node.js 22.13+ (žádné npm závislosti). UI: http://127.0.0.1:3940

1. Nainstaluj rozšíření Tampermonkey.
2. Otevři http://127.0.0.1:3940/userscript.user.js (hráči ras) a http://127.0.0.1:3940/mapa.user.js (OP na mapě)
   a potvrď instalaci. Tokeny jsou už vyplněné.
3. Otevři v prohlížeči stránku hráčů rasy a/nebo mapu. Okna musí být viditelná (Chrome jinak zpomaluje časovače).
4. V UI přidej rasu tlačítkem ＋, zvol co hlídat, nastav kanály (⚙ Nastavení → Kanály) a „Poslat testovací zprávu“.

## Kde jsou data

Mimo složku projektu (ta bývá v Dropboxu, a konfigurace obsahuje tajné tokeny):

- Windows: `%LOCALAPPDATA%\sg-dominator\` (konfigurace `config.json`, databáze `history.db`, log)
- jinde: `~/.local/share/sg-dominator/`
- přepsat jde proměnnou prostředí `SG_DATA_DIR` (a `SG_PORT` pro port) – hodí se pro oddělenou testovací instanci

Konfigurace se zapisuje atomicky a předchozí verze zůstává jako `config.json.bak`. Starší data ze složky
`data/` v projektu se při prvním spuštění sama přesunou.

## Co umí

- **Hlídání síly** po rasách (celá rasa / vybraní hráči), prahy na rasu i hráče, pauza a opakování zpráv.
- **Kritická hranice**: druhý práh (% z prahu hráče). Vstup do kritického pásma se hlásí ihned (🆘), pak se opakuje.
- **OP na mapě**: tečky opuštěných planet se hledají v obrázku mapy (barva `#FFB200`), sektor se určí z polohy.
- **Automatický dohoz**: když hráč naší rasy spadne pod práh, bot za náhodnou dobu (nastavitelné rozmezí v Nastavení → Dohoz) sám klikne na Dohodit; vypínač DOHOZ je v hlavičce. Potřebuje otevřenou stránku Rasová armáda.
- **Hlídač výpadku**: pošle zprávu, když hlídaná rasa nebo mapa přestane dodávat data, a když se vrátí.

## Přenos na jiný počítač (flashka, plug and play)

Podrobný návod je v `JAK-NA-TO.txt`. Balíček pro flashku obsahuje `sg-settings.json` (nastavení včetně tokenu bota
v čitelné podobě, proto ho nedávej do Dropboxu ani na sdílená místa) a složku `runtime/` s Node.js.
V práci stačí `instal.cmd` (načte nastavení, otevře Tampermonkey v Chrome) a `start.cmd`; `stop.cmd` aplikaci zastaví.
Nové nastavení se do souboru uloží příkazem `node src/cli.js export`.

## Testy

```
npm test
```

Detekce tečky se testuje na skutečném obrázku mapy (`test/fixtures/`).
