# Pravidla pro práci na projektu

## Git workflow (povinné)
1. **Před každou prací** spusť `git pull`, ať pracuješ s nejnovější verzí z GitHubu.
2. **Každou úpravu commitni** se srozumitelným popisem v češtině (co a proč se změnilo).
3. **Po každém commitu pushni** na GitHub (`git push`).

## Projekt
- Stargate dominator: lokální Node.js server (`src/server.js`, port 3940, jen 127.0.0.1) + userscripty pro Tampermonkey (`userscript/`), které běží na stargate-game.cz.
- Bez npm závislostí, potřebuje Node.js >= 22.13 (`node:sqlite`).
- Rozhraní: `public/index.html` (kostra) + `public/css/app.css` + `public/js/NNN-*.js` (klasické skripty načtené po řadě, sdílí globální proměnné; pořadí souborů je důležité).
- Testy: `npm test` (jednotkové, rychlé) a `npm run test:ui` (rozhraní v headless Chrome, ~30 s; Chrome se hledá sám nebo přes `CHROME_PATH`; bez Chrome se přeskočí). Po změně rozhraní spusť obojí.
- Spuštění: `start.cmd` (nebo `npm start`), zastavení: `stop.cmd`. Testy: `npm test`.
- Data a nastavení (tokeny) jsou mimo repo v `%LOCALAPPDATA%\sg-dominator`. `sg-settings.json` obsahuje tajný token, nikdy ho necommituj.
- Po změně userscriptu zvyš `@version` v hlavičce, ať ho Tampermonkey aktualizuje.
- Testování v prohlížeči: přes rozšíření Claude in Chrome (uživatelův Chrome s Tampermonkey a přihlášením do hry).
- Když je potřeba uživatel (přihlášení, potvrzení), zastav se a řekni mu.
- Profily nastavení: Nastavení → Data → Profil. Celé nastavení (bez tokenů, webhooku, hesla a portu) se ukládá do souboru <jméno>.json ve složce sdílených dat; po odeslání ho druhý počítač sám načte. Tajné věci do profilu nepatří a nikdy se nesmí dostat do repozitáře.
- Sdílená data (profily + přepočty hráčů) jsou ODDĚLENÁ od kódu: žijí v samostatném git repozitáři ve složce %LOCALAPPDATA%sg-dominatorsdilena-data na větvi sdilena-data (stejný remote origin). Každý počítač píše jen svůj soubor data-<počítač>.json a čte ostatní (sjednocení, žádné konflikty). Do hlavní větve se z toho nic necommituje.
- stop.cmd před zastavením (když je zapnuto v Nastavení → Data) odešle sdílená data a profil na větev sdilena-data (commit jen těchto souborů, pull --rebase, push; nikdy force). Totéž dělá tlačítko Poslat data a profil ostatním a červené tlačítko Zavřít aplikaci.
- start.cmd před spuštěním (když aplikace neběží a je zapnuto v Nastavení → Data) udělá git pull --rebase --autostash, aby měla nejnovější kód, profily a sdílená data. Aplikaci jde zavřít i tlačítkem Zavřít aplikaci (Nastavení → Data), dělá totéž co stop.cmd.
