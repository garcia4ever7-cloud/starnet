'use strict';
const { makeStationStore } = require('../station-store.js');
// The same room scope World.heroCaps uses. A missing client snapshot may use the
// durable floor; an explicitly empty snapshot must never resurrect removed gear.
function savedPlacement(save, agentId) {
  /* The save ENVELOPE is { version, agentId, updatedAt, doc:{ ..., station } } — the station
     hangs off `.doc`, not off the envelope. This used to read `save.station`, which is never
     present, so the guard returned [] on EVERY call: every headless run (cron, studio
     pipeline, POST /api/run) was handed ZERO capability objects and therefore zero tools.
     Models then invented tool syntax as prose (`<invoke name="web_search">`), the run ended
     "done" having executed nothing, and it looked like a model-quality problem on every
     provider — free and paid alike. Accept both shapes; the envelope is the real one. */
  const station0 = save && (save.station || (save.doc && save.doc.station));
  if (!station0) return [];
  const checked = makeStationStore().validateStationDoc(station0);
  if (!checked.ok) return [];
  const station = checked.station;
  const types = station.agentRoomId(agentId)
    ? station.bayObjects(agentId)
    : station.props().map(p => station.capForProp(p.t));
  return [...new Set(types.map(o => typeof o === 'string' ? o : o && o.objectType)
    .filter(t => t && t !== 'computer' && t !== 'connector'))]
    .map(objectType => ({ objectType }));
}
module.exports = { savedPlacement };
