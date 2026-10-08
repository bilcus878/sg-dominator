# Nákup hvězdných bran (Obchod → Hvězdné brány)

Karta „🌌 Hvězdné brány“ je v pohledu **Obchod**. Skript **Hvězdné brány** (`/brany.user.js`) běží na stránce `obchod.php?page=4`, která musí být otevřená a viditelná.

## Jak stránka funguje (zjištěno čtením živé stránky)
* Neutrální nabídka se mění každé 3 minuty: „Jedna hvězdná brána je momentálně nabízena za **X kg**“, „Za tuto cenu je nabízeno **N** hvězdných bran“, „Další změna bude za **S sekund**“. Odpočet je jen text při načtení stránky.
* Nákup je formulář POST: výběr planety (`id_pl`, jen planety bez brány), skryté `cena` (aktuální cena), `token`, `hb_koupit` a obrázkové tlačítko Koupit. Na planetě může být jen jedna brána, takže se kupuje vždy na první nabízenou.
* Po kliknutí se stránka přenačte (POST) s novým počtem a naquadahem. Proto se stránka **nikdy neobnovuje `location.reload()`** (to by nákup odeslalo znovu), ale přechodem na adresu stránky (GET).

## Rytmus
1. Po načtení skript pošle serveru cenu, počet, odpočet a naquadah a dostane pokyn.
2. Drahá nabídka: čeká se na změnu. Stránka se obnoví **odpočet + 1–5 s** po změně (nastavitelné). S určitou šancí se jednou uprostřed cyklu obnoví navíc (jako člověk).
3. Cena pod limitem: po krátké pauze (0,4–1,3 s) klik na Koupit, pak další kliky s pauzou 0,7–2,2 s, dokud je co kupovat, stačí naquadah (mínus rezerva) a není dosažen limit kusů z nabídky.
4. Po každém kliknutí se ověří, že naquadah ubyl o cenu brány. Dvakrát po sobě bez úbytku = v téhle nabídce se přestane a pošle se zpráva.
5. Při změně nabídky (jiná cena / odpočet naskočil) se dávka uzavře souhrnem do servisního chatu: kolik se koupilo, za kolik, kolik zbývá naquadahu.

## Pojistky
Zkušební režim (výchozí) nikdy neklikne, jen pošle zprávu, co by koupil. Limit ceny a rezerva naquadahu. Těsně před kliknutím skript znovu přečte stránku (stejná cena, pořád pod limitem). Jedna karta nakupuje, druhá čeká. Zprávy jen do servisního chatu.
