# Automat na OP (osídlení opuštěných planet)

Zapíná se přepínačem **🎯 Chytat** v hlavičce (nebo v Nastavení → Mapa a OP). Vedle něj je **📣 Alerty** (zprávy o OP do hlavní skupiny); dá se zapnout jen jeden, nebo oba. Bot na mapě (hlídání, teleskop, bdělost) pracuje, když je zapnutý aspoň jeden z nich. Teleskop musí být aktivní (zapíná ho bot sám). Výchozí je **zkušební režim**.

## Jak pozná pravý OP
Velká mapa (obrázek 711×900) ukazuje OP jako oranžovou tečku v polygonu sektoru. Sektorová mapa (obrázek 602×367) je přesně
obdélník, do kterého se polygon sektoru vejde (obrys sektoru se dotýká všech čtyř okrajů obrázku), zvětšený na celý obrázek.
Tečka má proto v obou mapách stejnou polohu jako zlomek šířky a výšky obdélníku (u, v ∈ 0–1). Skript na velké mapě spočítá (u, v)
a pošle je serveru spolu se sektorem. Ověřeno na sektoru 27: OP z velké mapy vychází na (221; 75) a skutečná tečka leží na (230; 84).
Falešné tečky leží jinde, takže se vyřadí vzdáleností (tolerance 30 px, nastavitelná). Velká značka (kosočtverec ~9×9 px) má před obyčejnou
planetou přednost.

## Trasa
1. Velká mapa: server nabídne zakázku (sektor + u, v) po reakční prodlevě; skript klikne na sektor (křivka myši, souřadnice kliku).
2. Sektorová mapa (`mapa.php?id_sektor=…`): vybere nejbližší kandidáty, klikne na nejlepšího (planety jsou `<area>` s `location.href`).
3. Stránka tečky: hledá tlačítko „Získat souřadnice“.
   * není → zpět do sektoru k další tečce (nejvýš „kolik teček vyzkoušet“), pak zpět na velkou mapu a sektor se na chvíli odloží;
   * je → pauza, klik. Hra osídlí a vrátí na velkou mapu (úspěch). Červená nová hláška = chyba; zmínka o naquadahu = **automat se vypne**.
4. Zkušební režim: celá cesta až k tlačítku, pak jen zpráva do servisního chatu, bez kliknutí.

## Pojistky
Jedna zakázka najednou (druhá karta ji nepřevezme), vypršení zakázky za 4 min, odložení sektoru po neúspěchu, limit zakázek za hodinu,
během lovení se teleskop nezastavuje (šetření po OP) a tečky se nepovažují za zmizelé. Všechny zprávy jdou jen do servisního chatu.

## Co je potřeba ověřit při prvním ostrém použití
Přesná podoba tlačítka a chybové hlášky se čte podle textu „Získat souřadnice“ a červené barvy nového textu; u prvního ostrého pokusu
je v servisní zprávě i úryvek stránky. Jak hra potvrdí osídlení (přechod na velkou mapu, nebo hláška), se pozná při prvním použití.
