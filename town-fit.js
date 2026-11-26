/* Fit the complete town artwork and its interactive points to the same box. */
(function (global) {
  'use strict';
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  function fitRect(width, height, imageWidth = 1536, imageHeight = 1024) {
    width = Math.max(0, Number(width) || 0); height = Math.max(0, Number(height) || 0);
    imageWidth = Math.max(1, Number(imageWidth) || 1536); imageHeight = Math.max(1, Number(imageHeight) || 1024);
    const scale = Math.min(width / imageWidth, height / imageHeight);
    const fittedWidth = imageWidth * scale, fittedHeight = imageHeight * scale;
    return { width: fittedWidth, height: fittedHeight, left: (width - fittedWidth) / 2, top: (height - fittedHeight) / 2 };
  }
  function labelRect(x, y, width, height, labelWidth, labelHeight, pinSize = 28, above = false) {
    const margin = 5, gap = 5, half = pinSize / 2;
    const maxWidth = Math.max(0, width - margin * 2), maxHeight = Math.max(0, height - margin * 2);
    labelWidth = Math.min(maxWidth, Math.max(0, labelWidth));
    labelHeight = Math.min(maxHeight, Math.max(0, labelHeight));
    const left = clamp(x - labelWidth / 2, margin, Math.max(margin, width - margin - labelWidth));
    let top = above ? y - half - gap - labelHeight : y + half + gap;
    if (top + labelHeight > height - margin) top = y - half - gap - labelHeight;
    if (top < margin) top = y + half + gap;
    top = clamp(top, margin, Math.max(margin, height - margin - labelHeight));
    return { left, top, width: labelWidth, height: labelHeight, relativeLeft: left - x + half, relativeTop: top - y + half };
  }
  function placeLabels(items, width, height) {
    // Every icon is an obstacle, including the icon belonging to this label.
    // Previously the fallback only checked earlier labels and could put a
    // name/level badge directly over the field or academy seal.
    const gap=4, margin=5;
    const intersects=(a,b)=>a.left < b.left+b.width+gap && a.left+a.width+gap > b.left && a.top < b.top+b.height+gap && a.top+a.height+gap > b.top;
    const pins=items.map(item=>{const size=item.pinSize||44;return{left:item.x-size/2,top:item.y-size/2,width:size,height:size};});
    const choices=items.map((item,index)=>{
      const preferred=labelRect(item.x,item.y,width,height,item.width,item.height,item.pinSize,item.above);
      const maxLeft=Math.max(margin,width-preferred.width-margin),maxTop=Math.max(margin,height-preferred.height-margin);
      const xs=new Set([margin,maxLeft,preferred.left]),ys=new Set([margin,maxTop,preferred.top]);
      for(const pin of pins){
        xs.add(clamp(pin.left-preferred.width-gap,margin,maxLeft));xs.add(clamp(pin.left+pin.width+gap,margin,maxLeft));
        ys.add(clamp(pin.top-preferred.height-gap,margin,maxTop));ys.add(clamp(pin.top+pin.height+gap,margin,maxTop));
      }
      // Include local positions on each side, then regular fallback positions.
      const half=(item.pinSize||44)/2;
      xs.add(clamp(item.x-half-preferred.width-gap,margin,maxLeft));xs.add(clamp(item.x+half+gap,margin,maxLeft));
      ys.add(clamp(item.y-preferred.height/2,margin,maxTop));
      for(let x=margin;x<=maxLeft;x+=Math.max(10,preferred.width/2))xs.add(x);
      for(let y=margin;y<=maxTop;y+=Math.max(10,preferred.height/2))ys.add(y);
      const candidates=[];
      for(const left of xs)for(const top of ys){
        const rect={left,top,width:preferred.width,height:preferred.height};
        if(pins.some(pin=>intersects(rect,pin)))continue;
        rect.cost=(left-preferred.left)**2+(top-preferred.top)**2;
        candidates.push(rect);
      }
      candidates.sort((a,b)=>a.cost-b.cost||a.top-b.top||a.left-b.left);
      return{index,preferred,candidates};
    });
    // Place constrained labels first; bounded backtracking resolves tight
    // layouts without moving any facility marker away from its illustration.
    let attempts=0,solution=null;
    function solve(remaining,placed){
      if(!remaining.length){solution=placed.slice();return true;}
      if(++attempts>12000)return false;
      const options=remaining.map(choice=>({...choice,available:choice.candidates.filter(rect=>!placed.some(other=>other&&intersects(rect,other)))})).sort((a,b)=>a.available.length-b.available.length||a.index-b.index);
      const next=options[0];if(!next.available.length)return false;
      for(const rect of next.available.slice(0,80)){
        placed[next.index]=rect;
        if(solve(remaining.filter(choice=>choice.index!==next.index),placed))return true;
      }
      placed[next.index]=null;return false;
    }
    solve(choices,Array(items.length).fill(null));
    // An exceptionally small artwork uses its adjacent facility list instead
    // of overlapping labels; its circular location markers remain visible.
    return items.map((item,index)=>{
      const best=solution?.[index]||choices[index].preferred,half=(item.pinSize||44)/2;
      return{...best,relativeLeft:best.left-item.x+half,relativeTop:best.top-item.y+half,unplaced:!solution};
    });
  }
  function createLabelLayout() {
    let previousKey = '', previousLabels = null;
    return (items, width, height) => {
      // Font, level and compact-mode changes are represented by the measured
      // label/pin sizes. No DOM node or game state is retained in this cache.
      const key = JSON.stringify([width, height, items.map(item => [item.x, item.y, item.width, item.height, item.pinSize, Boolean(item.above)])]);
      if (key !== previousKey || !previousLabels) {
        previousLabels = placeLabels(items, width, height);
        previousKey = key;
      }
      return previousLabels.map(rect => ({...rect}));
    };
  }
  function sceneHeight(preferred, viewportHeight, sceneOffset, bottomPadding = 0) {
    preferred = Math.max(1, Number(preferred) || 460);
    const remaining = Math.max(1, (Number(viewportHeight) || 0) - Math.max(0, Number(sceneOffset) || 0) - Math.max(0, Number(bottomPadding) || 0) - 8);
    return Math.min(preferred, remaining);
  }
  function panelSceneHeight(panelHeight, headingHeight, captionHeight, preferred = null) {
    const available = Math.max(1, (Number(panelHeight) || 0) - Math.max(0, Number(headingHeight) || 0) - Math.max(0, Number(captionHeight) || 0));
    const requested = Number(preferred);
    return Number.isFinite(requested) && requested > 0 ? Math.min(requested, available) : available;
  }
  const api = { fitRect, labelRect, placeLabels, createLabelLayout, sceneHeight, panelSceneHeight };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  const doc = global.document;
  if (!doc || global.SengokuTownFit) return;
  let main, scene, board, observer, mainObserver, modeObserver, labelObserver, frame = 0, destroyed = false;
  let layoutLabels = createLabelLayout();
  const raf = global.requestAnimationFrame?.bind(global) || (fn => global.setTimeout(fn, 16));
  const caf = global.cancelAnimationFrame?.bind(global) || global.clearTimeout.bind(global);
  const removers = [];
  function listen(target, type, handler, options) {
    target?.addEventListener?.(type, handler, options);
    removers.push(() => target?.removeEventListener?.(type, handler, options));
  }
  function style(node, name, value) { if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value); }
  function update() {
    frame = 0;
    if (destroyed) return;
    const next = main?.querySelector('.town-scene'), nextBoard = next?.querySelector('.town-scene-board');
    if (scene !== next || board !== nextBoard) {
      observer?.disconnect(); labelObserver?.disconnect(); scene = next; board = nextBoard;
      layoutLabels = createLabelLayout();
      if(board)labelObserver?.observe(board,{childList:true,subtree:true,characterData:true});
      if (scene) for (const node of [main, scene, ...main.querySelectorAll('.town-panel,.town-visual,.page-heading,.realtime-strip,.sync-access-notice,.town-scene-heading,.scene-caption,.town-premium-lord,.town-command-shortcuts')]) observer?.observe(node);
    }
    if (!scene || !board || !scene.isConnected) return;
    const root = doc.documentElement;
    if (root.classList.contains('sengoku-desktop-fit')) {
      const rootStyle = global.getComputedStyle(root);
      const manualHeight = root.hasAttribute('data-layout-townheight') ? parseFloat(rootStyle.getPropertyValue('--layout-town-height')) : null;
      const panel = scene.closest('.town-panel');
      let height;
      if (scene.closest('.town-workspace') && panel) {
        // The artwork gets the whole independent PC canvas. The command pane
        // may scroll or grow internally without changing this available height.
        height = panelSceneHeight(panel.clientHeight, panel.querySelector('.town-scene-heading')?.offsetHeight, (panel.querySelector('.scene-caption')?.offsetHeight||0)+(panel.querySelector('.town-premium-lord')?.offsetHeight||0)+(panel.querySelector('.town-command-shortcuts')?.offsetHeight||0), manualHeight);
      } else {
        const mainBox = main.getBoundingClientRect(), sceneBox = scene.getBoundingClientRect();
        const preferred = manualHeight || parseFloat(rootStyle.getPropertyValue('--desktop-town-height')) || 460;
        const padding = parseFloat(global.getComputedStyle(main).paddingBottom) || 0;
        const offset = sceneBox.top - mainBox.top + main.scrollTop;
        height = sceneHeight(preferred, main.clientHeight, offset, padding);
      }
      style(scene, '--town-auto-height', height.toFixed(3) + 'px');
    } else scene.style.removeProperty('--town-auto-height');
    const image = board.querySelector('.town-scene-image');
    const fit = fitRect(scene.clientWidth, scene.clientHeight, image?.naturalWidth || 1536, image?.naturalHeight || 1024);
    if (!fit.width || !fit.height) return;
    for (const key of ['width', 'height', 'left', 'top']) style(board, key, fit[key].toFixed(3) + 'px');
    const compact = fit.width < 620;
    if (scene.hasAttribute('data-town-compact') !== compact) scene.toggleAttribute('data-town-compact', compact);
    const tiny = fit.width < 240;
    if (scene.hasAttribute('data-town-art-small') !== tiny) scene.toggleAttribute('data-town-art-small', tiny);
    const panel = scene.closest('.town-panel');
    if (panel && panel.hasAttribute('data-town-compact') !== compact) panel.toggleAttribute('data-town-compact', compact);
    const pairs = Array.from(board.querySelectorAll('.hotspot'), marker => ({marker, label: marker.querySelector('.label')})).filter(item => item.label);
    const maxLabelWidth = Math.max(0, fit.width - 10).toFixed(3) + 'px';
    // Apply all width constraints before reading a single label. Interleaving
    // these writes and measurements forced a separate layout for every pin.
    for (const {label} of pairs) style(label, 'max-width', maxLabelWidth);
    const markers=[];
    for (const {marker, label} of pairs) {
      const x = fit.width * clamp(Number(marker.dataset.townX) || 0, 0, 100) / 100;
      const y = fit.height * clamp(Number(marker.dataset.townY) || 0, 0, 100) / 100;
      const labelBox = label.getBoundingClientRect();
      markers.push({marker,label,x,y,width:labelBox.width,height:labelBox.height,pinSize:marker.offsetWidth,above:['academy','lumber'].includes(marker.dataset.id)});
    }
    const labels=layoutLabels(markers,fit.width,fit.height);
    const outside=labels.some(rect=>rect.unplaced);
    if(scene.hasAttribute('data-town-labels-outside')!==outside)scene.toggleAttribute('data-town-labels-outside',outside);
    for(let index=0;index<markers.length;index++){
      const {label}=markers[index],rect=labels[index];
      style(label, '--town-label-left', rect.relativeLeft.toFixed(3) + 'px');
      style(label, '--town-label-top', rect.relativeTop.toFixed(3) + 'px');
    }
    board.setAttribute('data-town-ready', '');
  }
  function refresh() { if (!destroyed && !frame) frame = raf(update); }
  function init() {
    main = doc.getElementById('main'); if (!main) return;
    if (global.ResizeObserver) observer = new global.ResizeObserver(refresh);
    if (global.MutationObserver) {
      labelObserver = new global.MutationObserver(refresh);
      mainObserver = new global.MutationObserver(refresh);
      mainObserver.observe(main, { childList: true, attributes: true, attributeFilter: ['data-view'] });
      modeObserver = new global.MutationObserver(refresh);
      modeObserver.observe(doc.documentElement, { attributes: true, attributeFilter: ['class', 'data-layout-townheight', 'style'] });
    }
    listen(global, 'resize', refresh); listen(global.visualViewport, 'resize', refresh);
    listen(main, 'load', event => { if (event.target.matches?.('.town-scene-image')) refresh(); }, true);
    doc.fonts?.ready?.then(refresh).catch(() => {});
    refresh();
  }
  function destroy() {
    destroyed = true; if (frame) caf(frame); frame = 0;
    observer?.disconnect(); mainObserver?.disconnect(); modeObserver?.disconnect(); labelObserver?.disconnect(); for (const remove of removers.splice(0)) remove();
  }
  global.SengokuTownFit = { ...api, refresh, destroy };
  if (doc.readyState === 'loading') listen(doc, 'DOMContentLoaded', init, { once: true }); else init();
})(typeof window !== 'undefined' ? window : globalThis);
