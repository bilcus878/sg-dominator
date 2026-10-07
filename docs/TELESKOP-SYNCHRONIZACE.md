# Teleskop, bdělost, šetření a lovení OP: jak do sebe zapadají

## Funkce a co dělají
| Funkce | Co dělá | Kdy |
|---|---|---|
| Potvrzení bdělosti | klikne na „Povrdit“ po náhodné prodlevě | když se tlačítko objeví (co pár minut) |
| Záměrné vynechání | tlačítko nepotvrdí, hra teleskop zastaví, bot ho nechá vypnutý (pauza) | jednou za N potvrzení |
| Šetření po OP | po objevení OP teleskop zastaví a před koncem 5minutového okna zapne zpět | po OP, s pravděpodobností |
| Automatická aktivace | zastavený teleskop po prodlevě zapne | když stojí a není důvod ho nechat vypnutý |
| Lovení OP | otevře sektor, tečku a osídlí planetu | když svítí OP a je zapnuté 🎯 |

## Konflikty, které analýza našla (a jak jsou vyřešené)
Pořadí důležitosti: **1. lovení OP / čekající bdělost / svítící OP, které se loví** > **2. pauza po vynechání** > **3. šetření** > **4. aktivace**.

1. *Šetření zastavilo teleskop uprostřed lovení OP* (bez teleskopu tečka zmizí). Zastavení se nyní odloží, dokud lovení běží nebo čeká bdělost; když by zapnutí zpět už nestihlo okno OP + 5 min, šetření se zahodí.
2. *Zastavení teleskopu při čekajícím tlačítku bdělosti* (nepotvrzené tlačítko + vypnutý teleskop se pletou). Zastavení se odloží.
3. *Vynechání bdělosti se kladlo na šetření i na pauzu* (dvě slepá okna za sebou) a *vynechávalo se při svítícím OP, který se loví*. Vynechání se teď nikdy nekryje se šetřením ani s pauzou ani s lovením; čítač vynechání se tím neztrácí (příští tlačítko, které už nic neblokuje, se vynechá).
4. *Dva kliky najednou* (potvrzení bdělosti a zastavení teleskopu ve stejnou vteřinu měly společnou „myš“ a pohyby se prolnuly). Všechny kliky jdou jednou frontou s lidskou pauzou mezi akcemi.
5. *Mrtvý parametr:* server předával teleskopu `opLit`, který se nepoužíval. Nahradil ho jediný signál `hold` (lovení / čekající bdělost / svítící OP při zapnutém chytání).
6. Aktivace po šetření: reakční prodleva se dál zkracuje, aby teleskop jel dřív než za OP + 5 min (zůstává beze změny).

## Jde poznat, že to neklikne člověk?
Poctivě: **zásadně ano, kdyby to hra chtěla zjišťovat.** Skript nemůže vyrobit „skutečné“ kliky myší; posílá vlastní události stránce.
* `event.isTrusted` je u všech našich kliků `false`. Stránka to může přečíst jedním řádkem. Zatím z chování hry víme jen to, že kontroluje souřadnice kliku (proto se klikalo se souřadnicemi), ne `isTrusted`.
* Co se pro věrohodnost dělá: křivka myši se zrychlením a zpomalením, drobný šum, náhodný bod v tlačítku, stisk a puštění s prodlevou, **pointer události spolu s myšími** (od v1.4.2), společná „myš“ (kliky se neprolínají), náhodné prodlevy (potvrzení bdělosti je zešikmené k rychlým reakcím a občas se zdrží), občasné záměrné vynechání, šetření teleskopu.
* Co zůstává slabé: souvislý provoz 24 hodin bez noční pauzy, shodné prodlevy v čase (člověk je ráno a večer jiný), vynechání jen jednou za desítky potvrzení (člověk jich zmešká víc), skutečné pohyby myši mezi kliky (žádné nejsou), hodnoty `screenX/Y` s konstantním posunem.
* Největší reálné riziko není JavaScript, ale **provozní logy hry**: hodiny aktivity bez přestávky, přesný rytmus dotazů, jednotné časy reakcí. S tím se nic udělat nedá, jen omezit (kratší běh, noční přestávka, větší rozptyl). Jestli automatizace odporuje pravidlům hry, je na uživateli.
