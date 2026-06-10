/* KHUTHADZO SUPPLIES — Global Persistent State Layer */
(function (global) {
  "use strict";
  const STORAGE_KEY = "kh_supplies_state_v1";
  const KB_KEY = "kh_supplies_knowledge_v1";

  const defaultState = {
    session: { id: null, createdAt: null, currentZone: 1 },
    zoneStatus: { 1: "active", 2: "locked", 3: "locked", 4: "locked", 5: "locked", 6: "active" },
    document: { raw: null, format: "unknown", structure: null, intelligence: null, confirmed: false },
    items: [],          // {id, item_no, description, unit, quantity, trade, pricingType, classification, build, confidence, stale, override, status}
    excludedRows: [],
    parameters: {
      location: "", bargainingCouncil: "", exposure: "standard",
      contingencyPct: 0, workingFlags: [], confirmed: false
    },
    preliminaries: [],  // {id, description, fixed, valueRelated, timeRelated}
    audit: [],
    output: { status: "pending", generated: null }
  };

  let state = load() || structuredClone(defaultState);

  function load() {
    try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : null; }
    catch (e) { return null; }
  }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }

  const KH_STATE = {
    get() { return state; },
    set(patch) { Object.assign(state, patch); persist(); },
    reset() { state = structuredClone(defaultState); state.session.id = "KH-" + Date.now(); state.session.createdAt = new Date().toISOString(); persist(); },

    /* Zone gating */
    completeZone(zone) {
      state.zoneStatus[zone] = "completed";
      const next = zone + 1;
      if (next <= 5 && state.zoneStatus[next] === "locked") state.zoneStatus[next] = "active";
      persist();
    },
    enterZone(zone) { state.session.currentZone = zone; if (state.zoneStatus[zone] === "active" || state.zoneStatus[zone] === "completed") state.zoneStatus[zone] = state.zoneStatus[zone]; persist(); },
    canEnter(zone) { return state.zoneStatus[zone] !== "locked"; },

    /* Items */
    setItems(items) { state.items = items; persist(); },
    upsertItem(item) {
      const i = state.items.findIndex(x => x.id === item.id);
      if (i >= 0) state.items[i] = item; else state.items.push(item);
      persist();
    },

    /* Stale propagation: when a zone-2 reclassification or zone-4 override
       changes upstream data, mark dependent items stale through 3 & 4. */
    markStaleFrom(itemId) {
      const it = state.items.find(x => x.id === itemId);
      if (it) { it.stale = true; it.status = "stale"; }
      // any downstream child items inherit stale
      state.items.filter(x => x.parentId === itemId).forEach(x => { x.stale = true; x.status = "stale"; });
      if (state.output.status === "approved") state.output.status = "pending";
      persist();
    },
    markAllStale() { state.items.forEach(i => { i.stale = true; i.status = "stale"; }); if (state.output.status === "approved") state.output.status = "pending"; persist(); },

    /* Audit */
    addAudit(entry) {
      state.audit.push(Object.assign({ ts: new Date().toISOString() }, entry));
      persist();
    },

    /* Knowledge base (Zone 6) — survives across sessions */
    knowledge: {
      read() { try { return JSON.parse(localStorage.getItem(KB_KEY)) || baseKB(); } catch (e) { return baseKB(); } },
      write(kb) { localStorage.setItem(KB_KEY, JSON.stringify(kb)); },
      logPrice(itemKey, region, price) {
        const kb = this.read();
        kb.priceHistory[itemKey] = kb.priceHistory[itemKey] || [];
        kb.priceHistory[itemKey].push({ region, price, ts: new Date().toISOString() });
        kb.freshness.regionalMaterial = new Date().toISOString();
        this.write(kb);
      },
      logOverride(itemType, sysRate, ovrRate) {
        const kb = this.read();
        kb.overrides[itemType] = kb.overrides[itemType] || [];
        kb.overrides[itemType].push({ direction: ovrRate > sysRate ? "up" : "down", delta: ovrRate - sysRate, ts: new Date().toISOString() });
        this.write(kb);
      }
    }
  };

  function baseKB() {
    return {
      priceHistory: {}, overrides: {},
      benchmarks: { westernCape: {}, gauteng: {} },
      freshness: { regionalMaterial: null, wageSchedules: null, commodityIndex: null }
    };
  }

  if (!state.session.id) KH_STATE.reset();
  global.KH_STATE = KH_STATE;
})(window);