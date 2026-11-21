/* 戦国VS — read-only advice from the current engine snapshot.
 * No clocks, randomness, storage or game actions are used here. A hint opens a
 * review screen; the existing screen remains responsible for any actual action.
 */
(function (root) {
  'use strict';
  const KEYS = ['gold', 'rice', 'wood', 'stone', 'magatama'];
  const NAMES = {gold:'金銭',rice:'兵糧',wood:'木材',stone:'石材',magatama:'勾玉'};
  const number = value => Math.max(0, Number.isFinite(Number(value)) ? Number(value) : 0);
  const fmt = value => Math.round(value).toLocaleString('ja-JP');
  const compareId = (a,b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const view = (name,label) => ({kind:'view',view:name,label});
  const costMap = value => Object.fromEntries(KEYS.filter(key => number(value?.[key]) > 0).map(key => [key,number(value[key])]));

  function single(status,id,title,reason,action,tone='muted') {
    return {status,title,summary:reason,items:[{id,priority:1000,tone,category:'system',title,reason,action}]};
  }

  /**
   * build(game, context) -> {status,title,summary,items}
   * Explicit false readiness flags suspend advice. Omitted flags allow local
   * engine use. cost/missing contain resource amounts only; waitSeconds is
   * GAME time, not wall time, and is omitted while progression is paused.
   */
  function build(game, context={}) {
    const s = game?.state;
    if (context.banned || context.syncReason === 'ACCOUNT_BANNED') {
      return single('blocked','account-banned','アカウントの状態を確認してください',context.syncMessage || '利用停止中です。連携画面で状態を確認してください。',{kind:'sync',label:'連携状態を確認'},'urgent');
    }
    if (context.rolePending) {
      return single('blocked','role-pending','利用権限を確認しています','権限の確認が終わると、現在の領国に合うヒントを表示します。',{kind:'sync',label:'連携状態を確認'});
    }
    if (context.started === false || !s) {
      return single('not-started','start','最初の領国を選びましょう','勢力と本拠を選んで始めると、資源や軍団の状況に合う次の一手を案内します。',{kind:'new',label:'物語の開始画面へ'},'advice');
    }
    if (context.syncReady === false) {
      return single('blocked','sync-pending','保存データを確認しています',context.syncMessage || '連携先の保存を確認してから、次の行動を案内します。',{kind:'sync',label:'連携状態を確認'});
    }
    if (game.isStaff && (context.staffReady === false || !game.getStaffBase?.())) {
      return single('blocked','staff-pending','京都御所の共同拠点を確認しています','共同普請と施設レベルの確認が終わるまでお待ちください。',{kind:'sync',label:'連携状態を確認'});
    }
    if (context.saveEnabled === false) {
      return single('blocked','save-pending','保存状態を確認してください','保存が有効になってから、領国の状況に合うヒントを表示します。',{kind:'settings',label:'設定を確認'});
    }
    if (s.gameOver) {
      return single('game-over','game-over','新しい物語の準備をしましょう','最後の城を失っています。これまでの記録を確認し、開始画面で次の勢力と本拠を選べます。',{kind:'new',label:'新しい物語の開始画面へ'},'advice');
    }
    if (context.clockReady === false) {
      return single('blocked','clock-pending','次の一手','城下町の施設、軍団の編成、任務の報酬を確認できます。',view('town','城下町を見る'));
    }
    if (context.writable === false) {
      return single('blocked','read-only','操作を再開する準備を確認',context.syncMessage || '操作の同期が終わるまでお待ちください。連携画面でこの端末の状態を確認できます。',{kind:'sync',label:'連携・操作状況を確認'});
    }

    const data = game.data, items = new Map();
    const resources = s.resources, income = game.income(), owned = game.ownedCastles();
    const jobs = game.constructionJobs(), shared = Boolean(game.isStaff);
    const scopedJobs = jobs.filter(job => Boolean(job.shared) === shared);
    const chains = new Set(scopedJobs.filter(job => job.kind !== 'research').map(job => job.kind+':'+job.id));
    const slots = game.constructionSlots(), hasCommand = s.command >= 1;
    const running = s.realtime.running !== false;
    const commandSeconds = data.secondsPerCommand || 20;
    const paused = '時間の進行が止まっているため、再開後に進みます。';
    const balance = key => number(key === 'magatama' ? s.magatama : resources[key]);
    const missing = cost => Object.fromEntries(KEYS.filter(key => number(cost?.[key]) > balance(key)).map(key => [key,Math.ceil(cost[key]-balance(key))]));
    const canPay = cost => Object.keys(missing(cost)).length === 0;
    const shortageText = cost => Object.entries(missing(cost)).map(([key,value]) => NAMES[key]+' '+fmt(value)).join('・');
    const add = item => {
      const previous = items.get(item.id);
      if (!previous || previous.priority < item.priority) items.set(item.id,item);
    };
    const wait = seconds => running ? {waitSeconds:Math.max(0,Math.ceil(seconds))} : {};
    const withCost = cost => {
      const absent = missing(cost);
      return {cost:costMap(cost),...(Object.keys(absent).length ? {missing:absent} : {})};
    };
    const buildingFacts = id => {
      const b = data.buildings.find(row => row.id === id);
      if (!b || !game.buildingUnlock(id).ok) return null;
      const chain = scopedJobs.filter(job => job.kind === 'building' && job.id === id);
      const level = Math.max(number(s.buildings[id]),...chain.map(job => number(job.targetLevel)));
      if (level >= game.buildingMax() || (!chain.length && chains.size >= slots)) return null;
      const cost = game.costs(id,level);
      return cost ? {b,chain,level,cost,affordable:canPay(cost)} : null;
    };
    const production = category => data.buildings.filter(b => b.category === category).map(b => buildingFacts(b.id)).filter(Boolean).sort((a,b) => {
      const efficiency = entry => entry.b.effect*game.governorBonusFor(entry.b.id,s.governors[entry.b.id]) / Math.max(1,entry.cost.gold+entry.cost.wood+entry.cost.stone);
      return Number(b.affordable)-Number(a.affordable) || Number(Boolean(a.chain.length))-Number(Boolean(b.chain.length)) || efficiency(b)-efficiency(a) || compareId(a.b,b.b);
    })[0];
    const recommendBuilding = (facts,priority,reason) => {
      if (!facts || !hasCommand) return;
      const {b,chain,level,cost,affordable} = facts;
      const operation = chain.length ? '連続増築' : level ? '増築' : '建設';
      add({id:'building:'+b.id,priority:priority-(affordable?0:15),tone:'advice',category:'construction',
        title:affordable ? `${b.name}をLv.${level+1}へ${operation}` : `${b.name}の${operation}に備える`,
        reason:reason+(affordable?'':` 不足は${shortageText(cost)}です。`),
        detail:`指令1回・工期${fmt(cost.seconds)}秒（ゲーム内）。${chain.length?'予約済みの普請に続いて着工します。':''}${shared?'スタッフの共同普請です。':''}`,
        action:{kind:'building',id:b.id,label:b.name+'を確認'},...withCost(cost)});
    };

    // Reserve two months of current upkeep. This is an advice policy, not a new
    // engine restriction; the review screen still offers the full game rules.
    const reserveRice = Math.max(500,income.upkeep*2);
    const ricePressure = income.rice < 0 || resources.rice < reserveRice;
    const riceAdvice = (reason,priority=100) => {
      const farm = production('rice');
      add({id:'rice-balance',priority,tone:income.rice<0?'urgent':'advice',category:'supplies',
        title:income.rice<0?'兵糧の赤字を立て直す':'兵を増やす前に、兵糧を備える',reason,
        detail:`月の生産 ${fmt(income.grossRice)}・維持費 ${fmt(income.upkeep)}。${farm?`${farm.b.name}や奉行の配置で生産を伸ばせます。`:'城下町の生産施設と奉行の配置を確認しましょう。'}`,
        action:farm?{kind:'building',id:farm.b.id,label:farm.b.name+'を確認'}:view('army','兵糧収支を確認'),
        ...(farm?withCost(farm.cost):{})});
    };
    if (ricePressure) {
      riceAdvice(income.rice < 0 ? `兵糧が毎月${fmt(-income.rice)}減っています。現在の備蓄は${fmt(resources.rice)}です。` : `兵糧${fmt(resources.rice)}は、備えの目安${fmt(reserveRice)}（維持費2か月分、最低500）を下回っています。`);
    }

    const rewards = data.quests.filter(q => {const status=game.questStatus(q.id);return status.complete&&!status.claimed;});
    if (rewards.length) {
      add({id:'quest-rewards',priority:96,tone:'success',category:'quest',title:'達成した任務の報酬を確認',
        reason:`「${rewards[0].name}」${rewards.length>1?`など${rewards.length}件`:''}の報酬が未受取です。`,
        detail:'軍議で内容を確認して受け取れます。指令は使いません。',action:view('council','任務の報酬を見る')});
    }
    if (!hasCommand) {
      const remaining = Math.max(0,commandSeconds-number(s.realtime.commandProgress));
      add({id:'command-wait',priority:94,tone:'muted',category:'command',title:'指令の回復を待つ',
        reason:`指令は${fmt(s.command)} / ${fmt(game.commandMax())}回です。${running?`次の1回はゲーム内で約${fmt(remaining)}秒後に回復します。`:paused}`,
        detail:'待っている間も、軍団編成・奉行の任命・達成済み任務の確認ができます。',action:view('town','城下町を確認'),...wait(remaining)});
    }

    const army = s.army.filter(id => game.officer(id)), available = s.officers.filter(id => !s.army.includes(id));
    if (army.length < 3 && available.length) {
      add({id:'army-slots',priority:army.length?85:92,tone:'advice',category:'army',title:'軍団の空き枠に武将を選ぶ',
        reason:`軍団は${army.length} / 3名です。家臣から将を選ぶと軍団の能力が変わります。`,
        detail:'編成には指令を使いません。奉行の武将を編成すると、その奉行の任命は外れます。',
        action:{kind:'army-slot',id:String(army.length),view:'army',label:'空き枠の武将を選ぶ'}});
    }
    const governors = game.planGovernorAssignments();
    if (governors.ok && governors.changed && governors.totalBonus > governors.previousTotalBonus+1e-8) {
      add({id:'governors',priority:86,tone:'advice',category:'governors',title:'奉行の配置で施設を育てる',
        reason:`軍団に入っていない家臣${governors.candidateCount}名を使い、現在より施設の働きを高められる配置があります。`,
        detail:'建設済みの施設へ、能力に合う奉行を任命できます。配置には資源も指令も使いません。',action:view('facilities','奉行の配置を見る')});
    }

    const construction = jobs.filter(job => job.kind !== 'research');
    if (construction.length) {
      const first = [...construction].sort((a,b) => a.finishesInSeconds-b.finishesInSeconds || compareId(a,b))[0];
      const name = first.kind === 'castle' ? game.castle(first.id)?.name : data.buildings.find(b => b.id === first.id)?.name;
      add({id:'construction-wait',priority:chains.size>=slots?82:53,tone:'muted',category:'construction',title:'進行中の普請を確認',
        reason:`${name||'普請'}のLv.${first.targetLevel}が完成するまで${running?`、ゲーム内で約${fmt(first.finishesInSeconds)}秒です。`:'待機中です。'+paused}`,
        detail:`${shared?'共同':''}普請枠は${chains.size} / ${slots}件です。同じ施設の連続予約は1枠として数えます。`,
        action:view('town','普請の進み具合を見る'),...wait(first.finishesInSeconds)});
    }
    // A completion exactly on a month boundary is logged before the engine
    // increments turn. Include the preceding month so that it remains visible.
    const completed = s.log.filter(entry => entry.kind === 'complete' && entry.turn >= s.turn-1 && entry.turn <= s.turn);
    if (completed.length) {
      add({id:'recent-completion',priority:64,tone:'success',category:'construction',title:'最近完成した普請・研究を確認',
        reason:completed[0].text,detail:completed.length>1?`直前の月以降に${completed.length}件の完成が記録されています。`:'完成した効果は現在の施設や技術へ反映されています。',
        action:view('council','完成の記録を見る')});
    }

    if (hasCommand) {
      if (!ricePressure) {
        const economic = ['gold','wood','stone'].map(key => ({id:key,months:resources[key]/Math.max(1,income[key])})).sort((a,b) => a.months-b.months || compareId(a,b))[0];
        if (economic && economic.months < 12) {
          recommendBuilding(production(economic.id),75,`${NAMES[economic.id]}の備蓄は${fmt(resources[economic.id])}、月の収入は${fmt(income[economic.id])}です。生産を伸ばすと、次の普請や研究を準備しやすくなります。`);
        }
      }
      const home = game.castle(s.home);
      if (home && home.owner === s.clan && game.canOwnCastle(home.id) && home.level < game.castleLevelLimit(home.id) && chains.size < slots && !scopedJobs.some(job => job.kind === 'castle' && job.id === home.id)) {
        const cost = game.castleUpgradeCost(home.id), affordable = canPay(cost);
        const before = game.castleBenefits(home.id,home.level), after = game.castleBenefits(home.id,home.level+1);
        add({id:'castle:'+home.id,priority:affordable?67:47,tone:'advice',category:'construction',
          title:affordable?`${home.name}の城郭をLv.${home.level+1}へ`:`${home.name}の城郭拡張に備える`,
          reason:`城郭を上げると月の金銭が${fmt(after.gold-before.gold)}、兵糧が${fmt(after.rice-before.rice)}増え、防衛補正も高まります。${affordable?'':` 不足は${shortageText(cost)}です。`}`,
          detail:`現在Lv.${home.level} / ${game.castleLevelLimit(home.id)}。指令1回・工期${fmt(cost.seconds)}秒（ゲーム内）。${shared?'スタッフの共同普請です。':''}`,
          action:{kind:'castle',id:home.id,label:'城郭の強化を確認'},...withCost(cost)});
      }
      const keep = buildingFacts('keep');
      if (keep) {
        const unlocked = data.buildings.filter(b => b.requiredKeep === keep.level+1).length;
        if (unlocked || (keep.level+1)%8 === 0) {
          recommendBuilding(keep,58,unlocked?`天守Lv.${keep.level+1}で、新たに${unlocked}種類の施設を建てられます。`:`天守Lv.${keep.level+1}で、指令の上限と同時普請枠が1つ増えます。`);
        }
      }
    }

    const research = jobs.find(job => job.kind === 'research' && !job.shared);
    if (research) {
      const tech = data.techs.find(t => t.id === research.id);
      add({id:'research-wait',priority:54,tone:'muted',category:'research',title:'研究の完成を待つ',
        reason:`${tech?.name||'技術'} Lv.${research.targetLevel}を研究中です。研究は同時に1件です。`,
        detail:running?`ゲーム内で約${fmt(research.finishesInSeconds)}秒後に完成します。`:paused,
        action:view('research','研究の進み具合を見る'),...wait(research.finishesInSeconds)});
    } else if (hasCommand) {
      const unfinished = data.techs.filter(t => s.tech[t.id] < t.max);
      const eligible = unfinished.filter(t => s.tech[t.id] < s.buildings.academy).map(t => ({...t,cost:game.researchCost(t.id)}));
      eligible.sort((a,b) => (ricePressure?Number(b.id==='cultivation')-Number(a.id==='cultivation'):0) || Number(canPay(b.cost))-Number(canPay(a.cost)) || s.tech[a.id]-s.tech[b.id] || compareId(a,b));
      const next = eligible[0];
      if (next) {
        const affordable = canPay(next.cost);
        add({id:'research:'+next.id,priority:(ricePressure&&next.id==='cultivation'?88:68)-(affordable?0:22),tone:'advice',category:'research',
          title:affordable?`${next.name}をLv.${s.tech[next.id]+1}へ研究`:`${next.name}の研究に備える`,
          reason:next.description+(affordable?'':` 不足は${shortageText(next.cost)}です。`),
          detail:`学問所Lv.${s.buildings.academy}の範囲で研究できます。指令1回・工期${fmt(next.cost.seconds)}秒（ゲーム内）。`,
          action:{...view('research','技術研究を見る'),id:next.id},...withCost(next.cost)});
      } else if (unfinished.length) {
        recommendBuilding(buildingFacts('academy'),69,`未完了の技術をさらに研究するには、現在の学問所Lv.${s.buildings.academy}を上げる必要があります。`);
      }
    }

    const capacity = game.troopCapacity(), room = capacity-s.troops;
    const wantsTroops = s.troops < capacity*.65 && room >= 100;
    if (hasCommand && !ricePressure) {
      if (s.troops > 0 && s.morale < 85) {
        const cost = game.trainingCost(), affordable = canPay(cost);
        if (resources.rice-number(cost.rice) >= reserveRice) {
          add({id:'training',priority:(s.morale<60?89:73)-(affordable?0:15),tone:s.morale<60?'urgent':'advice',category:'army',
            title:affordable?'訓練で士気を整える':'訓練の金銭を準備する',
            reason:`士気は${s.morale} / 100です。1回の訓練で${Math.min(100-s.morale,game.trainingGain())}回復します。${affordable?'':` 不足は${shortageText(cost)}です。`}`,
            detail:'訓練には指令1回と金銭・兵糧を使います。',action:view('army','訓練を確認'),...withCost(cost)});
        }
      }
      if (wantsTroops) {
        const limit = Math.floor(Math.min(1000,room,Math.ceil(capacity*.65)-s.troops));
        const upkeepAfter = amount => Math.ceil((s.troops+amount)*.12+owned.length*60);
        const supported = amount => income.grossRice >= upkeepAfter(amount);
        const affordable = amount => {
          const cost=game.recruitTroopCost(amount);
          return canPay(cost) && resources.rice-cost.rice >= Math.max(500,upkeepAfter(amount)*2);
        };
        if (limit>=100 && supported(100)) {
          let low=0, high=limit;
          while (low<high) {const mid=Math.ceil((low+high)/2);if (supported(mid)&&affordable(mid)) low=mid;else high=mid-1;}
          if (low>=100) {
            const cost=game.recruitTroopCost(low);
            add({id:'recruit-troops',priority:s.troops<300?90:70,tone:'advice',category:'army',title:'兵を補充して軍団を整える',
              reason:`現在${fmt(s.troops)} / ${fmt(capacity)}人。${fmt(low)}人の募兵なら、費用を払った後も兵糧の備えと赤字でない収支を保てます。`,
              detail:'募兵には指令1回を使い、人数に応じて士気が下がります。軍団画面で人数を確認してください。',
              action:view('army','募兵を確認'),amount:low,...withCost(cost)});
          } else if (!canPay(game.recruitTroopCost(100))) {
            const cost=game.recruitTroopCost(100);
            add({id:'recruit-troops',priority:59,tone:'advice',category:'army',title:'最小100人の募兵費用を準備する',
              reason:`兵数は${fmt(s.troops)} / ${fmt(capacity)}人。100人分の費用に${shortageText(cost)}が不足しています。`,
              detail:'費用に加えて、募兵後の維持費と兵糧の備えも確認しましょう。',action:view('army','募兵費用を確認'),amount:100,...withCost(cost)});
          } else {
            riceAdvice('100人分の募兵費用はありますが、支払うと募兵後の維持費2か月分の備えを下回ります。兵糧を蓄えてから補充しましょう。',83);
          }
        } else if (limit>=100) {
          riceAdvice('100人を募兵すると月の兵糧収支が赤字になります。生産を増やしてから兵を補充しましょう。',83);
        }
      } else if (room<100) {
        recommendBuilding(buildingFacts('barracks'),63,`兵数は${fmt(s.troops)} / ${fmt(capacity)}人で、100人を追加できる空きがありません。兵舎を育てると上限が増えます。`);
      }
    }

    const facilityCount = data.buildings.filter(b => s.buildings[b.id]>0).length;
    if (s.officers.length < facilityCount+3) {
      const recruits = hasCommand ? game.searchOfficers().map(o => ({o,can:game.canRecruitOfficer(o.id)})).filter(row => row.can.ok).sort((a,b) => a.can.cost-b.can.cost || compareId(a.o,b.o)) : [];
      if (recruits.length) {
        const {o,can}=recruits[0];
        add({id:'officers',priority:army.length<3&&!available.length?87:49,tone:'advice',category:'officers',title:'登用できる武将を確認',
          reason:`${o.name}は現在の天守レベルと金銭で登用できます。軍団や奉行に使う家臣を増やせます。`,
          detail:'名鑑で能力と登用費用を確認できます。登用には指令1回を使います。',action:view('officers','武将名鑑を見る'),cost:{gold:can.cost}});
      } else {
        const draw = game.canDrawOfficers(1);
        if (draw.ok) {
          add({id:'officers',priority:48,tone:'advice',category:'officers',title:'武将招集の内容を確認',
            reason:`家臣は${s.officers.length}名、建設済みの施設は${facilityCount}件です。勾玉${fmt(draw.cost)}で1回招集できます。`,
            detail:'招集は抽選です。所持済みの絵巻が出る場合もあります。指令は使いません。',action:{kind:'gacha',label:'武将招集を見る'},cost:{magatama:draw.cost}});
        }
      }
    }

    // A preview is a probability, never a promise. Retain a fifth of the army
    // (at least 300 soldiers), and do not spend the upkeep reserve on a sortie.
    if (hasCommand && !ricePressure && s.morale>=75 && army.length && s.troops>=600 && !s.won) {
      const troops = Math.floor((s.troops-Math.max(300,Math.ceil(s.troops*.2)))/100)*100;
      const previews = troops>=300 ? game.adjacentTargets().map(c => game.previewBattle(c.id,'balanced',troops)).filter(p => p.ok && p.winChance>=80 && resources.rice-p.foodCost>=reserveRice).sort((a,b) => b.winChance-a.winChance || a.defensePower-b.defensePower || (a.castleId<b.castleId?-1:a.castleId>b.castleId?1:0)) : [];
      if (previews.length) {
        const p=previews[0];
        add({id:'battle:'+p.castleId,priority:60,tone:'advice',category:'battle',title:p.castleName+'の戦況を確認',
          reason:`正攻法・${fmt(troops)}人での推定勝率は${p.winChance}%です。予備兵と維持費2か月分の兵糧を残した目安です。`,
          detail:'勝利を保証する数字ではなく、兵の損耗もあります。出陣画面で最新の戦力と費用を確認してください。',
          action:{kind:'castle',id:p.castleId,label:'出陣前の戦況を見る'},troops,winChance:p.winChance,cost:{rice:p.foodCost}});
      }
    }

    if (!items.size) {
      add({id:'review',priority:10,tone:'success',category:'system',title:s.won?'天下統一の記録を確認':'領国の歩みを確認',
        reason:s.won?'攻略対象の城を統一しています。軍議で任務とこれまでの歩みを確認できます。':'現在の条件では、急いで進める候補はありません。軍議で任務や最近の出来事を確認しましょう。',
        action:view('council','軍議を見る')});
    }
    return {status:'ready',title:'いまの状況から、次の一手',
      summary:items.has('rice-balance')?'兵糧の備えを優先しましょう。各項目から、費用や条件を確認できます。':!hasCommand?'指令の回復を待ちながら、編成や任務の確認を進められます。':'資源・普請・軍団の状況から、優先する行動を並べました。',
      items:[...items.values()].sort((a,b) => b.priority-a.priority || compareId(a,b)).slice(0,10)};
  }

  const api = Object.freeze({version:1,build});
  root.SengokuHints = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
