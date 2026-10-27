/* Agent equipment management panel (extracted from build.js renderAbilityOverview).
   Displays per-agent tool access, skills, equipment, and connectors via /api/agent/:id/capabilities.
   Lifecycle: created once per REFIT session, destroyed when tool/mode changes. */

const Refit = (() => {
  let helpers = {};
  let state = { agentId: '', accessKey: '', accessView: null, accessTicket: 0 };
  let root = null;
  let getGeoVer = null;

  function paint(view, pending = false) {
    if (!root) return;
    root.querySelectorAll('[data-access-cap]').forEach(b => {
      const a = helpers.EquipmentHelp.access(b.dataset.accessCap, view);
      b.dataset.state = pending ? 'pending' : a.state;
      b.querySelector('span').textContent = pending ? 'CHECKING' : a.label;
      b.setAttribute('aria-label', helpers.abilityName(b.dataset.accessCap) + ' · ' + (pending ? 'Checking access' : a.label));
    });
    root.querySelectorAll('[data-core-ability]').forEach(b => {
      const a = helpers.EquipmentHelp.access(b.dataset.coreAbility, view);
      b.dataset.state = pending ? 'pending' : a.state;
      b.querySelector('.refit-core-status').textContent = pending ? 'CHECKING ACCESS' : a.label;
    });
  }

  function fetchAndPaint(agentId, facts) {
    const geoVer = getGeoVer ? getGeoVer() : 0;
    const key = [agentId, geoVer, facts.placed.join(',')].join('|');
    if (key === state.accessKey) {
      paint(state.accessView, state.accessView === undefined);
      return;
    }
    state.accessKey = key;
    state.accessView = undefined;
    const ticket = ++state.accessTicket;
    paint(null, true);

    helpers.Harness.api
      .get('/api/agent/' + encodeURIComponent(agentId) + '/capabilities')
      .catch(() => null)
      .then(view => {
        if (ticket !== state.accessTicket || !root || !root.isConnected) return;
        state.accessView = view;
        paint(view);
      });
  }

  return {
    init(deps) {
      helpers = deps;
    },

    setGeoVerGetter(fn) {
      getGeoVer = fn;
    },

    render(agentId, allAgents) {
      const wrap = document.createElement('section');
      wrap.className = 'refit-ability-overview';
      wrap.setAttribute('aria-label', 'Core tool access');

      const selected = allAgents.find(a => a.id === agentId) || allAgents[0] || {};
      wrap.innerHTML =
        '<div class="refit-access-head"><label>TOOL ACCESS FOR <select class="refit-input" aria-label="Inspect equipment for agent">' +
        allAgents
          .map(
            a =>
              '<option value="' +
              helpers.esc(a.id) +
              '"' +
              (a.id === agentId ? ' selected' : '') +
              '>' +
              helpers.esc(a.name || a.id) +
              '</option>'
          )
          .join('') +
        '</select></label><button class="bb xs" type="button" aria-label="Refresh tool access" data-refresh-access>↻</button></div><div class="refit-core-access"></div>';

      const chips = wrap.querySelector('.refit-core-access');
      helpers.starterProps().forEach(c => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'bb refit-access-chip';
        b.dataset.accessCap = helpers.capOf(c);
        b.innerHTML = '<b>' + helpers.esc(helpers.grantLabelOf(c)) + '</b><span>CHECKING</span>';
        b.onclick = () => helpers.chooseAbility(helpers.capOf(c));
        chips.appendChild(b);
      });

      wrap.querySelector('select').onchange = ev => {
        state.agentId = ev.target.value;
        this.refresh();
      };
      wrap.querySelector('[data-refresh-access]').onclick = () => this.refresh();

      root = wrap;
      state.agentId = agentId;
      this.refresh();
      return wrap;
    },

    refresh() {
      if (!root || !state.agentId) return;
      state.accessKey = '';
      const facts = { placed: [] };
      try {
        const spec = helpers.catalog().find(c => c.id === helpers.propType);
        if (spec) {
          const inspected = helpers.EquipmentHelp.inspect(helpers.station, state.agentId, spec.id);
          facts.placed = inspected.placed || [];
        }
      } catch (_) {}
      fetchAndPaint(state.agentId, facts);
    },

    cleanup() {
      root = null;
      state = { agentId: '', accessKey: '', accessView: null, accessTicket: 0 };
    },
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = { Refit };
