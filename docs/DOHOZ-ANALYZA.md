# Auto-dohoz: analýza, pojistky a provozní pravidla

Dohoz posílá jednotky z rasové armády hráči naší rasy, který spadl pod práh. Chyba tady stojí jednotky,
proto je celý řetěz projitý od spouštěče po klik v prohlížeči a každá slabina má pojistku nebo je popsaná níže.

## 1. Jak to běží (celý řetěz)

```
data ze hry (userscript „Síla hráčů“) ─► server: pravidla (rules.js)
   │  potvrzený pád pod práh (2 čtení po sobě), jen vlastní rasa, jen hlídaný hráč
   ▼
autoArmy.onAlert  ──►  plán: prodleva 1 (min–max s) + odstup mezi hráči
   │  (stav v paměti serveru: fronta, „epizody“ k horní hranici, ověřování)
   ▼
autoArmy.tick (každých 300 ms) ──► kontroly těsně před kliknutím:
   │  zapnuto? čerstvá data? pořád pod prahem? pojistka za hodinu? stránka armády dostupná?
   ▼
army.request(jméno) ──► skript na stránce „Rasová armáda“ si ho vyzvedne (dotaz co 250 ms)
   │  vyplní jméno + jednotky, nahlásí výsledek, klikne na Odeslat, vrátí se zpět a znovu vyplní
   ▼
ověření výsledku: chyba skriptu? vyzvednuto? síla vzrostla? ──► další kolo / hotovo / zpráva
```

Zrušené volby: „dohazovat znovu při každé připomínce“ a „nejvíc dohozů na hráče“ (zbytečně komplikovaly rozhodování; staré hodnoty z nastavení se ignorují).

Důležité vlastnosti, které se při návrhu hlídaly:

* **Spouštěč je jen skutečný pád.** Při startu serveru je hráč, který už je pod prahem, jen „výchozí stav“ (bez alertu).
  Změna nastavení nespouští dohoz. Dohoz spouští jen potvrzené čtení dvakrát po sobě (filtr jednorázových výkyvů).
* **Jednotky se platí za skutečné odeslání**, proto se každý dohoz po odeslání ověřuje a nezabrání-li, hlásí se.

## 2. Pojistky (co brání tomu, aby se to „posralo“)

| Riziko | Pojistka |
|---|---|
| Rozjeté dohazování po vypnutí | Vypnutí (jakýkoli vypínač) okamžitě zruší naplánované i rozjeté dohozy |
| Rozhodování podle starých dat | Data hráče starší než 10 s se nepoužijí; síla 0 je platná (dobyvací útok hráče srazí až na 0 a právě tehdy se dohazuje), jako chybná se bere jen nečitelná hodnota; bez čerstvých dat se nic neposílá (po 30 s se hráč vzdá se zprávou) |
| Dohoz, který se nepovedl, a nikdo to neví | Každý dohoz se ověřuje (i bez horní hranice): chyba skriptu, nevyzvednutý požadavek, nebo síla nevzrostla = zpráva |
| Falešný „úspěch“ z drobného kolísání síly | Na účinek se čeká až po odeslání skriptem; „vzrostla“ = o víc než 0,1 % cíle |
| Smyčka jednotek bez konce | Počet dohozů na hráče se v nastavení **neomezuje** (dohazuje se až po horní hranici), proto: síla nevzrostla do 15 s = konec; **hodinová pojistka** (výchozí 200): po překročení se auto-dohoz sám vypne (i v nastavení) a pošle zprávu; interní tvrdý strop 500 kol na hráče |
| Jeden hráč spotřebuje vše, druhý zůstává pod prahem | Nejdřív každý hráč nad práh (záchrana), pak střídavě k horní hranici; hráč, který se zase propadne pod práh, má opět přednost |
| Hráč znovu padne krátce po dohození | Pád se neztratí: dohoz se odloží na konec pauzy a před kliknutím se ověří, že je hráč pořád pod prahem |
| Dva hráči naráz ve stejné vteřině | Rozestup mezi hráči (nastavitelné rozmezí); najednou se zadává nejvýš jeden požadavek |
| Stránka armády se právě načítá (po odeslání se vrací zpět) | Až 30 s se zkouší znovu, teprve potom selhání a zpráva |
| „Roboti“ | Všechny prodlevy jsou náhodná rozmezí (první dohoz, odstup mezi hráči, pauza mezi koly, pauza před novým spuštěním) |

## 3. Co analýza našla a opravilo se

