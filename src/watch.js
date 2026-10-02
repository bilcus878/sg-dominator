/**
 * Určí, jestli se hráč hlídá a jaký má práh.
 *
 * Režim rasy je nadřazený a jednoznačný:
 *   off       – nehlídá se nikdo (ruční výjimky hráčů se ignorují)
 *   selected  – hlídají se jen hráči s výjimkou watch:true
 *   all       – hlídají se všichni, kromě hráčů s výjimkou watch:false
 * Změna režimu rasy výjimky u jejích hráčů maže (viz sanitizeUpdate), aby přepínač dělal to, co říká.
 *
 * Práh: výjimka u hráče > nastavení rasy > globální práh.
 * Kritická hranice je X % z (již určeného) prahu hráče; X je z rasy, jinak globální (0 = vypnuto).
 */
export function resolveWatch(cfg, raceId, name) {
  const race = cfg.races[raceId];
  const p = cfg.players[name];
  const mode = race?.mode ?? 'off';
  const explicit = p?.watch;
  const watched = mode === 'off' ? false : mode === 'all' ? explicit !== false : explicit === true;
  const threshold = p?.threshold ?? race?.threshold ?? cfg.threshold;
  const criticalPct = race?.criticalPct ?? cfg.criticalPct ?? 0;
  return {
    watched,
    threshold,
    critical: criticalPct > 0 ? Math.round((threshold * criticalPct) / 100) : 0,
    overridden: explicit !== undefined,
    ownThreshold: p?.threshold ?? null,
  };
}
