(() => {
  const dropzoneSelector = '[data-favorite-dropzone="true"]';
  const suggestionsSelector = '#search-suggestions';
  const searchSuppressedAttribute = 'data-akisato-search-suppressed';
  const offsetProperty = '--akisato-search-suggestions-offset';
  const safeGap = 18;
  let isRestoring = false;
  let panelSyncFrame = 0;
  const panelState = new WeakMap();

  const isSearchSuppressed = () => document.documentElement.hasAttribute(searchSuppressedAttribute);

  const hasSuggestions = () => !isSearchSuppressed()
    && Boolean(document.querySelector(suggestionsSelector));

  const isGridSeparated = () => {
    try {
      const layout = JSON.parse(localStorage.getItem('layout_settings') || '{}');
      const position = layout.searchPos === 'center' || !layout.showCollections
        ? 'center'
        : 'top';
      const gridOffset = Number(layout[`gridTop_${position}`] || 0);
      return Math.abs(gridOffset) > 260;
    } catch {
      return false;
    }
  };

  const getUserGridMargin = () => {
    try {
      const layout = JSON.parse(localStorage.getItem('layout_settings') || '{}');
      const position = layout.searchPos === 'center' || !layout.showCollections
        ? 'center'
        : 'top';
      const value = Number(layout[`gridTop_${position}`] || 0);
      return `${Number.isFinite(value) ? value : 0}px`;
    } catch {
      return '0px';
    }
  };

  const getCurrentTranslateY = (element) => {
    const values = getComputedStyle(element).translate.match(/-?\d*\.?\d+px/g);
    return values && values.length > 1 ? Number.parseFloat(values[1]) : 0;
  };

  const stabilizeDropzone = (dropzone) => {
    if (!dropzone || isRestoring) return;

    // Keep the user's saved offset as the real layout margin. The suggestion
    // panel uses only --akisato-search-suggestions-offset for temporary avoidance.
    if (!hasSuggestions()) return;

    const userMargin = getUserGridMargin();
    const currentMargin = dropzone.style.marginTop || '0px';

    // React 的候选框状态不再通过 margin-top 推动收藏区。
    if (currentMargin !== userMargin) {
      isRestoring = true;
      dropzone.style.marginTop = userMargin;
      queueMicrotask(() => {
        isRestoring = false;
      });
    }
  };

  const panelIsVisible = (panel) => {
    if (!panel || !panel.isConnected || isSearchSuppressed()) return false;

    const computed = getComputedStyle(panel);
    if (computed.display === 'none' || computed.visibility === 'hidden') return false;

    const state = panelState.get(panel) || { wasFullyVisible: false };
    const opacity = Number.parseFloat(panel.style.opacity);
    if (Number.isNaN(opacity) || opacity >= 0.98) {
      state.wasFullyVisible = true;
      panelState.set(panel, state);
      return true;
    }

    // 已完整展开后，透明度开始下降即代表收起动画已开始。
    return !state.wasFullyVisible;
  };

  const getRequiredOffset = (panel, dropzone) => {
    if (!panelIsVisible(panel) || !dropzone) return 0;

    const panelRect = panel.getBoundingClientRect();
    const dropzoneRect = dropzone.getBoundingClientRect();
    const overlapsHorizontally = panelRect.left < dropzoneRect.right
      && panelRect.right > dropzoneRect.left;

    // 外层刚挂载时 max-height 还是 0；读取内容层可提前得到最终展开高度，
    // 让收藏区在第一帧就开始避让，而不是等候选框展开后才追赶。
    const contentHeight = panel.firstElementChild?.scrollHeight || panel.scrollHeight;
    const panelHeight = Math.min(350, Math.max(contentHeight, panelRect.height));
    if (!overlapsHorizontally || panelHeight < 1) return 0;

    // getBoundingClientRect 已包含当前 translate；扣掉它后才能拿到收藏区原始顶部。
    const dropzoneBaseTop = dropzoneRect.top - getCurrentTranslateY(dropzone);
    return Math.max(0, Math.ceil(panelRect.top + panelHeight + safeGap - dropzoneBaseTop));
  };

  const syncPanelOffset = () => {
    const panel = document.querySelector(suggestionsSelector);
    const dropzone = document.querySelector(dropzoneSelector);
    if (!panel || isGridSeparated()) {
      if (document.documentElement.style.getPropertyValue(offsetProperty) !== '0px') {
        document.documentElement.style.setProperty(offsetProperty, '0px');
      }
      return;
    }
    stabilizeDropzone(dropzone);
    document.documentElement.style.setProperty(
      offsetProperty,
      `${getRequiredOffset(panel, dropzone)}px`,
    );
  };

  const schedulePanelSync = () => {
    cancelAnimationFrame(panelSyncFrame);
    panelSyncFrame = requestAnimationFrame(syncPanelOffset);
  };

  const beginSearchInteractionSync = () => {
    // Pointerdown happens before the first focus/render commit. Run once now,
    // once after the event updates React, and keep the normal animation-frame
    // sync so the collection starts moving with the very first expansion.
    syncPanelOffset();
    queueMicrotask(syncPanelOffset);
    schedulePanelSync();
  };

  const observePanel = (panel) => {
    if (!panel || panel.__akisatoPanelObserved) return;
    panel.__akisatoPanelObserved = true;

    new MutationObserver(schedulePanelSync).observe(panel, {
      attributes: true,
      attributeFilter: ['style'],
    });
    new ResizeObserver(schedulePanelSync).observe(panel);
    syncPanelOffset();
  };

  const observeDropzone = (dropzone) => {
    if (!dropzone || dropzone.__akisatoLayoutStabilityObserved) return;
    dropzone.__akisatoLayoutStabilityObserved = true;

    stabilizeDropzone(dropzone);
    new MutationObserver(() => {
      if (!hasSuggestions()) return;
      stabilizeDropzone(dropzone);
      schedulePanelSync();
    }).observe(dropzone, {
      attributes: true,
      attributeFilter: ['style'],
    });
    new ResizeObserver(() => {
      if (hasSuggestions()) schedulePanelSync();
    }).observe(dropzone);
  };

  const observe = () => {
    new MutationObserver(() => {
      const dropzone = document.querySelector(dropzoneSelector);
      const panel = document.querySelector(suggestionsSelector);
      observeDropzone(dropzone);
      observePanel(panel);
      if (panel) schedulePanelSync();
    }).observe(document.body, { childList: true, subtree: true });

    observeDropzone(document.querySelector(dropzoneSelector));
    observePanel(document.querySelector(suggestionsSelector));
    window.addEventListener('resize', schedulePanelSync, { passive: true });
    window.addEventListener('akisato-search-suppression-change', schedulePanelSync);
    window.addEventListener('akisato-search-interaction-start', beginSearchInteractionSync);
    schedulePanelSync();
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observe, { once: true });
  } else {
    observe();
  }
})();