1. **Vypnutí nezastavilo rozjeté dohazování** (naplánované i další kola k horní hranici). Opraveno.
2. **Dohazování podle starých dat** (server drží data stránky až 10 minut a čerstvost se měřila jen za celou rasu). Opraveno: čerstvost za hráče, 10 s.
3. **Chyba skriptu nebo nevyzvednutý požadavek skončily jen v konzoli.** Opraveno: výsledek požadavku se sleduje a hlásí.
4. **Jeden dohoz bez horní hranice se vůbec neověřoval.** Opraveno.
5. **Pauza po dohození zahazovala nový pád** (hráč napadený krátce po dohození zůstal pod prahem bez dohozu). Opraveno: odložení, ne zahození.
6. **Hráč, který se při dohazování k hranici znovu propadl pod práh,** neměl přednost. Opraveno.
7. **Falešný úspěch** (náhodný růst síly před odesláním). Opraveno.
8. **Předčasné selhání, když se stránka armády po odeslání vracela zpět** (okno 5 s). Opraveno (30 s).
9. **Žádná celková pojistka.** Přidána hodinová pojistka, která auto-dohoz i vypne v nastavení.
10. **Zprávy `undefined` a zprávy do hlavní skupiny.** Opraveno: texty se skládají v modulu, jdou do servisního chatu (a bez něj do hlavního).
11. **Hráč na víc stránkách rasy:** vyhrávala první stránka podle čísla, ne nejčerstvější data. Opraveno.

Ověřeno čtením skutečné stránky hry (bez klikání): `#hrac_jmeno`, POST formulář, `#odeslat` (tlačítko typu obrázek),
políčka `jed1…`, sloupec „V armádě“ sedí s tím, co skript očekává.

## 4. Rizika, která kód nevyřeší (provozní pravidla)

1. **Dva počítače najednou.** Když běží aplikace s auto-dohozem na obou počítačích, každý dohodí zvlášť = dvojí dohoz.
   *Auto-dohoz zapni jen na jednom místě a na druhém ho vypni.*
2. **Skrytá karta v Chromu.** Chrome u skrytých karet zpomaluje časovače (po 5 minutách ve skrytí na jedno spuštění za minutu).
   Stránka Rasová armáda a okna s daty musí být **viditelná** (vlastní okno, neminimalizované). Jinak bot hlásí, že stránka není otevřená.
3. **Restart serveru** zruší rozjeté dohazování (je jen v paměti). Hráč pod prahem je po startu jen „výchozí stav“, takže nic nespustí. Dohoď ručně.
4. **Zapnutí auto-dohozu nedohodí hráče, kteří už pod prahem jsou** (jen nové pády). Použij ruční Dohodit.
5. **Potvrzení z hry neexistuje.** Úspěch se pozná nepřímo z nárůstu síly (spolehlivé, ale ne bezchybné).
6. **Změna nastavení uprostřed dohazování** se projeví až u dalšího dohazování (kromě vypnutí, které platí hned).
7. **Hra může poznat automatizovaný klik** (nelze vyloučit). Proto jsou náhodné prodlevy a klik se souřadnicemi jako od myši.

## 5. Nastavení (Nastavení → Dohoz)

1. po pádu pod práh počkat · 2. odstup mezi hráči · 3. pauza mezi dohozy téhož hráče · 4. znovu začít dohazovat téhož hráče
(vše jako náhodné rozmezí od–do v sekundách).
**Kolikrát dohazovat** (vzájemně se vylučují): *Jednou za pád pod práh* nebo *Až do horní hranice* (bez omezení počtu dohozů).
Horní hranice je výchozí pro všechny hráče a u každého hráče jde nastavit zvlášť: v tabulce hráčů tlačítko ⚙ vedle jména otevře okno
s dolním prahem (alert) i horní hranicí (dohoz), každé pole je popsané a má tlačítko „výchozí“.
Pojistka: nejvíc dohozů za hodinu (výchozí 200).
Vypínač je na třech místech (hlavička DOHOZ, záhlaví panelu AUTO, nastavení) a všechny jsou propojené. Při selhání
dohozu svítí vypínač v hlavičce červeně.

## 6. Pokrytí testy

* `test/autodohoz.test.js` (~60 testů): spouštěče, náhodnost všech pauz, odstup mezi hráči, cooldown s odložením, horní hranice,
  záchrana před dohazováním, návrat do záchrany, vypnutí uprostřed, čerstvost dat, chyba skriptu, expired požadavek, šum síly,
  ověření jednoho dohozu, stránka armády se načítá, hodinová pojistka, migrace starého nastavení, meze nastavení.
* `test/store.test.js`: čerstvost za hráče a nejčerstvější výskyt.
* Scénáře na běžícím serveru (simulace skriptu v prohlížeči): chyba skriptu, vypnutí uprostřed, stará data, pojistka,
  dva hráči (záchrana a střídání k horní hranici).
* UI testy: hlavička, vypínače, pořadí prvků.
