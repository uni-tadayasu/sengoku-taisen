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
    const placed=[];
    return items.map(item=>{
      const preferred=labelRect(item.x,item.y,width,height,item.width,item.height,item.pinSize,item.above),candidates=[preferred];
      candidates.push(labelRect(item.x,item.y,width,height,item.width,item.height,item.pinSize,!item.above));
      for(let top=5;top<=height-preferred.height-5;top+=preferred.height+5)for(let left=5;left<=width-preferred.width-5;left+=preferred.width+5)candidates.push({...preferred,left,top});
      let best=preferred,bestScore=Infinity;
      for(const candidate of candidates){
        const overlap=placed.reduce((sum,p)=>sum+Math.max(0,Math.min(candidate.left+candidate.width+3,p.left+p.width+3)-Math.max(candidate.left,p.left))*Math.max(0,Math.min(candidate.top+candidate.height+3,p.top+p.height+3)-Math.max(candidate.top,p.top)),0);
        const distance=(candidate.left-preferred.left)**2+(candidate.top-preferred.top)**2,score=overlap*100000+distance;
        if(score<bestScore){bestScore=score;best=candidate;}
      }
      const half=(item.pinSize||28)/2,rect={...best,relativeLeft:best.left-item.x+half,relativeTop:best.top-item.y+half};placed.push(rect);return rect;
    });
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
  const api = { fitRect, labelRect, placeLabels, sceneHeight, panelSceneHeight };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  const doc = global.document;
  if (!doc || global.SengokuTownFit) return;
  let main, scene, board, observer, mainObserver, modeObserver, frame = 0, destroyed = false;
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
    const next = main?.querySelector('.town-scene');
    if (scene !== next) {
      observer?.disconnect(); scene = next; board = scene?.querySelector('.town-scene-board');
      if (scene) for (const node of [main, scene, ...main.querySelectorAll('.town-panel,.town-visual,.page-heading,.realtime-strip,.sync-access-notice,.town-scene-heading,.scene-caption,.town-premium-lord')]) observer?.observe(node);
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
        height = panelSceneHeight(panel.clientHeight, panel.querySelector('.town-scene-heading')?.offsetHeight, (panel.querySelector('.scene-caption')?.offsetHeight||0)+(panel.querySelector('.town-premium-lord')?.offsetHeight||0), manualHeight);
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
    const markers=[];
    for (const marker of board.querySelectorAll('.hotspot')) {
      const label = marker.querySelector('.label'); if (!label) continue;
      style(label, 'max-width', Math.max(0, fit.width - 10).toFixed(3) + 'px');
      const x = fit.width * clamp(Number(marker.dataset.townX) || 0, 0, 100) / 100;
      const y = fit.height * clamp(Number(marker.dataset.townY) || 0, 0, 100) / 100;
      const labelBox = label.getBoundingClientRect();
      markers.push({marker,label,x,y,width:labelBox.width,height:labelBox.height,pinSize:marker.offsetWidth,above:['academy','lumber'].includes(marker.dataset.id)});
    }
    const labels=placeLabels(markers,fit.width,fit.height);
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
    observer?.disconnect(); mainObserver?.disconnect(); modeObserver?.disconnect(); for (const remove of removers.splice(0)) remove();
  }
  global.SengokuTownFit = { ...api, refresh, destroy };
  if (doc.readyState === 'loading') listen(doc, 'DOMContentLoaded', init, { once: true }); else init();
})(typeof window !== 'undefined' ? window : globalThis);
