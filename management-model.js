/* Read-only planning models for the facility ledger and officer comparison. */
(function (global) {
  'use strict';
  const FACILITY_KEY = 'sengoku-facility-preferences-v1';
  const SORTS = ['default', 'level-asc', 'level-desc', 'cost', 'name'];
  const STATES = ['all', 'available', 'affordable', 'unbuilt', 'working', 'vacant', 'complete'];
  const RESOURCES = ['gold', 'rice', 'wood', 'stone'];
  const STATS = ['lead', 'valor', 'intellect', 'politics'];
  function normalizePreferences(value, categories = []) {
    const input = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
      query: typeof input.query === 'string' ? input.query.slice(0, 80) : '',
      category: categories.includes(input.category) ? input.category : 'all',
      state: STATES.includes(input.state) ? input.state : 'all',
      sort: SORTS.includes(input.sort) ? input.sort : 'default',
      layout: input.layout === 'list' ? 'list' : 'cards'
    };
  }
  function readPreferences(storage, categories) {
    try { return normalizePreferences(JSON.parse(storage?.getItem(FACILITY_KEY) || 'null'), categories); }
    catch (_) { return normalizePreferences(null, categories); }
  }
  function savePreferences(storage, value, categories) {
    const preferences = normalizePreferences(value, categories);
    try { storage?.setItem(FACILITY_KEY, JSON.stringify(preferences)); } catch (_) { /* Display preferences never block play. */ }
    return preferences;
  }
  function facilityRows(game, buildings) {
    const state = game?.state || {}, jobs = game?.constructionJobs?.() || state.jobs || [];
    const byBuilding = new Map();
    for (const job of jobs) {
      if (job.kind !== 'building' || Boolean(job.shared) !== Boolean(game.isStaff)) continue;
      const current = byBuilding.get(job.id);
      if (!current || job.targetLevel < current.targetLevel) byBuilding.set(job.id, job);
    }
    return buildings.map((building, index) => {
      const level = Number(state.buildings?.[building.id]) || 0;
      const maximum = Number(game.buildingMax?.(building.id)) || 32;
      const unlock = game.buildingUnlock?.(building.id) || { ok: true };
      const job = byBuilding.get(building.id) || null;
      const cost = level >= maximum ? {} : game.costs(building.id);
      const shortages = RESOURCES.filter(key => Number(cost?.[key]) > Number(state.resources?.[key] || 0));
      const governor = state.governors?.[building.id] || '';
      const status = level >= maximum ? 'complete' : job ? 'working' : !unlock.ok ? 'locked' : shortages.length ? 'shortage' : 'funded';
      return { building, index, level, maximum, unlock, job, cost, shortages, governor, status };
    });
  }
  function filterFacilities(rows, preferences, matches = () => true, categoryNames = {}) {
    const p = normalizePreferences(preferences, [...new Set(rows.map(row => row.building.category))]);
    const filtered = rows.filter(row => {
      const b = row.building;
      if (p.category !== 'all' && b.category !== p.category) return false;
      if (!matches([b.name, b.description, b.effectText, b.output, categoryNames[b.category]].filter(Boolean).join(' '), p.query)) return false;
      if (p.state === 'all') return true;
      if (p.state === 'unbuilt') return row.level === 0;
      if (p.state === 'complete') return row.level >= row.maximum;
      if (p.state === 'working') return Boolean(row.job);
      if (p.state === 'vacant') return row.level > 0 && !row.governor;
      if (p.state === 'available') return row.level < row.maximum && row.unlock.ok && !row.job;
      return row.status === 'funded';
    });
    // A completed facility has no next cost; it must not sort ahead of cheap upgrades.
    const price = row => row.level >= row.maximum ? Infinity : Number(row.cost?.gold) || 0;
    return filtered.sort((a, b) => {
      let delta = 0;
      if (p.sort === 'level-asc') delta = a.level - b.level;
      else if (p.sort === 'level-desc') delta = b.level - a.level;
      else if (p.sort === 'cost') delta = price(a) - price(b);
      else if (p.sort === 'name') delta = a.building.name.localeCompare(b.building.name, 'ja');
      return (Number.isNaN(delta) ? 0 : delta) || a.index - b.index;
    });
  }
  function refreshFunding(root, resources = {}) {
    for (const label of root?.querySelectorAll?.('[data-facility-funding]') || []) {
      if (!['funded', 'shortage'].includes(label.dataset.facilityStatus)) continue;
      const entry = label.closest('[data-facility-entry]');
      if (!entry || entry.closest('[hidden],[inert],dialog:not([open])')) continue;
      const costs = [...entry.querySelectorAll('[data-cost-resource][data-cost-amount]')];
      if (!costs.length || costs.some(node => !RESOURCES.includes(node.dataset.costResource) || !Number.isFinite(Number(node.dataset.costAmount)) || Number(node.dataset.costAmount) < 0)) continue;
      const enough = costs.every(node => Math.max(0, Number(resources[node.dataset.costResource]) || 0) >= Number(node.dataset.costAmount));
      const status = enough ? 'funded' : 'shortage', text = enough ? '資源充足' : '資源不足';
      if (label.dataset.facilityStatus !== status) label.dataset.facilityStatus = status;
      if (label.textContent !== text) label.textContent = text;
    }
  }
  // Keep at most three valid, distinct identities. Normalize before counting
  // slots, so malformed input never hides a later valid comparison candidate.
  function comparisonRows(selection, resolve) {
    const rows = [], seen = new Set();
    for (const choice of Array.isArray(selection) ? selection : []) {
      if (!choice || typeof choice.id !== 'string' || typeof choice.rank !== 'string' || seen.has(choice.id)) continue;
      const row = resolve(choice);
      if (!row) continue;
      seen.add(choice.id); rows.push(row);
      if (rows.length === 3) break;
    }
    return rows;
  }
  function toggleComparison(selection, candidate, validIds, ranks) {
    const current = comparisonRows(selection, row => validIds.includes(row.id) && ranks.includes(row.rank) ? { id: row.id, rank: row.rank } : null);
    if (!candidate || !validIds.includes(candidate.id) || !ranks.includes(candidate.rank)) return { selection: current, reason: 'invalid' };
    const index = current.findIndex(row => row.id === candidate.id);
    if (index >= 0) {
      if (current[index].rank === candidate.rank) return { selection: current.filter((_, i) => i !== index), reason: 'removed' };
      return { selection: current.map((row, i) => i === index ? { id: candidate.id, rank: candidate.rank } : row), reason: 'replaced' };
    }
    if (current.length >= 3) return { selection: current, reason: 'full' };
    return { selection: [...current, { id: candidate.id, rank: candidate.rank }], reason: 'added' };
  }
  function compareOfficers(game, selection) {
    const rows = comparisonRows(selection, choice => game.officer(choice.id, choice.rank));
    const maxima = Object.fromEntries(STATS.map(key => [key, Math.max(0, ...rows.map(row => Number(row[key]) || 0))]));
    return { rows, maxima, stats: STATS.slice() };
  }
  const api = { FACILITY_KEY, SORTS, STATES, normalizePreferences, readPreferences, savePreferences, facilityRows, filterFacilities, refreshFunding, toggleComparison, compareOfficers };
  global.SengokuManagement = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
