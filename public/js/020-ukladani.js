/* ---------- ukládání: lokálně hned, na server po jedné ve frontě ---------- */
let pending = 0;
let saveChain = Promise.resolve();
function savePartial(patch, quiet = false) {
  pending++;
  saveChain = saveChain
    .then(() => api('/api/config', 'PUT', patch))
    .then(() => { if (!quiet) toast('Uloženo'); })
    .catch((e) => toast('Uložení selhalo: ' + e.message, true))
    .finally(() => { if (--pending === 0) { api('/api/config').then((c) => { cfg = c; renderChips(); }).catch(() => {}); refresh(); } });
}

