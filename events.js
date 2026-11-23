/* Time-limited event battles. Plans, current defenders and outcomes come from the server. */
(function (global) {
  'use strict';
  const RESOURCES = Object.freeze({ gold: '金銭', rice: '兵糧', wood: '木材', stone: '石材', magatama: '勾玉' });
  const CATEGORIES = Object.freeze({ historical: '歴史上の合戦', castle: '城攻め', roaming: '野良兵' });
  const PENDING_KEY = 'sengoku-events-pending-v1:';
  const clone = value => JSON.parse(JSON.stringify(value));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const integer = (value, min = 0, max = 999999999) => Number.isSafeInteger(value) && value >= min && value <= max;
  const identifier = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,90}$/.test(value);
  const battleIdentifier = value => typeof value === 'string' && /^(?:history|castle|roaming):[A-Za-z0-9_-]{1,90}$/.test(value);
  const text = (value, limit = 3000) => typeof value === 'string' && value.length > 0 && value.length <= limit;
  const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const number = value => Number(value || 0).toLocaleString('ja-JP');
  const date = value => timestamp(value) ? new Date(value).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }) : '開催時に確定';
  const statusName = (event, now = Date.now()) => event.status === 'draft' ? '下書き' : event.status === 'ended' || Date.parse(event.endsAt) <= now ? '終了' : '開催中';
  const active = (event, now) => event?.status === 'active' && Date.parse(event.startsAt) <= now && Date.parse(event.endsAt) > now;
  const remaining = (value, now) => {
    const seconds = Math.max(0, Math.ceil((Date.parse(value) - now) / 1000));
    if (!Number.isFinite(seconds) || seconds === 0) return '終了';
    const days = Math.floor(seconds / 86400), hours = Math.floor(seconds % 86400 / 3600), minutes = Math.ceil(seconds % 3600 / 60);
    return days ? `あと${days}日 ${hours}時間` : hours ? `あと${hours}時間 ${Math.min(59, minutes)}分` : `あと${Math.max(1, minutes)}分`;
  };
  function cleanEvaluation(value) {
    if (!value || value.version !== 1 || !integer(value.score, 0, 100000) || value.maxScore !== 100000 || !integer(value.rankIndex, 0, 16) || !text(value.rankId, 64) || !text(value.rankName, 32)) return null;
    return Object.fromEntries(['version', 'score', 'maxScore', 'rankIndex', 'rankId', 'rankName'].map(key => [key, value[key]]));
  }
  function cleanGift(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !Object.hasOwn(RESOURCES, key))) return null;
    const gift = {};
    for (const key of Object.keys(RESOURCES)) {
      const amount = value[key] ?? 0;
      if (!integer(amount)) return null;
      gift[key] = amount;
    }
    return gift;
  }
  function cleanCatalogEntry(value) {
    if (!value || !battleIdentifier(value.id) || !text(value.name, 120) || !identifier(value.category) || !identifier(value.themeId) || typeof value.unificationEligible !== 'boolean' || !text(value.description, 1500)) return null;
    return Object.fromEntries(['id', 'name', 'category', 'themeId', 'unificationEligible', 'description'].map(key => [key, value[key]]));
  }
  function cleanCatalog(value) {
    if (!Array.isArray(value) || !value.length || value.length > 1000) return null;
    const entries = value.map(cleanCatalogEntry);
    return entries.some(entry => !entry) || new Set(entries.map(entry => entry.id)).size !== entries.length ? null : entries;
  }
  function cleanPlan(value) {
    const legacy = value?.commandCost === undefined && value?.dailyAttempts === 3;
    if (!value || value.schemaVersion !== 1 || value.generator !== 'game-ai-v1' || !text(value.name, 120) || !integer(value.durationDays, 1, 7) || !identifier(value.theme?.id) || !text(value.theme?.label, 120) || !text(value.theme?.description) || !text(value.synopsis) || !Array.isArray(value.rules) || value.rules.length > 12 || value.rules.some(rule => !text(rule, 1000)) || value.commandCost !== 1 && !legacy || !Array.isArray(value.tactics) || value.tactics.length !== 5 || !Array.isArray(value.stages) || value.stages.length !== 3 || !Array.isArray(value.milestones) || value.milestones.length > 12) return null;
    const tactics = value.tactics.map(tactic => tactic && identifier(tactic.id) && text(tactic.name, 120) && text(tactic.description, 1000) ? { id: tactic.id, name: tactic.name, description: tactic.description } : null);
    if (tactics.some(item => !item) || new Set(tactics.map(item => item.id)).size !== tactics.length) return null;
    const stages = value.stages.map(stage => {
      if (!stage || !identifier(stage.id) || !text(stage.name, 120) || !text(stage.description) || !text(stage.enemyName, 120) || !integer(stage.enemyPower, 1) || !integer(stage.basePoints, 1) || !tactics.some(tactic => tactic.id === stage.recommendedTactic) || !text(stage.tacticHint, 1000) || !stage.tacticMultipliers || typeof stage.tacticMultipliers !== 'object') return null;
      const multipliers = {};
      for (const tactic of tactics) { const value = stage.tacticMultipliers[tactic.id]; if (!Number.isFinite(value) || value <= 0 || value > 10) return null; multipliers[tactic.id] = value; }
      return { id: stage.id, name: stage.name, description: stage.description, enemyName: stage.enemyName, enemyPower: stage.enemyPower, basePoints: stage.basePoints, recommendedTactic: stage.recommendedTactic, tacticHint: stage.tacticHint, tacticMultipliers: multipliers };
    });
    const milestones = value.milestones.map(item => { const gift = cleanGift(item?.gift); return item && identifier(item.id) && text(item.title, 120) && integer(item.points, 1) && gift ? { id: item.id, title: item.title, points: item.points, gift } : null; });
    if (stages.some(item => !item) || milestones.some(item => !item) || new Set(stages.map(item => item.id)).size !== stages.length || new Set(milestones.map(item => item.id)).size !== milestones.length) return null;
    const rules = legacy ? ['出陣には通常の指令を1消費します。指令は城下町などの行動と共通です。', ...value.rules.filter(rule => !/(?:24時間ごと|[1１]日[3３]回|各日[3３]回|未使用の回数)/.test(rule))].slice(0, 12) : [...value.rules];
    const extra = {};
    if (value.battleId !== undefined || value.battle !== undefined) {
      const battle = cleanCatalogEntry(value.battle);
      if (!battleIdentifier(value.battleId) || !battle || battle.id !== value.battleId || battle.name !== value.name) return null;
      extra.battleId = value.battleId; extra.battle = battle;
    }
    if (value.ending !== undefined) {
      const ending = value.ending, ids = ending?.requiredStageIds;
      if (!ending || !['unification', 'victory'].includes(ending.kind) || !Array.isArray(ids) || ids.length !== stages.length || new Set(ids).size !== stages.length || ids.some(id => !stages.some(stage => stage.id === id)) || !integer(ending.requiredPoints, 1) || ending.reward !== (ending.kind === 'unification' ? 'shogunate_right' : null) || ending.kind === 'unification' && extra.battle && !extra.battle.unificationEligible) return null;
      extra.ending = { kind: ending.kind, requiredStageIds: [...ids], requiredPoints: ending.requiredPoints, reward: ending.reward };
    }
    if (value.battleRewards !== undefined) {
      if (!value.battleRewards || !['victory', 'defeat'].every(key => Array.isArray(value.battleRewards[key]) && value.battleRewards[key].length === stages.length)) return null;
      const victory = value.battleRewards.victory.map(cleanGift), defeat = value.battleRewards.defeat.map(cleanGift);
      if ([...victory, ...defeat].some(gift => !gift)) return null;
      extra.battleRewards = { victory, defeat };
    }
    return { schemaVersion: 1, generator: 'game-ai-v1', name: value.name, durationDays: value.durationDays, theme: { id: value.theme.id, label: value.theme.label, description: value.theme.description }, synopsis: value.synopsis, rules, commandCost: 1, tactics, stages, milestones, ...extra };
  }
  function cleanOpponent(value) {
    if (value === null) return null;
    if (!value || !identifier(value.castleId) || !text(value.castleName, 120) || !text(value.lordName, 120) || !integer(value.defenseTroops) || !integer(value.defensePower, 1, Number.MAX_SAFE_INTEGER)) return undefined;
    return { castleId: value.castleId, castleName: value.castleName, lordName: value.lordName, defenseTroops: value.defenseTroops, defensePower: value.defensePower };
  }
  function cleanEvent(value, allowDraft = false) {
    const plan = cleanPlan(value?.plan);
    if (!value || !identifier(value.id) || !text(value.name, 120) || !integer(value.durationDays, 1, 7) || !['draft', 'active', 'ended', 'discarded'].includes(value.status) || ['draft', 'discarded'].includes(value.status) && !allowDraft || !timestamp(value.createdAt) || !plan || plan.name !== value.name || plan.durationDays !== value.durationDays) return null;
    if (!['draft', 'discarded'].includes(value.status) && (!timestamp(value.startsAt) || !timestamp(value.endsAt) || Date.parse(value.endsAt) <= Date.parse(value.startsAt))) return null;
    if (value.endedAt != null && !timestamp(value.endedAt)) return null;
    const opponent = cleanOpponent(value.opponent);
    if (value.opponent !== undefined && opponent === undefined) return null;
    return { ...(opponent !== undefined ? { opponent } : {}), id: value.id, name: value.name, durationDays: value.durationDays, status: value.status, startsAt: timestamp(value.startsAt) ? value.startsAt : null, endsAt: timestamp(value.endsAt) ? value.endsAt : null, endedAt: value.endedAt || null, createdAt: value.createdAt, plan };
  }
  function cleanDefenseAdviser(value) {
    if (value === null) return null;
    if (!value || !identifier(value.castleId) || !text(value.castleName, 120) || !integer(value.defenseTroops) || !integer(value.defensePower, 1, Number.MAX_SAFE_INTEGER) || !integer(value.reinforcementTroops, 0, value.defenseTroops) || !text(value.headline, 160) || !text(value.summary, 1500) || !Array.isArray(value.measures) || !value.measures.length || value.measures.length > 12 || !Array.isArray(value.stages) || !value.stages.length || value.stages.length > 3) return undefined;
    const measures = value.measures.map(item => item && identifier(item.id) && integer(item.priority, 1, 3) && text(item.title, 160) && text(item.detail, 1500) ? { id: item.id, priority: item.priority, title: item.title, detail: item.detail } : null);
    const stages = value.stages.map(item => item && identifier(item.stageId) && text(item.stageName, 120) && identifier(item.attackTactic) && text(item.attackTacticName, 120) && text(item.defensePlan, 300) && text(item.reason, 1500) ? { stageId: item.stageId, stageName: item.stageName, attackTactic: item.attackTactic, attackTacticName: item.attackTacticName, defensePlan: item.defensePlan, reason: item.reason } : null);
    if (measures.some(item => !item) || stages.some(item => !item) || new Set(measures.map(item => item.id)).size !== measures.length || new Set(stages.map(item => item.stageId)).size !== stages.length) return undefined;
    return { castleId: value.castleId, castleName: value.castleName, defenseTroops: value.defenseTroops, defensePower: value.defensePower, reinforcementTroops: value.reinforcementTroops, headline: value.headline, summary: value.summary, measures, stages };
  }
  function cleanProgress(value) {
    if (value == null) return null;
    if (!integer(value.points) || !integer(value.wins) || !integer(value.battles) || !Object.hasOwn(value, 'command') || !Array.isArray(value.rewards) || value.rewards.length > 12) return undefined;
    if (value.command != null && (!integer(value.command.available) || !integer(value.command.max, 1) || value.command.available > value.command.max || value.command.cost !== 1)) return undefined;
    const rewards = value.rewards.map(item => item && identifier(item.milestoneId) && identifier(item.mailId) && timestamp(item.awardedAt) ? { milestoneId: item.milestoneId, mailId: item.mailId, awardedAt: item.awardedAt } : null);
    if (rewards.some(item => !item)) return undefined;
    const extra = {};
    if (value.battleEligibility !== undefined) {
      const access = value.battleEligibility;
      if (!access || typeof access.canAttack !== 'boolean' || access.canAttack && access.reason !== null || !access.canAttack && !['own_castle', 'refresh_required'].includes(access.reason)) return undefined;
      extra.battleEligibility = { canAttack: access.canAttack, reason: access.reason };
    }
    if (value.defenseAdviser !== undefined) {
      const defenseAdviser = cleanDefenseAdviser(value.defenseAdviser);
      if (defenseAdviser === undefined) return undefined;
      extra.defenseAdviser = defenseAdviser;
    }
    if (value.advisers !== undefined) {
      if (!Array.isArray(value.advisers) || value.advisers.length > 3) return undefined;
      const option = item => item && identifier(item.tactic) && text(item.tacticName, 120) && Number.isFinite(item.winChance) && item.winChance >= 0 && item.winChance <= 100 && Number.isFinite(item.playerPower) && item.playerPower >= 0 && Number.isFinite(item.enemyPower) && item.enemyPower >= 0 ? { tactic: item.tactic, tacticName: item.tacticName, winChance: item.winChance, playerPower: item.playerPower, enemyPower: item.enemyPower } : null;
      const advisers = value.advisers.map(item => {
        const advice = option(item), choices = Array.isArray(item?.options) && item.options.length <= 5 ? item.options.map(option) : null;
        if (!advice || !identifier(item.stageId) || !text(item.reason, 1500) || !choices?.length || choices.some(item => !item) || new Set(choices.map(item => item.tactic)).size !== choices.length || !choices.some(item => item.tactic === advice.tactic)) return null;
        return { stageId: item.stageId, ...advice, reason: item.reason, options: choices };
      });
      if (advisers.some(item => !item) || new Set(advisers.map(item => item.stageId)).size !== advisers.length) return undefined;
      extra.advisers = advisers;
    }
    if (value.unification !== undefined && value.unification !== null) {
      const item = value.unification, ids = key => Array.isArray(item[key]) && item[key].length <= 3 && item[key].every(identifier) && new Set(item[key]).size === item[key].length;
      if (typeof item.eligible !== 'boolean' || typeof item.achieved !== 'boolean' || !ids('clearedStageIds') || !ids('requiredStageIds') || !integer(item.points) || !integer(item.requiredPoints) || item.earnedAt != null && !timestamp(item.earnedAt) || item.achieved && (!item.eligible || !timestamp(item.earnedAt) || !item.requiredStageIds.length || item.requiredStageIds.some(id => !item.clearedStageIds.includes(id)) || item.points < item.requiredPoints)) return undefined;
      extra.unification = { eligible: item.eligible, clearedStageIds: [...item.clearedStageIds], requiredStageIds: [...item.requiredStageIds], points: item.points, requiredPoints: item.requiredPoints, achieved: item.achieved, earnedAt: item.earnedAt || null };
    }
    return { points: value.points, wins: value.wins, battles: value.battles, command: value.command ? { available: value.command.available, max: value.command.max, cost: 1 } : null, rewards, ...extra };
  }
  function cleanCommands(value) {
    const ready = Boolean(value?.ready === true && integer(value.current) && integer(value.max, 1) && value.current <= value.max && value.cost === 1);
    return { current: ready ? value.current : null, max: ready ? value.max : null, cost: 1, ready, writable: ready && value.writable === true, message: typeof value?.message === 'string' ? value.message.slice(0, 1000) : '' };
  }
  function cleanLeaderboard(value) {
    if (!Array.isArray(value) || value.length > 100) return null;
    const rows = value.map((item, index) => {
      const name = item?.name ?? item?.playerName;
      if (!item || !/^u_[a-f0-9]{32}$/.test(String(item.playerId || '')) || !text(name, 120) || !integer(item.points) || !integer(item.wins)) return null;
      return { rank: integer(item.rank, 1, 1000000) ? item.rank : index + 1, playerId: item.playerId, name, points: item.points, wins: item.wins, battles: integer(item.battles) ? item.battles : 0, avatarVersion: /^[a-f0-9]{64}$/.test(String(item.avatarVersion || '')) ? item.avatarVersion : null, evaluation: cleanEvaluation(item.evaluation), appearance: global.SengokuPremiumRuntime?.cleanAppearance?.(item.appearance) || null };
    });
    return rows.some(item => !item) ? null : rows;
  }
  function cleanBattle(value, record, event) {
    const stage = event.plan.stages.find(item => item.id === record.data.stageId), tactic = event.plan.tactics.find(item => item.id === record.data.tactic);
    if (!value || typeof value.won !== 'boolean' || !integer(value.points) || !stage || !tactic || value.stageId !== stage.id || value.tactic !== tactic.id || !text(value.stageName, 120) || !text(value.tacticName, 120) || !text(value.enemyName, 120) || !Number.isFinite(value.playerPower) || value.playerPower < 0 || !Number.isFinite(value.enemyPower) || value.enemyPower < 0 || !Number.isFinite(value.winChance) || value.winChance < 0 || value.winChance > 100 || !text(value.summary) || !Array.isArray(value.log) || value.log.length > 30 || value.log.some(line => !text(line, 1500))) return null;
    const battle = Object.fromEntries(['won', 'points', 'stageId', 'stageName', 'tactic', 'tacticName', 'enemyName', 'playerPower', 'enemyPower', 'winChance', 'summary', 'log'].map(key => [key, clone(value[key])]));
    if (value.opponent !== undefined) {
      const opponent = cleanOpponent(value.opponent);
      if (opponent === undefined || opponent && battle.enemyPower !== opponent.defensePower) return null;
      battle.opponent = opponent;
    }
    for (const key of ['rewards', 'offeredRewards']) if (value[key] !== undefined) { const gift = cleanGift(value[key]); if (!gift) return null; battle[key] = gift; }
    return battle;
  }
  function createController(options = {}) {
    const request = options.request || ((route, settings) => {
      if (settings?.method === 'POST' && /^\/events\/[A-Za-z0-9_-]{1,90}\/battle$/.test(route)) {
        if (typeof global.SengokuBridge?.eventBattle !== 'function') throw Object.assign(Error('指令と保存状態を確認できません。画面を再読み込みしてください。'), { status: 409 });
        return global.SengokuBridge.eventBattle(route, settings);
      }
      return global.SengokuSocial.eventRequest(route, settings);
    });
    const getContext = options.getContext || (() => global.SengokuSocial?.getEventContext?.());
    const now = options.now || (() => Date.now()), uuid = options.uuid || (() => global.crypto.randomUUID());
    let storage; try { storage = options.storage ?? global.localStorage; } catch (_) {}
    const onChange = options.onChange || (() => {});
    let disposed = false, stamp = '', generation = 0, listSequence = 0, detailSequence = 0, summarySequence = 0, catalogSequence = 0, writePromise = null;
    const bundledCatalog = () => { try { return cleanCatalog(options.catalog || global.SengokuBattleCatalog?.list?.()) || []; } catch (_) { return []; } };
    const empty = () => ({ open: false, admin: false, playerId: '', signedIn: false, authorized: false, blocked: false, connected: false, publicEvents: [], events: [], publicLoaded: false, loaded: false, loading: false, detailLoading: false, summaryLoading: false, selectedId: '', event: null, progress: null, leaderboard: [], stageId: '', tactic: '', battle: null, rewardMailIds: [], name: '', battleId: '', durationDays: 3, catalog: bundledCatalog(), catalogLoaded: false, catalogLoading: false, catalogQuery: '', catalogCategory: '', catalogMessage: '', confirmation: null, pending: null, sending: false, error: '', message: '', serverOffset: 0, change: 'init' });
    let state = empty();
    const snapshot = () => ({ ...clone(state), commands: commands() });
    function commands() {
      const value = getContext() || {};
      // A real game always uses its verified live engine view, including a
      // not-ready/read-only state. Only a bridge-free fixture uses the DTO.
      if (Object.hasOwn(value, 'commands') || global.SengokuBridge) return cleanCommands(value.commands);
      const saved = state.progress?.command;
      return cleanCommands(saved ? { current: saved.available, max: saved.max, cost: saved.cost, ready: state.signedIn, writable: state.signedIn } : null);
    }
    const context = () => {
      const value = getContext() || {}, user = value.user;
      const playerId = typeof value.playerId === 'string' ? value.playerId : typeof user?.id === 'string' ? user.id : '';
      const blocked = Boolean(value.pending || value.banned || user?.isBanned), signedIn = Boolean(playerId && user?.id === playerId && !blocked), authorized = signedIn && value.isAdmin === true && user?.isAdmin === true;
      return { playerId, signedIn, authorized, blocked, connected: value.connected !== false, stamp: JSON.stringify([playerId, value.epoch ?? null, value.privilegeEpoch ?? null, value.accountEpoch ?? null, signedIn, authorized, blocked]) };
    };
    function emit(change = 'status') { if (!disposed) { state.change = change; onChange(snapshot()); } }
    function pendingKey(owner) { return PENDING_KEY + encodeURIComponent(owner); }
    function readPending(who) {
      if (!who.signedIn) return null;
      try {
        const item = JSON.parse(storage?.getItem(pendingKey(who.playerId)) || 'null');
        if (!item || item.ownerId !== who.playerId || !identifier(item.data?.requestId) || !['generate', 'publish', 'end', 'discard', 'battle'].includes(item.kind) || item.kind !== 'battle' && !who.authorized) return null;
        if (item.kind === 'generate') {
          // Older pending operations keep their original name and request ID:
          // only their already-submitted result may be recovered this way.
          const selection = battleIdentifier(item.data.battleId) ? { battleId: item.data.battleId } : item.data.battleId === undefined && text(item.data.name, 120) ? { name: item.data.name } : null;
          return item.route === '/admin/events/generate' && selection && integer(item.data.durationDays, 1, 7) ? { ownerId: item.ownerId, kind: item.kind, route: item.route, eventId: '', data: { ...selection, durationDays: item.data.durationDays, requestId: item.data.requestId } } : null;
        }
        if (!identifier(item.eventId)) return null;
        const route = item.kind === 'battle' ? '/events/' + item.eventId + '/battle' : '/admin/events/' + item.eventId + '/' + item.kind;
        if (item.route !== route || item.kind === 'battle' && (!identifier(item.data.stageId) || !identifier(item.data.tactic))) return null;
        return { ownerId: item.ownerId, kind: item.kind, route, eventId: item.eventId, data: { ...(item.kind === 'battle' ? { stageId: item.data.stageId, tactic: item.data.tactic } : {}), requestId: item.data.requestId } };
      } catch (_) { return null; }
    }
    function storePending(record) {
      if (!storage?.setItem) throw Error('操作の記録を保存できません。ブラウザの保存設定を確認してからお試しください。');
      const value = JSON.stringify(record); storage.setItem(pendingKey(record.ownerId), value);
      if (storage.getItem(pendingKey(record.ownerId)) !== value) throw Error('操作の記録を保存できませんでした。');
    }
    function clearPending(record) {
      try { const saved = JSON.parse(storage?.getItem(pendingKey(record.ownerId)) || 'null'); if (saved?.data?.requestId === record.data.requestId) storage.removeItem(pendingKey(record.ownerId)); } catch (_) {}
    }
    function identity() {
      const who = context();
      if (who.stamp !== stamp) {
        const wasOpen = state.open && !state.admin, publicEvents = state.publicEvents, publicLoaded = state.publicLoaded, serverOffset = state.serverOffset, catalog = state.catalog, catalogLoaded = state.catalogLoaded;
        stamp = who.stamp; generation++; listSequence++; detailSequence++; summarySequence++; catalogSequence++; writePromise = null;
        state = { ...empty(), open: wasOpen, playerId: who.playerId, signedIn: who.signedIn, authorized: who.authorized, blocked: who.blocked, connected: who.connected, publicEvents, publicLoaded, serverOffset, catalog, catalogLoaded, pending: readPending(who) };
        emit('identity');
      } else state.connected = who.connected;
      return who;
    }
    function current(g, expected) { return !disposed && g === generation && expected === stamp && context().stamp === expected; }
    function setClock(value) { if (timestamp(value)) state.serverOffset = Date.parse(value) - now(); }
    const serverTime = () => now() + state.serverOffset;
    function applyEvent(event, { fromList = false } = {}) {
      const same = state.event?.id === event.id, previousStage = state.stageId;
      // List summaries can omit live defenders. Keep the last verified detail
      // until the same event's next detail response confirms a change.
      if (fromList && same && event.status !== 'draft' && state.event.opponent !== undefined) event = { ...event, opponent: state.event.opponent };
      state.event = event; state.selectedId = event.id;
      const stage = event.plan.stages.find(item => same && item.id === previousStage) || event.plan.stages[0];
      state.stageId = stage.id;
      if (!same || !event.plan.tactics.some(item => item.id === state.tactic)) state.tactic = stage.recommendedTactic;
      if (!same) { state.progress = null; state.leaderboard = []; state.battle = null; state.rewardMailIds = []; }
      const index = state.events.findIndex(item => item.id === event.id);
      if (index < 0) state.events.unshift(event); else state.events[index] = event;
      if (!['draft', 'discarded'].includes(event.status)) {
        const index = state.publicEvents.findIndex(item => item.id === event.id);
        if (index < 0) state.publicEvents.unshift(event); else state.publicEvents[index] = event;
      }
    }
    async function call(route, settings, g, expected) {
      if (!current(g, expected)) throw Object.assign(Error('接続する領主が変わりました。'), { code: 'STALE_IDENTITY' });
      const result = await request(route, settings);
      if (!current(g, expected)) { identity(); throw Object.assign(Error('接続する領主または利用権限が変わりました。'), { code: 'STALE_IDENTITY' }); }
      if (result?.ok !== true) throw Object.assign(Error(result?.error?.message || 'イベントの応答を確認できませんでした。'), { code: result?.error?.code });
      return result;
    }
    function fail(error, g, expected) { identity(); if (current(g, expected) && error.code !== 'STALE_IDENTITY') { state.error = error.message || '通信の結果を確認できませんでした。'; emit('error'); } }
    async function loadCatalog({ force = false } = {}) {
      identity(); if (disposed || !state.open || !state.admin || !state.authorized || state.catalogLoading || state.sending || state.confirmation || state.catalogLoaded && !force) return false;
      const g = generation, expected = stamp, seq = ++catalogSequence;
      state.catalogLoading = true; state.catalogMessage = ''; emit('catalog-loading');
      try {
        const result = await call('/events/catalog', { method: 'GET' }, g, expected);
        if (!current(g, expected) || seq !== catalogSequence || !state.open) return false;
        const catalog = result.version === 1 && cleanCatalog(result.battles);
        if (!catalog) throw Error('選択できる戦いの一覧を確認できませんでした。');
        state.catalog = catalog; state.catalogLoaded = true;
        const selected = catalog.find(item => item.id === state.battleId);
        if (!selected) { state.battleId = ''; state.name = ''; } else state.name = selected.name;
        emit('catalog'); return true;
      } catch (error) {
        if (current(g, expected)) { state.catalogMessage = state.catalog.length ? '一覧を更新できませんでした。登録済みの戦いから選択できます。' : error.message || '戦いの一覧を取得できませんでした。更新してお試しください。'; emit('catalog-error'); }
        return false;
      } finally { if (current(g, expected) && seq === catalogSequence) { state.catalogLoading = false; emit('catalog-settled'); } }
    }
    async function refreshSummary() {
      identity(); if (disposed || state.summaryLoading) return false;
      const g = generation, expected = stamp, seq = ++summarySequence;
      state.summaryLoading = true;
      try {
        const result = await call('/events', { method: 'GET' }, g, expected);
        if (!current(g, expected) || seq !== summarySequence) return false;
        if (!Array.isArray(result.events) || result.events.length > 100) throw Error('イベント一覧の形式を確認できませんでした。');
        const events = result.events.map(event => cleanEvent(event));
        if (events.some(event => !event)) throw Error('公開イベントの内容を確認できませんでした。');
        state.publicEvents = events; state.publicLoaded = true; setClock(result.serverNow); emit('summary'); return true;
      } catch (_) { return false; }
      finally { if (current(g, expected) && seq === summarySequence) state.summaryLoading = false; }
    }
    async function loadDetail(id = state.selectedId, { quiet = false } = {}) {
      identity(); if (disposed || !state.open || !identifier(id) || state.sending || state.confirmation) return false;
      const known = state.events.find(event => event.id === id);
      if (known?.status === 'draft') { if (state.admin && state.authorized) { applyEvent(known); state.detailLoading = false; emit('detail'); return true; } return false; }
      const g = generation, expected = stamp, seq = ++detailSequence;
      if (!quiet) { state.detailLoading = true; state.error = ''; emit('loading-detail'); }
      try {
        const result = await call('/events/' + encodeURIComponent(id), { method: 'GET' }, g, expected);
        if (!current(g, expected) || seq !== detailSequence || !state.open || state.selectedId !== id) return false;
        const event = cleanEvent(result.event), progress = cleanProgress(result.progress), leaderboard = cleanLeaderboard(result.leaderboard);
        if (!event || event.id !== id || progress === undefined || !leaderboard || !state.signedIn && progress !== null) throw Error('イベントの進捗を確認できませんでした。');
        applyEvent({ ...event, opponent: event.opponent ?? null }); state.progress = progress; state.leaderboard = leaderboard; setClock(result.serverNow); emit('detail'); return true;
      } catch (error) { if (!quiet) fail(error, g, expected); return false; }
      finally { if (current(g, expected) && seq === detailSequence) { state.detailLoading = false; emit('detail-settled'); } }
    }
    async function load({ quiet = false } = {}) {
      identity(); if (disposed || !state.open || state.loading || state.sending || state.confirmation || state.admin && !state.authorized) return false;
      const g = generation, expected = stamp, seq = ++listSequence;
      state.loading = true; if (!quiet) state.error = ''; emit('loading');
      try {
        const result = await call(state.admin ? '/admin/events' : '/events', { method: 'GET' }, g, expected);
        if (!current(g, expected) || seq !== listSequence || !state.open) return false;
        if (!Array.isArray(result.events) || result.events.length > 100) throw Error('イベント一覧の形式を確認できませんでした。');
        const events = result.events.map(event => cleanEvent(event, state.admin));
        if (events.some(event => !event)) throw Error('イベントの設計内容を確認できませんでした。');
        state.events = events; state.loaded = true; setClock(result.serverNow);
        if (!state.admin) { state.publicEvents = events; state.publicLoaded = true; }
        const selected = events.find(event => event.id === state.selectedId) || events.find(event => event.id === state.pending?.eventId) || events.find(event => active(event, serverTime())) || events[0];
        if (selected) applyEvent(selected, { fromList: true }); else { state.selectedId = ''; state.event = null; state.progress = null; state.leaderboard = []; state.battle = null; }
        emit('list'); if (selected) await loadDetail(selected.id, { quiet }); return true;
      } catch (error) { if (!quiet) fail(error, g, expected); return false; }
      finally { if (current(g, expected) && seq === listSequence) { state.loading = false; emit('settled'); } }
    }
    function open({ admin = false } = {}) {
      identity(); if (disposed || admin && !state.authorized) return Promise.resolve(false);
      if (state.pending?.kind !== 'battle' && state.pending && state.authorized) admin = true;
      const changed = state.admin !== Boolean(admin);
      state.open = true; state.admin = Boolean(admin); state.error = ''; state.message = '';
      if (changed) { state.events = []; state.selectedId = ''; state.event = null; state.loaded = false; state.progress = null; state.leaderboard = []; state.battle = null; state.confirmation = null; }
      emit('open'); return state.admin ? Promise.all([load(), loadCatalog()]).then(([loaded]) => loaded) : load();
    }
    function close() { if (disposed) return; state.open = false; state.confirmation = null; listSequence++; detailSequence++; catalogSequence++; state.loading = state.detailLoading = state.catalogLoading = false; emit('close'); }
    function select(id) {
      identity(); if (!state.open || state.sending || state.confirmation || !identifier(id)) return Promise.resolve(false);
      const event = state.events.find(item => item.id === id); if (!event) return Promise.resolve(false);
      detailSequence++; state.error = ''; applyEvent(event); emit('select'); return loadDetail(id);
    }
    function setDraft(battleId, durationDays) { identity(); if (!state.admin || !state.authorized || state.sending || state.pending || state.confirmation) return false; state.battleId = String(battleId ?? ''); state.name = state.catalog.find(item => item.id === state.battleId)?.name || ''; state.durationDays = Number(durationDays); state.error = ''; emit('input'); return true; }
    function filterCatalog(query, category = state.catalogCategory) { identity(); if (!state.admin || !state.authorized || state.sending || state.pending || state.confirmation) return false; state.catalogQuery = String(query ?? '').slice(0, 120); state.catalogCategory = category === '' || state.catalog.some(item => item.category === category) ? category : ''; emit('catalog-filter'); return true; }
    function chooseStage(id) { identity(); if (!state.open || state.admin || state.sending || state.pending) return false; const stage = state.event?.plan.stages.find(item => item.id === id); if (!stage) return false; state.stageId = stage.id; state.tactic = stage.recommendedTactic; emit('choice'); return true; }
    function chooseTactic(id) { identity(); if (!state.open || state.admin || state.sending || state.pending || !eventBattleEligibility(state).canAttack || !state.event?.plan.tactics.some(item => item.id === id)) return false; state.tactic = id; emit('choice'); return true; }
    function applyAdvice() {
      identity(); if (!state.open || state.admin || !state.signedIn || state.sending || state.pending || state.confirmation || state.detailLoading || !eventBattleEligibility(state).canAttack) return false;
      const advice = selectedAdvice(state); if (!advice || !chooseTactic(advice.tactic)) return false;
      state.message = '軍師の提案「' + advice.tacticName + '」を反映しました。戦況を確認して出陣してください。'; emit('advice'); return true;
    }
    function record(kind, eventId = '', data = {}) {
      const requestId = String(uuid()); if (!identifier(requestId)) throw Error('送信番号を作成できませんでした。画面を開き直してください。');
      return { ownerId: state.playerId, kind, eventId, route: kind === 'generate' ? '/admin/events/generate' : (kind === 'battle' ? '/events/' : '/admin/events/') + eventId + '/' + kind, data: { ...data, requestId } };
    }
    function permitted(item) { return state.signedIn && item.ownerId === state.playerId && (item.kind === 'battle' || state.authorized); }
    function prepare(kind) {
      identity(); if (!state.open || !state.admin || !state.authorized || state.sending || state.pending || state.confirmation || !state.event || ['publish', 'discard'].includes(kind) && state.event.status !== 'draft' || kind === 'end' && !active(state.event, serverTime()) || !['publish', 'end', 'discard'].includes(kind)) return false;
      try { state.confirmation = { ...record(kind, state.event.id), event: clone(state.event) }; state.error = ''; emit('confirm'); return true; } catch (error) { state.error = error.message; emit('error'); return false; }
    }
    function back() { if (!state.sending && !state.pending) { state.confirmation = null; emit('back'); } }
    function send(item) {
      identity(); if (writePromise) return writePromise;
      if (disposed || !state.open || !item || !permitted(item) || state.sending) return Promise.resolve(false);
      const g = generation, expected = stamp;
      const saved = { ownerId: item.ownerId, kind: item.kind, route: item.route, eventId: item.eventId, data: clone(item.data) };
      try { storePending(saved); } catch (error) { state.error = error.message || '操作の記録を保存できませんでした。'; emit('error'); return Promise.resolve(false); }
      state.pending = saved; state.confirmation = null; state.sending = true; state.error = state.message = ''; detailSequence++; listSequence++; state.loading = state.detailLoading = false; emit('sending');
      const operation = Promise.resolve().then(async () => {
        let refresh = false;
        try {
          const result = await call(saved.route, { method: 'POST', data: clone(saved.data) }, g, expected);
          if (!current(g, expected)) return false;
          const event = cleanEvent(result.event, saved.kind !== 'battle');
          if (!event || saved.eventId && event.id !== saved.eventId || saved.kind === 'generate' && ((saved.data.battleId ? event.plan.battleId !== saved.data.battleId : event.name !== saved.data.name) || event.durationDays !== saved.data.durationDays) || saved.kind === 'publish' && !['active', 'ended'].includes(event.status) || saved.kind === 'end' && event.status !== 'ended' || saved.kind === 'discard' && event.status !== 'discarded') throw Error('操作の結果を確認できませんでした。同じ操作の結果を確認してください。');
          let progress, battle, rewardMailIds;
          if (saved.kind === 'battle') {
            progress = cleanProgress(result.progress); battle = cleanBattle(result.battle, saved, event); rewardMailIds = result.rewardMailIds;
            if (!progress || !battle || !Array.isArray(rewardMailIds) || rewardMailIds.some(id => !identifier(id))) throw Error('合戦の結果を確認できませんでした。同じ出陣の結果を確認してください。');
          }
          clearPending(saved); state.pending = null; setClock(result.serverNow); state.error = '';
          if (saved.kind === 'discard') {
            state.events = state.events.filter(item => item.id !== event.id);
            const next = state.events[0];
            state.selectedId = ''; state.event = null; state.progress = null; state.leaderboard = []; state.battle = null; state.rewardMailIds = [];
            if (next) applyEvent(next);
          } else applyEvent(event);
          if (saved.kind === 'battle') { state.progress = progress; state.battle = battle; state.rewardMailIds = [...rewardMailIds]; state.message = rewardMailIds.length ? '合戦の結果が確定しました。達成した報酬がシステム便に届いています。' : '合戦の結果が確定しました。'; }
          else state.message = saved.kind === 'generate' ? '設計案ができました。3つの戦場と報酬を確認してから開催できます。' : saved.kind === 'publish' ? '開催を確定しました。全プレイヤーの催事・合戦に表示されます。' : saved.kind === 'discard' ? '未公開の下書きを破棄しました。新しい設計案を作成できます。' : 'この催事・合戦を終了しました。確定済みの戦功とシステム便は残ります。';
          state.loaded = true; refresh = Boolean(state.event && state.event.status !== 'draft'); emit('result'); return true;
        } catch (error) {
          identity(); if (!current(g, expected) || error.code === 'STALE_IDENTITY') return false;
          const status = Number(error.status || error.statusCode);
          if (status >= 400 && status < 500 && ![408, 425, 429].includes(status)) { clearPending(saved); state.pending = null; refresh = Boolean(state.selectedId); }
          state.error = error.message || '通信結果が未確認です。同じ操作の結果を確認してください。'; emit('error'); return false;
        } finally {
          if (current(g, expected)) { state.sending = false; writePromise = null; emit('write-settled'); if (refresh && state.open) await loadDetail(state.selectedId, { quiet: true }); }
        }
      });
      writePromise = operation; return operation;
    }
    function generate() {
      identity(); if (!state.open || !state.admin || !state.authorized || state.pending || state.sending || state.confirmation) return Promise.resolve(false);
      const battle = state.catalog.find(item => item.id === state.battleId);
      if (!battle || !integer(state.durationDays, 1, 7)) { state.error = '一覧から戦いを選び、開催期間を1〜7日で指定してください。'; emit('error'); return Promise.resolve(false); }
      try { state.name = battle.name; return send(record('generate', '', { battleId: battle.id, durationDays: state.durationDays })); } catch (error) { state.error = error.message; emit('error'); return Promise.resolve(false); }
    }
    function battle() {
      identity(); const command = commands();
      if (!state.open || state.admin || !state.signedIn || state.pending || state.sending || state.detailLoading || !active(state.event, serverTime()) || !state.progress || !eventBattleEligibility(state).canAttack || !command.ready || !command.writable || command.current < command.cost) return Promise.resolve(false);
      if (!state.event.plan.stages.some(stage => stage.id === state.stageId) || !state.event.plan.tactics.some(tactic => tactic.id === state.tactic)) return Promise.resolve(false);
      try { return send(record('battle', state.event.id, { stageId: state.stageId, tactic: state.tactic })); } catch (error) { state.error = error.message; emit('error'); return Promise.resolve(false); }
    }
    const confirm = () => { identity(); return state.confirmation && !state.pending && !state.sending ? send(state.confirmation) : Promise.resolve(false); };
    const retry = () => { identity(); return state.pending && !state.sending ? send(state.pending) : Promise.resolve(false); };
    function refreshAccess() { const before = generation; identity(); if (before !== generation && state.open) return load(); return Promise.resolve(true); }
    identity();
    return { getState: () => { identity(); return snapshot(); }, serverTime, open, close, refresh: load, refreshCatalog: () => loadCatalog({ force: true }), refreshSummary, refreshDetail: () => loadDetail(state.selectedId, { quiet: true }), refreshAccess, select, setDraft, filterCatalog, chooseStage, chooseTactic, applyAdvice, generate, prepare, back, confirm, battle, retry, dispose() { if (disposed) return; state.open = false; emit('dispose'); disposed = true; generation++; } };
  }
  function giftMarkup(gift) { return Object.entries(RESOURCES).filter(([key]) => gift[key] > 0).map(([key, label]) => `<span>${label}<b>${number(gift[key])}</b></span>`).join(''); }
  function filteredCatalog(state) {
    const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/ヶ/g, 'ケ'), query = normalize(state.catalogQuery).trim();
    return state.catalog.filter(item => (!state.catalogCategory || item.category === state.catalogCategory) && (!query || normalize(item.name + ' ' + item.description + ' ' + (CATEGORIES[item.category] || item.category)).includes(query)));
  }
  function catalogOptionsMarkup(state) {
    const entries = filteredCatalog(state), selected = state.catalog.find(item => item.id === state.battleId), categories = [...new Set(entries.map(item => item.category))];
    const option = item => `<option value="${esc(item.id)}">${esc(item.name)}${item.unificationEligible ? ' · 天下統一型' : ''}</option>`;
    return `<option value="">${entries.length ? '戦いを選択してください' : state.catalogLoading ? '戦いの一覧を確認中…' : '条件に合う戦いがありません'}</option>${selected && !entries.some(item => item.id === selected.id) ? `<optgroup label="選択中">${option(selected)}</optgroup>` : ''}${categories.map(category => `<optgroup label="${esc(CATEGORIES[category] || category)}">${entries.filter(item => item.category === category).map(option).join('')}</optgroup>`).join('')}`;
  }
  function targetCastle(selection) {
    const id = global.SengokuBattleCatalog?.targetCastleId?.(selection);
    return id && global.SENGOKU_DATA?.castles?.find(castle => castle.id === id);
  }
  function catalogSelectionMarkup(state) {
    const selected = state.catalog.find(item => item.id === state.battleId);
    if (!selected) return '<p class="events-note">歴史上の合戦・城攻め・野良兵から戦いを選べます。名前を自由入力する必要はありません。</p>';
    const castle = targetCastle(selected);
    return `<span class="events-eyebrow">${esc(CATEGORIES[selected.category] || selected.category)}</span><h3>${esc(selected.name)}</h3><p>${esc(selected.description)}</p>${castle ? `<p class="events-note">${esc(castle.name)}に領主がいる場合は、出陣時の守備戦力を敵戦力に用います。</p>` : ''}<p class="events-note">${selected.unificationEligible ? '天下統一型：3つの戦場すべての勝利と最終戦功を達成すると、幕府開設権を獲得できます。必要戦功は設計案で確認できます。' : '通常合戦：出陣ごとの資源報酬と、戦功に応じた褒賞を用意します。'}</p>`;
  }
  function selectedAdvice(state) {
    const plan = state.event?.plan, stage = plan?.stages.find(item => item.id === state.stageId);
    if (!stage) return null;
    const advice = state.progress?.advisers?.find(item => item.stageId === stage.id && plan.tactics.some(tactic => tactic.id === item.tactic));
    if (advice && (!state.event.opponent || advice.enemyPower === state.event.opponent.defensePower && advice.options.every(option => option.enemyPower === advice.enemyPower))) return { ...advice, exact: true };
    const tactic = plan.tactics.find(item => item.id === stage.recommendedTactic);
    return tactic ? { stageId: stage.id, tactic: tactic.id, tacticName: tactic.name, reason: stage.tacticHint, exact: false } : null;
  }
  function currentDefenseAdviser(state) {
    // Ownership is established by the server for this signed-in identity. A
    // matching lord name never grants the private defensive briefing.
    const advice = state.progress?.defenseAdviser, opponent = state.event?.opponent;
    if (!state.signedIn || !advice || !opponent || advice.castleId !== opponent.castleId || advice.defenseTroops !== opponent.defenseTroops || advice.defensePower !== opponent.defensePower || advice.stages.some(stage => !state.event.plan.stages.some(item => item.id === stage.stageId) || !state.event.plan.tactics.some(item => item.id === stage.attackTactic))) return null;
    return advice;
  }
  function eventBattleEligibility(state) {
    // Eligibility is private server state and remains authoritative even when
    // the advisory snapshot is unavailable. Missing state cannot authorize a
    // new attack; recovery of an already-sent request still uses its receipt.
    if (currentDefenseAdviser(state)) return { canAttack: false, reason: 'own_castle' };
    return state.progress?.battleEligibility || { canAttack: false, reason: 'refresh_required' };
  }
  function participationMarkup(state) {
    if (!state.signedIn || !state.progress) return '';
    const access = eventBattleEligibility(state);
    if (access.canAttack) return '';
    return access.reason === 'own_castle'
      ? '<section class="events-participation-notice" aria-label="防衛側の参加"><h3>あなたの拠点は防衛専用です</h3><p>自分が領主の拠点には出陣できません。指令は消費されません。</p></section>'
      : '<section class="events-participation-notice" aria-label="出陣可否の確認"><h3>最新の領主情報を確認してください</h3><p>拠点の状態を確認してから出陣できます。画面上部の「更新」で最新情報を取得してください。</p></section>';
  }
  function defenseAdviserMarkup(state) {
    const advice = currentDefenseAdviser(state);
    if (!advice) return '';
    const priorities = { 1: '最優先', 2: '次の備え', 3: '継続する備え' };
    const measures = [...advice.measures].sort((a, b) => a.priority - b.priority);
    return `<section class="events-defense-adviser" aria-labelledby="events-defense-title"><header><span class="events-eyebrow">軍師AI</span><h3 id="events-defense-title">防衛軍議 · あなたの拠点</h3><p class="events-defense-castle">${esc(advice.castleName)}の守りを整える</p></header><h4>${esc(advice.headline)}</h4><p>${esc(advice.summary)}</p><dl class="events-defense-stats"><div><dt>現在の守備兵</dt><dd>${number(advice.defenseTroops)}<small>人</small></dd></div><div><dt>現在の守備戦力</dt><dd>${number(advice.defensePower)}</dd></div><div><dt>守備兵に含まれる援軍</dt><dd>${number(advice.reinforcementTroops)}<small>人</small></dd></div></dl><h4>今から整える守り</h4><ol class="events-defense-measures">${measures.map(item => `<li data-stable-key="${esc(item.id)}"><span class="events-defense-priority" data-priority="${item.priority}">${priorities[item.priority]}</span><div><h5>${esc(item.title)}</h5><p>${esc(item.detail)}</p></div></li>`).join('')}</ol><h4>戦場ごとの備え</h4><p class="events-defense-note">地形に合う攻撃戦術を想定した対策です。ほかの領主の編成や、実際に選ぶ戦術を示すものではありません。</p><div class="events-defense-stages">${advice.stages.map(stage => `<article data-stable-key="${esc(stage.stageId)}"><h5>${esc(stage.stageName)}</h5><p class="events-defense-tactic">想定する攻め方 · ${esc(stage.attackTacticName)}</p><strong>${esc(stage.defensePlan)}</strong><p>${esc(stage.reason)}</p></article>`).join('')}</div><p class="events-defense-note events-defense-explanation">催事用の模擬合戦です。防衛側の兵・城・指令は消費されません。軍議は助言です。施設強化や援軍の手配は、通常の画面で行ってください。</p></section>`;
  }
  function adviserMarkup(state) {
    if (state.admin || !eventBattleEligibility(state).canAttack) return '';
    const advice = selectedAdvice(state); if (!advice) return '';
    const applied = state.tactic === advice.tactic, locked = !state.signedIn || state.sending || Boolean(state.pending || state.confirmation) || state.detailLoading;
    const forecast = advice.exact && advice.options.find(option => option.tactic === state.tactic);
    const recommendation = forecast && !applied ? `（提案した${esc(advice.tacticName)}は${number(advice.winChance)}%）` : '';
    return `<section class="events-adviser" aria-label="軍師AIの提案"><div class="events-adviser-heading"><div><span class="events-eyebrow">軍師AI</span><h4>${esc(advice.tacticName)}を提案</h4></div><span class="events-state">${advice.exact ? '現在の軍団で比較' : '戦場の地形から提案'}</span></div><p>${esc(advice.reason)}</p>${forecast ? `<p class="events-note">選択中の戦術 · ${esc(forecast.tacticName)}${recommendation}</p><dl class="events-adviser-stats"><div><dt>勝利予測</dt><dd>${number(Math.round(forecast.winChance * 10) / 10)}<small>%</small></dd></div><div><dt>自軍戦力</dt><dd>${number(Math.round(forecast.playerPower))}</dd></div><div><dt>敵戦力</dt><dd>${number(Math.round(forecast.enemyPower))}</dd></div></dl>` : '<p class="events-note">軍団を確認すると、戦力に応じた提案と勝利予測を表示します。</p>'}<p class="events-note">保存済みの軍団で出陣 · 兵の損失なし。${advice.exact ? '出陣時の軍団や戦況で予測は変わります。' : ''}</p><div class="events-adviser-actions"><span>${applied ? '提案の戦術を選択中' : '戦術の選択に反映できます'}</span><button type="button" class="events-button is-small" data-events="advice"${locked || applied ? ' disabled' : ''}>提案を反映</button></div></section>`;
  }
  function outcomeMarkup(event, progress, admin = false) {
    const plan = event.plan, rewards = plan.battleRewards, ending = plan.ending, unification = progress?.unification;
    const ordinary = rewards ? `<section class="events-section"><div class="events-section-heading"><div><span class="events-eyebrow">EVERY BATTLE</span><h3>出陣ごとの報酬</h3></div><span class="events-note">確定した報酬を領国の資源へ反映</span></div><div class="events-battle-rewards">${plan.stages.map((stage, index) => `<article><h4>${esc(stage.name)}</h4><div><strong>勝利報酬</strong><div class="events-gift">${giftMarkup(rewards.victory[index]) || '<span>資源報酬なし</span>'}</div></div><div><strong>奮戦報酬</strong><div class="events-gift">${giftMarkup(rewards.defeat[index]) || '<span>資源報酬なし</span>'}</div></div></article>`).join('')}</div><p class="events-note">勝利・敗北に応じて毎回受け取れます。各資源の所持上限まで反映されます。戦功の褒賞は別途システム便へ届きます。</p></section>` : '';
    if (ending?.kind !== 'unification' || ending.reward !== 'shogunate_right') return ordinary;
    const achieved = unification?.eligible === true && unification.achieved === true, cleared = unification?.clearedStageIds || [];
    return ordinary + `<section class="events-section events-unification${achieved ? ' is-achieved' : ''}" aria-label="天下統一の達成条件"><span class="events-eyebrow">天下統一型の合戦</span><h3>${achieved ? '天下統一を達成 · 幕府開設権を獲得' : '天下統一を成し遂げ、幕府を開く'}</h3><p>3つの戦場すべてで1勝以上し、累計戦功${number(ending.requiredPoints)}点に到達すると、この催事で天下統一を達成します。</p><ul class="events-unification-steps">${ending.requiredStageIds.map(id => { const stage = plan.stages.find(item => item.id === id), done = cleared.includes(id); return `<li${done ? ' class="is-complete"' : ''}><span>${esc(stage?.name || id)}</span><strong>${done ? '勝利済み' : '1勝で達成'}</strong></li>`; }).join('')}<li${(progress?.points || 0) >= ending.requiredPoints ? ' class="is-complete"' : ''}><span>累計戦功</span><strong>${progress && !admin ? number(progress.points) + ' / ' : ''}${number(ending.requiredPoints)}点</strong></li></ul><p class="events-note">報酬は幕府を開く権利です。合戦名の選択だけでは付与されません。この催事の天下統一はイベント内の達成で、本領の城の所有は変わりません。</p>${achieved ? `<div class="events-unification-earned"><p>${unification.earnedAt ? date(unification.earnedAt) + ' JST に獲得。' : ''}獲得した功績を確認し、幕府を開設できます。</p><button type="button" class="events-button is-primary" data-events="shogunate">幕府の開設へ</button></div>` : ''}</section>`;
  }
  function personMarkup(player) {
    const markup=`<span class="player-evaluation-person">${global.SengokuAvatar?.markup?.({ id: player.playerId, name: player.name, avatarVersion: player.avatarVersion }, 'inline') || ''}<span class="player-evaluation-name" data-premium-player="${esc(player.playerId)}" data-premium-player-name="${esc(player.name)}">${global.SengokuPremiumRuntime?.nameMarkup?.(player.name, player.appearance) || esc(player.name)}</span>${global.SengokuEvaluationUI?.badge?.(player.evaluation) || ''}${global.SengokuPublicCourt?.slot?.(player.playerId) || ''}</span>`;
    return global.SengokuLordProfile?.linkedName?.(player.playerId,player.name,markup)||markup;
  }
  function listMarkup(state, now) {
    if (!state.events.length) return `<div class="events-empty"><span class="events-seal" aria-hidden="true">陣</span><h2>${state.loading && !state.loaded ? '催事・合戦を確認中' : state.admin ? '最初の設計案を作りましょう' : '現在、催事・合戦はありません'}</h2><p>${state.admin ? '選択した戦いと開催期間から、3つの戦場を編成します。' : '開催が決まると、ここに戦場と参加方法が届きます。'}</p></div>`;
    const group = (label, events) => events.length ? `<section class="events-list-group" data-stable-key="${esc(label)}"><h2>${label}</h2>${events.map(event => `<button type="button" class="events-event-card${event.id === state.selectedId ? ' is-selected' : ''}" data-events="select" data-event-id="${esc(event.id)}" data-stable-key="${esc(event.id)}" aria-pressed="${event.id === state.selectedId}"><span class="events-event-meta"><span class="events-state is-${esc(event.status)}">${statusName(event, now)}</span><span>${event.durationDays}日間</span></span><strong>${esc(event.name)}</strong><span class="events-card-theme">${esc(event.plan.theme.label)}</span><span class="events-card-date">${event.status === 'draft' ? '設計内容を確認' : date(event.endedAt || event.endsAt) + ' JST まで'}</span></button>`).join('')}</section>` : '';
    const live = state.events.filter(event => active(event, now));
    return (!state.admin && !live.length ? '<p class="events-note events-no-active">現在開催中の合戦はありません。過去の戦場と戦功を確認できます。</p>' : '') + group('開催中', live) + group('設計案', state.events.filter(event => event.status === 'draft')) + group('終了した合戦', state.events.filter(event => event.status !== 'draft' && !active(event, now)));
  }
  function opponentMarkup(opponent, { report = false } = {}) {
    if (!opponent) return '';
    return `<section class="events-defender"><h4>${report ? '出陣時の守備' : esc(opponent.castleName) + 'の守備'}</h4><p>${report ? esc(opponent.castleName) + ' · ' : ''}領主 ${esc(opponent.lordName)}</p><dl class="events-result-stats"><div><dt>守備兵</dt><dd>${number(opponent.defenseTroops)}人</dd></div><div><dt>守備戦力</dt><dd>${number(opponent.defensePower)}</dd></div></dl></section>`;
  }
  function defenderView(event) {
    const castle = !event.opponent && targetCastle(event.plan);
    const pending = Boolean(castle && event.opponent === undefined);
    const notice = pending ? `<p class="events-note">${esc(castle.name)}の守備戦力は出陣時に確認します。</p>`
      : castle ? `<p class="events-note">${esc(castle.name)}では各戦場の基本戦力を使います。</p>` : '';
    return { markup: opponentMarkup(event.opponent) || notice, label: pending && event.status === 'draft' ? '設計時の敵戦力' : '敵戦力',
      power: stage => event.opponent ? number(event.opponent.defensePower) : pending && event.status !== 'draft' ? '確認中' : number(stage.enemyPower),
      enemy: stage => event.opponent ? event.opponent.castleName + '守備隊' : stage.enemyName };
  }
  function detailMarkup(event, admin) {
    const plan = event.plan, defender = defenderView(event);
    return `<div class="events-hero"><div class="events-hero-top"><span class="events-eyebrow">${esc(plan.theme.label)}</span><span class="events-state" data-event-live-state></span></div><h2 tabindex="-1" data-event-heading>${esc(event.name)}</h2><p class="events-synopsis">${esc(plan.synopsis)}</p><div class="events-schedule"><span>${event.status === 'draft' ? '開催から' + event.durationDays + '日間・実時間' : date(event.startsAt) + ' 〜 ' + date(event.endsAt) + ' JST'}</span><strong data-event-countdown></strong></div></div><div data-event-progress></div><div data-event-defense-adviser></div><div data-event-participation></div><section class="events-section"><div class="events-section-heading"><div><span class="events-eyebrow">THREE BATTLEFIELDS</span><h3>${admin ? '編成された3つの戦場' : '戦場を選ぶ'}</h3></div><span class="events-note">保存済みの軍団で挑む専用合戦</span></div><div data-event-opponent>${defender.markup}</div><div class="events-stages"${admin ? '' : ' role="radiogroup" aria-label="出陣する戦場"'}>${plan.stages.map((stage, index) => `<${admin ? 'article' : 'button type="button" role="radio" aria-checked="false" data-events="stage" data-stage-id="' + esc(stage.id) + '"'} class="events-stage"><span class="events-stage-number">第${['一', '二', '三'][index]}陣</span><h4>${esc(stage.name)}</h4><span class="events-stage-enemy" data-event-stage-enemy="${esc(stage.id)}">${esc(defender.enemy(stage))}</span><p>${esc(stage.description)}</p><span class="events-stage-values"><span><span data-event-power-label="${esc(stage.id)}">${defender.label}</span> <b data-event-stage-power="${esc(stage.id)}">${defender.power(stage)}</b></span><span>基礎戦功 <b>${number(stage.basePoints)}</b></span></span><span class="events-stage-hint">${esc(stage.tacticHint)}</span></${admin ? 'article' : 'button'}>`).join('')}</div>${admin ? `<div class="events-tactics-preview"><h4>5つの戦術</h4><dl>${plan.tactics.map(tactic => `<div><dt>${esc(tactic.name)}</dt><dd>${esc(tactic.description)}</dd></div>`).join('')}</dl></div>` : `<form data-events-battle-form class="events-battle-controls"><div data-event-adviser></div><label for="events-tactic">戦術を選ぶ</label><select id="events-tactic" name="tactic">${plan.tactics.map(tactic => `<option value="${esc(tactic.id)}">${esc(tactic.name)}</option>`).join('')}</select><p class="events-note" data-event-tactic-description></p><div class="events-battle-actions"><p data-event-battle-access></p><button type="submit" class="events-button is-primary" data-events-battle-submit>指令1で出陣</button></div><p class="events-note">通常の城や兵は失いません。戦功と出陣回数は、この催事・合戦だけに記録されます。</p></form>`}</section><div data-event-battle-result></div><div data-event-outcome></div><section class="events-section"><div class="events-section-heading"><div><span class="events-eyebrow">BATTLE HONOURS</span><h3>戦功の褒賞</h3></div><button type="button" class="events-button is-small" data-events="mail">システム便へ</button></div><p class="events-note">目標に到達すると、報酬がシステム便に届きます。郵便からお受け取りください。</p><div data-event-rewards></div></section><section class="events-section events-rules"><h3>この合戦の決まり</h3><p>${esc(plan.theme.description)}</p><ul>${plan.rules.map(rule => `<li>${esc(rule)}</li>`).join('')}</ul><p class="events-note">指令の回復・上限は通常の行動と共通です。ゲーム内の時計を止めても開催期間は進みます。</p></section><div data-event-ranking></div><div class="events-admin-actions" data-event-admin-actions></div>`;
  }
  function progressMarkup(state) {
    const progress = state.progress;
    if (state.admin || state.event?.status === 'draft') return '';
    if (!state.signedIn) return `<div class="events-callout"><div><strong>${state.blocked ? '領主の利用状態を確認してください' : '領主として出陣する'}</strong><p>${state.blocked ? '利用状態を確認すると、参加できる操作が表示されます。' : '領主登録・ログイン後、保存済みの軍団で参加できます。'}</p></div><button type="button" class="events-button" data-events="profile">領主を確認</button></div>`;
    if (!progress) return '<p class="events-note">本人の戦功と指令を確認しています。</p>';
    const command = state.commands || cleanCommands(null);
    return `<dl class="events-progress"><div><dt>累計戦功</dt><dd>${number(progress.points)}<small>点</small></dd></div><div><dt>勝利 / 通算出陣</dt><dd>${number(progress.wins)}<small> / ${number(progress.battles)}戦</small></dd></div><div><dt>指令</dt><dd><span data-event-command-current>${command.ready ? number(command.current) : '—'}</span><small> / <span data-event-command-max>${command.ready ? number(command.max) : '—'}</span></small></dd></div></dl><p class="events-command-note">出陣に指令1 · 城下町などの行動と共通</p>`;
  }
  function rewardsMarkup(event, progress) {
    return `<ol class="events-rewards">${event.plan.milestones.map(item => { const sent = progress?.rewards.some(reward => reward.milestoneId === item.id), achieved = progress?.points >= item.points; return `<li${sent ? ' class="is-awarded"' : ''}><div class="events-reward-heading"><span class="events-reward-points">${number(item.points)}<small>点</small></span><div><h4>${esc(item.title)}</h4><span class="events-note">${sent ? 'システム便へ送付済み' : achieved ? '到達した戦功の報酬' : '戦功を重ねて達成'}</span></div></div><div class="events-gift">${giftMarkup(item.gift)}</div></li>`; }).join('')}</ol>`;
  }
  function battleMarkup(battle, mailIds = []) {
    if (!battle) return '';
    const rewards = battle.rewards ? `<div class="events-result-rewards"><h4>今回の合戦報酬</h4><div class="events-gift">${giftMarkup(battle.rewards) || '<span>所持上限のため今回の資源加算はありません</span>'}</div><p class="events-note">領国の資源に反映済みです。${battle.offeredRewards && Object.keys(RESOURCES).some(key => battle.offeredRewards[key] > battle.rewards[key]) ? '所持上限に達した資源は、受け取れる分だけ反映しています。' : ''}</p></div>` : '';
    return `<section class="events-result${battle.won ? ' is-won' : ''}" aria-labelledby="events-result-title"><div class="events-result-heading"><div><span class="events-eyebrow">確定した合戦の報せ</span><h3 id="events-result-title" tabindex="-1">${battle.won ? '勝利' : '奮戦'} · ${esc(battle.stageName)}</h3></div><strong>+${number(battle.points)}<small>戦功</small></strong></div><p>${esc(battle.summary)}</p>${opponentMarkup(battle.opponent, { report: true })}<dl class="events-result-stats"><div><dt>自軍戦力</dt><dd>${number(Math.round(battle.playerPower))}</dd></div><div><dt>敵戦力</dt><dd>${number(Math.round(battle.enemyPower))}</dd></div><div><dt>採用戦術</dt><dd>${esc(battle.tacticName)}</dd></div></dl>${rewards}<ol>${battle.log.map(line => `<li>${esc(line)}</li>`).join('')}</ol>${mailIds.length ? '<div class="events-result-mail"><p>戦功の褒賞がシステム便に届いています。</p><button type="button" class="events-button" data-events="mail">褒賞を受け取りに行く</button></div>' : ''}</section>`;
  }
  function leaderboardMarkup(rows, event) {
    if (event.status === 'draft') return '';
    return `<section class="events-section"><div class="events-section-heading"><div><span class="events-eyebrow">HONOUR RANKING</span><h3>戦功ランキング</h3></div><span class="events-note">${rows.length ? '上位' + rows.length + '名' : '戦功の記録'}</span></div>${rows.length ? `<ol class="events-ranking">${rows.map(player => `<li data-stable-key="${esc(player.playerId)}"><span class="events-rank-number">${number(player.rank)}</span><div class="events-rank-person">${personMarkup(player)}<small>${number(player.wins)}勝</small></div><strong>${number(player.points)}<small>点</small></strong></li>`).join('')}</ol>` : '<p class="events-empty-ranking">まだ戦功の記録はありません。最初の出陣をお待ちしています。</p>'}</section>`;
  }
  function confirmationMarkup(value) {
    const publish = value.kind === 'publish', discard = value.kind === 'discard', event = value.event;
    return `<span class="events-eyebrow">${publish ? '開催内容の最終確認' : discard ? '下書き破棄の確認' : '開催終了の確認'}</span><h2 tabindex="-1" data-events-confirm-title>${publish ? 'この内容で開催しますか？' : discard ? 'この下書きを破棄しますか？' : 'この合戦を終了しますか？'}</h2><h3>${esc(event.name)}</h3><p>${publish ? `確定した時刻から${event.durationDays}日間、全プレイヤーが参加できます。3つの戦場・出陣ごとに指令1・表示された戦功の褒賞で開催します。` : discard ? 'この未公開の設計案を一覧から取り除きます。もう一度使いたい場合は、戦いを一覧から選び、開催期間を指定して新しい案を作成してください。' : '新たな出陣の受付を終了します。これまでの戦功と、届け済みの褒賞は残ります。'}</p><div class="events-actions"><button type="button" class="events-button" data-events="back">戻って確認する</button><button type="button" class="events-button ${publish ? 'is-primary' : 'is-danger'}" data-events="confirm">${publish ? '開催を確定する' : discard ? 'この下書きを破棄する' : 'この合戦を終了する'}</button></div>`;
  }
  function createUI(options = {}) {
    const doc = options.document || global.document, later = options.setTimeout || global.setTimeout?.bind(global), cancel = options.clearTimeout || global.clearTimeout?.bind(global);
    let dialog, controller, returnFocus, disposed = false, polling = false, pollTimer = null, clockTimer = null, detailKey = '', confirmKey = '', listHTML = '', lastResult = '', lastMode = null, lastOpen = false;
    const $ = selector => dialog?.querySelector(selector), setHTML = (node, markup, settings = {}) => { if (!node) return; if (global.SengokuStableDOM) global.SengokuStableDOM.patch(node, markup, settings); else if (node.innerHTML !== markup) node.innerHTML = markup; };
    const updateText = (node, value) => { if (node && node.textContent !== value) node.textContent = value; };
    function navStatus(state) {
      const currentEvents = state.publicEvents.filter(event => active(event, controller?.serverTime() ?? Date.now()));
      for (const node of doc?.querySelectorAll?.('[data-events-status]') || []) { updateText(node, currentEvents.length ? '開催中' : ''); node.hidden = !currentEvents.length; }
    }
    function ticks(state = controller.getState()) {
      navStatus(state); if (!dialog?.open || !state.event) return;
      const event = state.event, time = controller.serverTime();
      updateText($('[data-event-live-state]'), statusName(event, time));
      updateText($('[data-event-countdown]'), event.status === 'draft' ? '未公開' : active(event, time) ? remaining(event.endsAt, time) : '出陣受付終了');
      if (!state.admin) updateControls(state);
    }
    function updateControls(state) {
      const locked = state.sending || Boolean(state.pending || state.confirmation), event = state.event, access = eventBattleEligibility(state);
      for (const node of dialog?.querySelectorAll?.('[data-events="stage"]') || []) { const selected = node.getAttribute('data-stage-id') === state.stageId; node.setAttribute('aria-checked', String(selected)); node.tabIndex = selected ? 0 : -1; node.classList.toggle('is-selected', selected); node.disabled = locked; }
      const tactic = $('#events-tactic'); if (tactic) { if (tactic.value !== state.tactic) tactic.value = state.tactic; tactic.disabled = locked || !access.canAttack; }
      const form = $('[data-events-battle-form]'); if (form) form.hidden = access.reason === 'own_castle';
      const choice = event?.plan.tactics.find(item => item.id === state.tactic); updateText($('[data-event-tactic-description]'), choice?.description || '');
      const command = state.commands || cleanCommands(null);
      updateText($('[data-event-command-current]'), command.ready ? number(command.current) : '—');
      updateText($('[data-event-command-max]'), command.ready ? number(command.max) : '—');
      const canBattle = Boolean(!state.admin && state.signedIn && access.canAttack && !locked && !state.detailLoading && active(event, controller.serverTime()) && state.progress && command.ready && command.writable && command.current >= command.cost);
      const submit = $('[data-events-battle-submit]'); if (submit) { submit.disabled = !canBattle; updateText(submit, state.sending && state.pending?.kind === 'battle' ? '合戦の結果を確認中…' : access.reason === 'own_castle' ? '防衛専用' : '指令1で出陣'); }
      const message = !state.signedIn ? '領主の接続を確認すると出陣できます。' : access.reason === 'own_castle' ? '自分が領主の拠点には出陣できません。' : !active(event, controller.serverTime()) ? 'この合戦の出陣受付は終了しました。' : !state.progress || !command.ready ? command.message || '指令と保存状態を確認しています。' : !access.canAttack ? '領主と拠点の最新情報を更新してから出陣してください。' : !command.writable ? command.message || 'この端末の操作権を確認すると出陣できます。' : command.current < command.cost ? '指令不足です。指令が1以上になると出陣できます。' : '出陣に指令1を消費します。指令は通常の行動と共通です。';
      updateText($('[data-event-battle-access]'), message);
      setHTML($('[data-event-adviser]'), adviserMarkup(state));
    }
    function closeDialog() {
      if (dialog?.open) dialog.close();
      if (returnFocus?.isConnected) returnFocus.focus?.({ preventScroll: true }); returnFocus = null; lastOpen = false;
    }
    function clearDetail() { detailKey = lastResult = ''; setHTML($('[data-events-detail]'), ''); }
    function render(state) {
      navStatus(state); options.onChange?.(state);
      if (!dialog) return;
      if (!state.open || state.admin && !state.authorized) { closeDialog(); if (['identity', 'dispose'].includes(state.change)) { clearDetail(); setHTML($('[data-events-list]'), ''); setHTML($('[data-events-confirm]'), ''); setHTML($('[data-events-pending]'), ''); updateText($('[data-events-feedback]'), ''); if ($('#events-battle')) $('#events-battle').value = ''; if ($('#events-search')) $('#events-search').value = ''; if ($('#events-category')) $('#events-category').value = ''; if ($('#events-days')) $('#events-days').value = '3'; listHTML = confirmKey = ''; } return; }
      if (!dialog.open) { dialog.showModal(); global.SengokuSocialViewport?.refresh?.(); }
      const main = $('[data-events-main]'), scrollTop = main.scrollTop;
      if (lastMode !== state.admin) { lastMode = state.admin; detailKey = listHTML = confirmKey = ''; clearDetail(); }
      dialog.classList.toggle('is-admin', state.admin);
      updateText($('#events-title'), state.admin ? '催事・合戦の開催' : '催事・合戦');
      updateText($('[data-events-header-label]'), state.admin ? '開催の準備' : '期間限定の戦場');
      $('[data-events-generator]').hidden = !state.admin;
      const locked = state.sending || Boolean(state.pending || state.confirmation);
      for (const control of $('[data-events-generate-form]').querySelectorAll('input,select,button')) control.disabled = locked;
      const search = $('#events-search'); if (search.value !== state.catalogQuery && doc.activeElement !== search) search.value = state.catalogQuery;
      const category = $('#events-category'), categories = [...new Set(state.catalog.map(item => item.category))];
      setHTML(category, '<option value="">すべての分類</option>' + categories.map(id => `<option value="${esc(id)}">${esc(CATEGORIES[id] || id)}</option>`).join(''));
      if (category.value !== state.catalogCategory) category.value = state.catalogCategory;
      const battleSelect = $('#events-battle'); setHTML(battleSelect, catalogOptionsMarkup(state)); if (battleSelect.value !== state.battleId) battleSelect.value = state.battleId;
      setHTML($('[data-events-selection]'), catalogSelectionMarkup(state));
      const days = $('#events-days'); if (days.value !== String(state.durationDays)) days.value = String(state.durationDays);
      updateText($('[data-events-catalog-count]'), state.catalogLoading ? '戦いの一覧を確認しています…' : `${number(filteredCatalog(state).length)}件 / 全${number(state.catalog.length)}件`);
      updateText($('[data-events-catalog-message]'), state.catalogMessage); $('[data-events-catalog-message]').hidden = !state.catalogMessage;
      updateText($('[data-events-generate-submit]'), state.sending && state.pending?.kind === 'generate' ? '戦場を編成しています…' : 'AIで設計案を作る');
      $('[data-events-generate-submit]').disabled = locked || !state.catalog.some(item => item.id === state.battleId);
      $('[data-events="refresh"]').disabled = state.loading || state.sending || Boolean(state.confirmation);
      const feedback = $('[data-events-feedback]'); feedback.hidden = !(state.error || state.message); feedback.setAttribute('role', state.error ? 'alert' : 'status'); feedback.setAttribute('data-error', String(Boolean(state.error))); updateText(feedback, state.error || state.message);
      const pending = $('[data-events-pending]'); pending.hidden = !state.pending;
      if (state.pending) { const label = { battle: '出陣', generate: '設計', publish: '開催', end: '終了', discard: '破棄' }[state.pending.kind]; setHTML(pending, `<strong>${state.sending ? label + 'の結果を確認しています' : label + 'の結果を再確認できます'}</strong><p>${state.sending ? '結果が届くまでお待ちください。閉じても同じ操作の確認を続けられます。' : '通信が途切れた場合も、同じ操作番号で結果を確認します。指令や報酬を重ねて処理しません。'}</p><button type="button" class="events-button" data-events="retry"${state.sending ? ' disabled' : ''}>同じ${label}の結果を確認</button>`); }
      const confirmHost = $('[data-events-confirm]'), key = state.confirmation ? state.confirmation.data.requestId : '';
      confirmHost.hidden = !state.confirmation;
      if (key !== confirmKey) { confirmKey = key; setHTML(confirmHost, state.confirmation ? confirmationMarkup(state.confirmation) : ''); if (state.confirmation) { confirmHost.querySelector('[data-events-confirm-title]')?.focus?.({ preventScroll: true }); main.scrollTop = 0; } }
      $('[data-events-workspace]').hidden = Boolean(state.confirmation);
      const markup = listMarkup(state, controller.serverTime()); if (markup !== listHTML) { listHTML = markup; setHTML($('[data-events-list]'), markup, { key: [state.playerId, state.admin] }); }
      for (const node of dialog.querySelectorAll('[data-events="select"]')) node.disabled = state.sending || Boolean(state.confirmation);
      const detail = $('[data-events-detail]'); detail.hidden = !state.event;
      if (!state.event) clearDetail();
      if (state.event) {
        const { opponent, ...planDetails } = state.event;
        const key = JSON.stringify([state.admin, planDetails]);
        if (detailKey !== key) { detailKey = key; setHTML(detail, detailMarkup(state.event, state.admin), { key: [state.playerId, state.admin, state.event.id], preserveSelectors: ['[data-event-opponent]', '[data-event-progress]', '[data-event-defense-adviser]', '[data-event-participation]', '[data-event-outcome]', '[data-event-rewards]', '[data-event-ranking]', '[data-event-battle-result]', '[data-event-adviser]', '[data-event-admin-actions]'] }); lastResult = ''; }
        {
          const defender = defenderView(state.event);
          setHTML($('[data-event-opponent]'), defender.markup);
          for (const stage of state.event.plan.stages) {
            updateText($('[data-event-power-label="' + stage.id + '"]'), defender.label);
            updateText($('[data-event-stage-power="' + stage.id + '"]'), defender.power(stage));
            updateText($('[data-event-stage-enemy="' + stage.id + '"]'), defender.enemy(stage));
          }
        }
        setHTML($('[data-event-progress]'), progressMarkup(state));
        setHTML($('[data-event-defense-adviser]'), defenseAdviserMarkup(state));
        setHTML($('[data-event-participation]'), participationMarkup(state));
        setHTML($('[data-event-outcome]'), outcomeMarkup(state.event, state.progress, state.admin));
        setHTML($('[data-event-rewards]'), rewardsMarkup(state.event, state.progress));
        setHTML($('[data-event-ranking]'), leaderboardMarkup(state.leaderboard, state.event));
        const resultKey = JSON.stringify([state.battle, state.rewardMailIds]);
        if (lastResult !== resultKey) { lastResult = resultKey; setHTML($('[data-event-battle-result]'), battleMarkup(state.battle, state.rewardMailIds)); if (state.change === 'result' && state.battle) $('#events-result-title')?.focus?.({ preventScroll: true }); }
        setHTML($('[data-event-admin-actions]'), !state.admin ? '' : state.event.status === 'draft' ? `<div><p class="events-note">公開前に、3つの戦場・開催期間・褒賞を確認してください。</p><button type="button" class="events-button is-small is-danger" data-events="discard"${locked ? ' disabled' : ''}>この下書きを破棄</button></div><button type="button" class="events-button is-primary" data-events="publish"${locked ? ' disabled' : ''}>この内容で開催</button>` : active(state.event, controller.serverTime()) ? `<p class="events-note">開催中の内容は固定です。必要な場合は出陣受付を終了できます。</p><button type="button" class="events-button is-danger" data-events="end"${locked ? ' disabled' : ''}>開催を終了する</button>` : '<p class="events-note">この合戦は終了しています。新しい設計案から次の合戦を準備できます。</p>');
        ticks(state);
      }
      if (state.change === 'select') { detail.querySelector('[data-event-heading]')?.focus?.({ preventScroll: true }); if (global.matchMedia?.('(max-width:760px)').matches) detail.scrollIntoView?.({ block: 'start', behavior: 'auto' }); }
      else if (!global.SengokuStableDOM && !state.confirmation && state.change !== 'open') main.scrollTop = scrollTop;
      if (!lastOpen) { lastOpen = true; $('#events-title')?.focus?.({ preventScroll: true }); }
    }
    function routeSocial(tab) { controller.close(); (options.openSocial || (tab => global.SengokuSocial?.open?.(tab)))(tab); }
    function ensureDialog() {
      if (dialog || !doc?.body) return;
      dialog = doc.createElement('dialog'); dialog.className = 'events-dialog'; dialog.id = 'events-dialog'; dialog.setAttribute('aria-labelledby', 'events-title');
      dialog.innerHTML = `<header class="events-header"><div><span class="events-eyebrow" data-events-header-label>期間限定の戦場</span><h1 id="events-title" tabindex="-1">催事・合戦</h1></div><button type="button" class="events-button is-small" data-events="refresh" aria-label="催事・合戦を更新">更新</button><button type="button" class="events-close" data-events="close" aria-label="催事・合戦を閉じる">×</button></header><div class="events-main" data-events-main><div class="events-feedback" data-events-feedback role="status" hidden></div><section class="events-pending" data-events-pending hidden></section><section class="events-confirm" data-events-confirm hidden></section><div data-events-workspace><section class="events-generator" data-events-generator hidden><div><span class="events-eyebrow">GAME AI · 合戦の編成</span><h2>次の戦いを選ぶ</h2><p>歴史上の合戦・全国の城攻め・野良兵の戦いから選択すると、軍師AIが3つの戦場と褒賞を編成します。天下統一型では、達成条件を満たした領主に幕府開設権を授けます。</p><div class="events-catalog-selection" data-events-selection></div></div><form data-events-generate-form><div class="events-catalog-filters"><div><label for="events-search">戦いを検索</label><input type="search" id="events-search" maxlength="120" autocomplete="off" placeholder="例：関ヶ原、江戸城" aria-controls="events-battle"></div><div><label for="events-category">分類</label><select id="events-category"><option value="">すべての分類</option></select></div></div><label for="events-battle">戦いの一覧</label><select id="events-battle" name="battleId" required aria-describedby="events-catalog-count"><option value="">戦いを選択してください</option></select><span id="events-catalog-count" class="events-note" data-events-catalog-count></span><p class="events-note" data-events-catalog-message hidden></p><label for="events-days">開催期間</label><select id="events-days" name="durationDays">${Array.from({ length: 7 }, (_, index) => `<option value="${index + 1}">${index + 1}日間</option>`).join('')}</select><button type="submit" class="events-button is-primary" data-events-generate-submit>AIで設計案を作る</button><p class="events-note">設計案は未公開です。戦場・報酬・達成条件を確認してから開催します。</p></form></section><div class="events-layout"><nav class="events-list" aria-label="催事・合戦の一覧" data-events-list></nav><article class="events-detail" data-events-detail hidden></article></div></div></div><footer class="events-footer">開催時刻は日本時間（JST）で表示 · 通常の城や兵を失わない専用合戦</footer>`;
      dialog.addEventListener('click', event => {
        const button = event.target?.closest?.('[data-events]'); if (!button || button.disabled || !dialog.contains(button)) return;
        event.preventDefault(); const action = button.getAttribute('data-events');
        if (action === 'close') controller.close();
        else if (action === 'refresh') { controller.refresh(); if (controller.getState().admin) controller.refreshCatalog(); }
        else if (action === 'select') controller.select(button.getAttribute('data-event-id'));
        else if (action === 'stage') controller.chooseStage(button.getAttribute('data-stage-id'));
        else if (action === 'advice') { if (controller.applyAdvice()) $('#events-tactic')?.focus?.({ preventScroll: true }); }
        else if (action === 'shogunate') { controller.close(); (options.openShogunate || (() => global.SengokuShogunate?.open?.()))(); }
        else if (action === 'publish' || action === 'end' || action === 'discard') controller.prepare(action);
        else if (action === 'back') controller.back();
        else if (action === 'confirm') controller.confirm();
        else if (action === 'retry') controller.retry();
        else if (action === 'profile' || action === 'mail') routeSocial(action);
      });
      dialog.addEventListener('input', event => { if (event.target.id === 'events-search') controller.filterCatalog(event.target.value, $('#events-category').value); });
      dialog.addEventListener('change', event => { if (event.target.id === 'events-days' || event.target.id === 'events-battle') controller.setDraft($('#events-battle').value, $('#events-days').value); else if (event.target.id === 'events-category') controller.filterCatalog($('#events-search').value, event.target.value); else if (event.target.id === 'events-tactic') controller.chooseTactic(event.target.value); });
      dialog.addEventListener('submit', event => { if (event.target.hasAttribute('data-events-generate-form')) { event.preventDefault(); controller.setDraft($('#events-battle').value, Number($('#events-days').value)); controller.generate(); } else if (event.target.hasAttribute('data-events-battle-form')) { event.preventDefault(); controller.battle(); } });
      dialog.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); controller.close(); return; }
        if (event.target.matches?.('[data-events="stage"]') && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) {
          const buttons = [...dialog.querySelectorAll('[data-events="stage"]')], position = buttons.indexOf(event.target), next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (position + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length;
          if (!buttons[next]?.disabled) { event.preventDefault(); controller.chooseStage(buttons[next].getAttribute('data-stage-id')); buttons[next].focus(); }
        }
      });
      dialog.addEventListener('cancel', event => { event.preventDefault(); event.stopPropagation(); controller.close(); });
      dialog.addEventListener('close', () => { if (!dialog.open && controller.getState().open) controller.close(); }); doc.body.append(dialog);
    }
    controller = createController({ ...options, onChange: render });
    async function open(settings = {}) { if (disposed || settings.admin && !controller.getState().authorized) { global.SengokuBridge?.toast?.('この操作を利用する権限がありません。', true); return false; } ensureDialog(); if (!dialog) return false; if (!dialog.open) returnFocus = doc.activeElement; return controller.open(settings); }
    const launcher = event => { const node = event.target?.closest?.('[data-events-open],[data-events-admin]'); if (!node || node.disabled) return; event.preventDefault(); open({ admin: node.hasAttribute('data-events-admin') }); };
    async function poll() {
      if (disposed || polling) return; polling = true;
      try { if (!doc?.hidden) { await controller.refreshSummary(); const state = controller.getState(); if (state.open && !state.admin && !state.sending && !state.confirmation && !state.pending) await controller.refresh({ quiet: true }); } } finally { polling = false; if (!disposed && later) pollTimer = later(poll, 45000); }
    }
    function tick() { if (disposed) return; if (!doc?.hidden) ticks(); if (later) clockTimer = later(tick, 1000); }
    function visibility() { if (!doc.hidden) { controller.refreshAccess(); if (pollTimer) cancel?.(pollTimer); pollTimer = null; poll(); } }
    if (options.autoPoll !== false && doc) { doc.addEventListener('click', launcher); doc.addEventListener('visibilitychange', visibility); poll(); tick(); }
    return { open, close: () => controller.close(), refreshAccess: () => controller.refreshAccess(), refresh: () => controller.refresh(), getState: () => controller.getState(), controller, dispose() { if (disposed) return; controller.dispose(); disposed = true; cancel?.(pollTimer); cancel?.(clockTimer); doc?.removeEventListener?.('click', launcher); doc?.removeEventListener?.('visibilitychange', visibility); dialog?.remove(); dialog = null; } };
  }
  let instance;
  const get = () => instance || (instance = createUI());
  global.SengokuEvents = { open: settings => get().open(settings), close: () => instance?.close(), refreshAccess: () => instance?.refreshAccess(), dispose: () => { instance?.dispose(); instance = null; } };
  if (typeof module !== 'undefined' && module.exports) module.exports = { createController, createUI, cleanPlan, cleanEvent, cleanProgress, cleanLeaderboard, cleanCatalog, selectedAdvice, adviserMarkup, defenseAdviserMarkup, outcomeMarkup, catalogOptionsMarkup, catalogSelectionMarkup, listMarkup, detailMarkup, progressMarkup, battleMarkup, leaderboardMarkup, confirmationMarkup, remaining, statusName };
  if (global.document) { if (global.document.readyState === 'loading') global.document.addEventListener('DOMContentLoaded', get, { once: true }); else get(); }
})(typeof window !== 'undefined' ? window : globalThis);
