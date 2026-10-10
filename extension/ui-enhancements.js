(() => {
  const searchOffsetKeyPrefix = 'akisato_search_vertical_offset_';
  const searchInputSelector = 'input[role="combobox"]';
  const searchShellSelector = '.search-box-hover-shell';
  const searchSuppressedAttribute = 'data-akisato-search-suppressed';
  const capsuleHeightKey = 'akisato_bookmark_capsule_height_v1';
  const submenuHeightKey = 'akisato_bookmark_submenu_height_v1';
  const cardSelector = '[data-favorite-card-shell="true"]';
  const offsetLimit = 120;
  const offsetStep = 10;
  const capsuleHeightMin = 54;
  const capsuleHeightMax = 96;
  const capsuleHeightStep = 2;
  const capsuleHeightDefault = 90;
  const submenuHeightMin = 40;
  const submenuHeightMax = 94;
  const submenuHeightStep = 2;
  const submenuHeightDefault = 80;
  const capsuleThemeClickCooldown = 560;
  const capsuleThemeStateHoldDuration = 1000;
  const capsuleThemeLockAttribute = 'data-akisato-capsule-theme-lock';
  const capsuleThemeLockWidthProperty = '--akisato-capsule-theme-lock-width';
  const capsuleThemeLockHeightProperty = '--akisato-capsule-theme-lock-height';
  const cardFlipDuration = 280;
  const cardFlipEasing = 'cubic-bezier(.22,.8,.36,1)';
  let scheduledSync = 0;
  let cardFlipFrame = 0;
  let cardFlipStopTimer = 0;
  let favoriteHeadingSyncFrame = 0;
  let favoriteFooterSyncFrame = 0;
  let favoriteFooterTrackUntil = 0;
  let submenuBoundsSyncFrame = 0;
  let submenuBoundsTrackUntil = 0;
  let cardFlipDraggingCard = null;
  let cardFlipPreviousLayouts = new Map();
  const cardFlipCleanupTimers = new Map();
  let settingsMirrorView = null;
  let settingsMirrorPanel = null;
  let settingsSyncSuppressed = false;
  let settingsOpenFromCollapsedPending = false;
  let settingsOpenFromCollapsedTimer = 0;
  let capsuleThemeTransitionUntil = 0;
  let capsuleThemeTransitionMode = null;
  let capsuleThemeTransitionTimer = 0;
  let capsuleExpansionRecoveryActive = false;
  let capsuleExpansionRecoveryFrame = 0;
  let capsuleExpansionRecoveryTimer = 0;
  let settingsViewEntranceTimer = 0;
  let stopInitialSearchFocusGuard = () => {};

  const readNumber = (value, fallback = 0) => {
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) ? number : fallback;
  };

  const isCapsuleThemeTransitionActive = () => Date.now() < capsuleThemeTransitionUntil;

  const clearCapsuleThemeStateLock = () => {
    window.clearTimeout(capsuleThemeTransitionTimer);
    capsuleThemeTransitionTimer = 0;
    capsuleThemeTransitionUntil = 0;
    capsuleThemeTransitionMode = null;
    const root = document.documentElement;
    root.removeAttribute(capsuleThemeLockAttribute);
    root.style.removeProperty(capsuleThemeLockWidthProperty);
    root.style.removeProperty(capsuleThemeLockHeightProperty);
  };

  const beginCapsuleThemeStateLock = (capsule) => {
    const root = document.documentElement;
    const rect = capsule?.getBoundingClientRect();
    capsuleThemeTransitionMode = root.hasAttribute('data-akisato-settings-open')
      ? 'settings'
      : 'bookmarks';
    capsuleThemeTransitionUntil = Date.now() + capsuleThemeStateHoldDuration;
    root.setAttribute(capsuleThemeLockAttribute, capsuleThemeTransitionMode);
    if (rect?.width > 0 && rect?.height > 0) {
      root.style.setProperty(capsuleThemeLockWidthProperty, `${rect.width}px`);
      root.style.setProperty(capsuleThemeLockHeightProperty, `${rect.height}px`);
    }

    window.clearTimeout(capsuleThemeTransitionTimer);
    const expectedUntil = capsuleThemeTransitionUntil;
    capsuleThemeTransitionTimer = window.setTimeout(() => {
      if (capsuleThemeTransitionUntil !== expectedUntil || Date.now() < expectedUntil) return;
      clearCapsuleThemeStateLock();
      scheduleSettingsCapsuleSync();
    }, capsuleThemeStateHoldDuration + 40);
  };

  const clampCapsuleHeight = (value) => Math.max(
    capsuleHeightMin,
    Math.min(capsuleHeightMax, readNumber(value, capsuleHeightDefault)),
  );

  const clampSubmenuHeight = (value) => Math.max(
    submenuHeightMin,
    Math.min(submenuHeightMax, readNumber(value, submenuHeightDefault)),
  );

  const readCapsuleHeight = () => clampCapsuleHeight(localStorage.getItem(capsuleHeightKey));

  const applyCapsuleHeight = (value = readCapsuleHeight()) => {
    const height = clampCapsuleHeight(value);
    document.documentElement.style.setProperty('--akisato-capsule-max-height', `${height}vh`);
    return height;
  };

  const readSubmenuHeight = () => clampSubmenuHeight(localStorage.getItem(submenuHeightKey));

  const applySubmenuHeight = (value = readSubmenuHeight()) => {
    const height = clampSubmenuHeight(value);
    document.documentElement.style.setProperty('--akisato-bookmark-submenu-height', `${height}vh`);
    window.dispatchEvent(new Event('akisato-submenu-height-change'));
    return height;
  };

  const readLayoutSettings = () => {
    try {
      return JSON.parse(localStorage.getItem('layout_settings') || '{}');
    } catch {
      return {};
    }
  };

  const readSearchPosition = () => readLayoutSettings().searchPos === 'top' ? 'top' : 'center';
  const offsetKeyFor = (position = readSearchPosition()) => `${searchOffsetKeyPrefix}${position}_v1`;
  const clampOffset = (value) => Math.max(-offsetLimit, Math.min(offsetLimit, readNumber(value)));
  const readSearchOffset = (position = readSearchPosition()) => clampOffset(localStorage.getItem(offsetKeyFor(position)));

  const applySearchOffset = (value = readSearchOffset(), position = readSearchPosition()) => {
    const offset = clampOffset(value);
    document.documentElement.style.setProperty('--akisato-search-vertical-offset', `${offset}px`);
    return offset;
  };

  const syncCardSizing = () => {
    const layout = readLayoutSettings();
    const cardSize = Math.max(50, Math.min(150, Number(layout.cardSize) || 100));
    // Preserve the current 50% size and make every 5% step a steady 4px.
    const edge = 48 + cardSize * 0.8;
    document.documentElement.style.setProperty('--akisato-card-edge', `${edge}px`);
  };

  const syncFavoriteSectionHeading = () => {
    const dropzone = document.querySelector('[data-favorite-dropzone="true"]');
    const grid = dropzone?.querySelector(':scope > .favorite-grid-shell');
    const heading = grid?.previousElementSibling;
    const firstCard = grid?.querySelector(':scope > [data-favorite-card-shell="true"]');
    if (!dropzone || !grid || !heading) return;

    heading.setAttribute('data-akisato-favorite-heading', 'true');
    // Anchor the heading's right edge just before the first card. offsetLeft
    // comes from flex layout, so hover/drag transforms cannot make it drift.
    const headingItems = [...heading.children];
    const headingGap = Number.parseFloat(getComputedStyle(heading).columnGap) || 0;
    const headingContentWidth = headingItems.reduce(
      (width, item) => width + item.getBoundingClientRect().width,
      Math.max(0, headingItems.length - 1) * headingGap,
    );
    const headingOffset = (firstCard?.offsetLeft || 0) - headingContentWidth - 12;
    heading.style.setProperty(
      '--akisato-favorite-heading-offset',
      `${Math.max(0, Math.round(headingOffset))}px`,
    );

    const icon = heading.querySelector(':scope > svg');
    if (!icon || icon.getAttribute('data-akisato-favorite-icon') === 'bookmark') return;
    icon.setAttribute('data-akisato-favorite-icon', 'bookmark');
    icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none');
    icon.setAttribute('stroke', 'currentColor');
    icon.setAttribute('stroke-width', '2');
    icon.setAttribute('stroke-linecap', 'round');
    icon.setAttribute('stroke-linejoin', 'round');
    icon.innerHTML = '<path d="M19 21l-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path>';
  };

  const findPageFooter = () => [...document.querySelectorAll('footer')]
    .find((footer) => footer.textContent.includes('@AKISATO 2026'));

  const isVisibleFooterCollisionSurface = (element) => {
    if (!element?.isConnected || element.offsetParent === null) return false;
    const style = getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const opacity = Number.parseFloat(style.opacity);
    if (Number.isFinite(opacity) && opacity <= 0.02) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0.5 && rect.height > 0.5;
  };

  const footerCollisionSurfaces = () => {
    const surfaces = [];
    document.querySelectorAll(cardSelector).forEach((card) => {
      surfaces.push(card.querySelector(':scope > [data-favorite-glass-target="true"]') || card);
    });

    const favoriteHeading = document.querySelector('[data-akisato-favorite-heading="true"]');
    if (favoriteHeading) surfaces.push(favoriteHeading);

    const searchShell = document.querySelector(searchShellSelector);
    if (searchShell) {
      surfaces.push(searchShell);
      const searchStage = searchShell.parentElement;
      const titleSurface = searchStage?.previousElementSibling;
      if (titleSurface
        && titleSurface.parentElement === searchStage.parentElement
        && !titleSurface.matches('footer, [data-favorite-dropzone="true"]')) {
        titleSurface.setAttribute('data-akisato-title-surface', 'true');
        surfaces.push(titleSurface);
      }
    }

    const suggestions = document.querySelector('#search-suggestions');
    if (suggestions) surfaces.push(suggestions);
    return [...new Set(surfaces)];
  };

  const syncFavoriteFooterCollision = () => {
    const footer = findPageFooter();
    if (!footer) return;

    footer.setAttribute('data-akisato-page-footer', 'true');
    const footerLabel = footer.querySelector('p') || footer;
    const footerRect = footerLabel.getBoundingClientRect();
    const collisionGap = 4;
    const isObscured = footerCollisionSurfaces().some((surface) => {
      if (!isVisibleFooterCollisionSurface(surface)
        || surface === footer
        || surface.contains(footerLabel)) return false;
      const surfaceRect = surface.getBoundingClientRect();
      return surfaceRect.left < footerRect.right + collisionGap
        && surfaceRect.right > footerRect.left - collisionGap
        && surfaceRect.top < footerRect.bottom + collisionGap
        && surfaceRect.bottom > footerRect.top - collisionGap;
    });

    footer.toggleAttribute('data-akisato-footer-obscured', isObscured);
    footer.setAttribute('aria-hidden', isObscured ? 'true' : 'false');
  };

  const runFavoriteFooterTracking = () => {
    syncFavoriteFooterCollision();
    if (performance.now() < favoriteFooterTrackUntil) {
      favoriteFooterSyncFrame = requestAnimationFrame(runFavoriteFooterTracking);
      return;
    }
    favoriteFooterSyncFrame = 0;
  };

  const scheduleFavoriteFooterCollisionSync = (trackMilliseconds = 0) => {
    favoriteFooterTrackUntil = Math.max(
      favoriteFooterTrackUntil,
      performance.now() + trackMilliseconds,
    );
    if (!favoriteFooterSyncFrame) {
      favoriteFooterSyncFrame = requestAnimationFrame(runFavoriteFooterTracking);
    }
  };

  const bookmarkSubmenuSelector = '.portal-submenu-root.submenu-scroll';

  const syncBookmarkSubmenuBounds = () => {
    const visualViewport = window.visualViewport;
    const viewportHeights = [
      document.documentElement.clientHeight,
      window.innerHeight,
      visualViewport?.height,
    ].filter((value) => Number.isFinite(value) && value > 0);
    const viewportHeight = viewportHeights.length ? Math.min(...viewportHeights) : 0;
    if (!viewportHeight) return;

    const viewportTop = Math.max(0, visualViewport?.offsetTop || 0);
    const viewportBottom = viewportTop + viewportHeight;
    // shadow-2xl and the rounded border extend outside the menu's layout box.
    // Reserve enough visual space so those edges are not clipped by the
    // browser viewport or by a non-maximized window boundary.
    const viewportGap = 32;
    const preferredHeight = Math.min(
      viewportHeight - viewportGap * 2,
      viewportHeight * readSubmenuHeight() / 100,
    );

    document.querySelectorAll(bookmarkSubmenuSelector).forEach((menu) => {
      if (!(menu instanceof HTMLElement) || menu.offsetParent === null) return;
      const sourceTop = Number.parseFloat(menu.style.top);
      const initialTop = Number.isFinite(sourceTop)
        ? sourceTop
        : menu.getBoundingClientRect().top;
      const contentHeight = Math.max(menu.scrollHeight, menu.getBoundingClientRect().height);
      const expectedHeight = Math.min(preferredHeight, contentHeight || preferredHeight);
      const bottomSafeTop = viewportBottom - viewportGap - expectedHeight;
      const boundedTop = Math.max(
        viewportTop + viewportGap,
        Math.min(initialTop, bottomSafeTop),
      );
      const availableHeight = Math.max(80, viewportBottom - viewportGap - boundedTop);
      const boundedHeight = Math.min(preferredHeight, availableHeight);
      const topValue = `${Math.round(boundedTop * 100) / 100}px`;
      const heightValue = `${Math.round(boundedHeight * 100) / 100}px`;

      if (!menu.hasAttribute('data-akisato-submenu-bounded')) {
        menu.setAttribute('data-akisato-submenu-bounded', 'true');
      }
      if (menu.style.getPropertyValue('--akisato-bookmark-submenu-bounded-top') !== topValue) {
        menu.style.setProperty('--akisato-bookmark-submenu-bounded-top', topValue);
      }
      if (menu.style.getPropertyValue('--akisato-bookmark-submenu-bounded-height') !== heightValue) {
        menu.style.setProperty('--akisato-bookmark-submenu-bounded-height', heightValue);
      }
    });
  };

  const runBookmarkSubmenuBoundsTracking = () => {
    syncBookmarkSubmenuBounds();
    if (performance.now() < submenuBoundsTrackUntil) {
      submenuBoundsSyncFrame = requestAnimationFrame(runBookmarkSubmenuBoundsTracking);
      return;
    }
    submenuBoundsSyncFrame = 0;
  };

  const scheduleBookmarkSubmenuBoundsSync = (trackMilliseconds = 0) => {
    submenuBoundsTrackUntil = Math.max(
      submenuBoundsTrackUntil,
      performance.now() + trackMilliseconds,
    );
    if (!submenuBoundsSyncFrame) {
      submenuBoundsSyncFrame = requestAnimationFrame(runBookmarkSubmenuBoundsTracking);
    }
  };

  const enableBookmarkSubmenuBounds = () => {
    new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.target.closest?.(bookmarkSubmenuSelector)
        || [...mutation.addedNodes, ...mutation.removedNodes].some((node) => node instanceof Element
          && (node.matches(bookmarkSubmenuSelector)
            || node.querySelector(bookmarkSubmenuSelector))))) {
        scheduleBookmarkSubmenuBoundsSync(480);
      }
    }).observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style'],
    });

    window.addEventListener('resize', () => scheduleBookmarkSubmenuBoundsSync(620), { passive: true });
    window.visualViewport?.addEventListener(
      'resize',
      () => scheduleBookmarkSubmenuBoundsSync(620),
      { passive: true },
    );
    window.visualViewport?.addEventListener(
      'scroll',
      () => scheduleBookmarkSubmenuBoundsSync(420),
      { passive: true },
    );
    window.addEventListener('akisato-submenu-height-change', () => {
      scheduleBookmarkSubmenuBoundsSync(520);
    });
    document.addEventListener('pointerover', (event) => {
      if (event.target.closest?.(bookmarkSubmenuSelector)) {
        scheduleBookmarkSubmenuBoundsSync(320);
      }
    }, true);
    scheduleBookmarkSubmenuBoundsSync(320);
  };

  const setSearchSuggestionsSuppressed = (suppressed) => {
    const root = document.documentElement;
    if (root.hasAttribute(searchSuppressedAttribute) === suppressed) return;
    root.toggleAttribute(searchSuppressedAttribute, suppressed);
    window.dispatchEvent(new Event('akisato-search-suppression-change'));
  };

  const clearCardLayoutProjection = () => {
    document.querySelectorAll(cardSelector).forEach((card) => {
      card.style.removeProperty('transform');
      card.style.removeProperty('transform-origin');
      card.style.removeProperty('translate');
      card.style.removeProperty('transition');
    });
  };

  const readCardLayouts = () => {
    const layouts = new Map();
    document.querySelectorAll(cardSelector).forEach((card) => {
      if (card.offsetParent === null) return;
      layouts.set(card, { x: card.offsetLeft, y: card.offsetTop });
    });
    return layouts;
  };

  const clearCardFlipStyle = (card) => {
    const cleanupTimer = cardFlipCleanupTimers.get(card);
    if (cleanupTimer) window.clearTimeout(cleanupTimer);
    cardFlipCleanupTimers.delete(card);
    card.style.removeProperty('translate');
    card.style.removeProperty('transition');
  };

  const animateCardLayoutChange = (card, dx, dy) => {
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) return;

    clearCardFlipStyle(card);
    card.style.transition = 'none';
    card.style.setProperty('translate', `${dx}px ${dy}px`);

    requestAnimationFrame(() => {
      if (!card.isConnected) return;
      card.style.transition = `translate ${cardFlipDuration}ms ${cardFlipEasing}`;
      card.style.setProperty('translate', '0px 0px');
    });

    const cleanupTimer = window.setTimeout(() => {
      if (card.isConnected) clearCardFlipStyle(card);
      cardFlipCleanupTimers.delete(card);
    }, cardFlipDuration + 50);
    cardFlipCleanupTimers.set(card, cleanupTimer);
  };

  const sampleCardLayoutChanges = () => {
    const currentLayouts = readCardLayouts();
    const draggedCard = cardFlipDraggingCard
      || document.querySelector(`${cardSelector}[data-favorite-dragging="true"]`);

    currentLayouts.forEach((current, card) => {
      const previous = cardFlipPreviousLayouts.get(card);
      if (!previous || card === draggedCard || card.matches('[data-favorite-dragging="true"]')) return;
      animateCardLayoutChange(card, previous.x - current.x, previous.y - current.y);
    });

    cardFlipPreviousLayouts = currentLayouts;
  };

  const runCardFlipFrame = () => {
    sampleCardLayoutChanges();
    cardFlipFrame = requestAnimationFrame(runCardFlipFrame);
  };

  const stopCardFlipTracking = () => {
    clearTimeout(cardFlipStopTimer);
    cardFlipStopTimer = window.setTimeout(() => {
      cancelAnimationFrame(cardFlipFrame);
      cardFlipFrame = 0;
      cardFlipPreviousLayouts = new Map();
      cardFlipDraggingCard = null;
    }, cardFlipDuration + 360);
  };

  const startCardFlipTracking = (card) => {
    clearTimeout(cardFlipStopTimer);
    cancelAnimationFrame(cardFlipFrame);
    clearCardLayoutProjection();
    cardFlipDraggingCard = card;
    cardFlipPreviousLayouts = readCardLayouts();
    cardFlipFrame = requestAnimationFrame(runCardFlipFrame);
  };

  const clearInitialSearchFocus = () => {
    const input = document.activeElement;
    if (input?.matches(searchInputSelector)) input.blur();
  };

  const preventInitialSearchFocus = () => {
    let enabled = true;
    const stop = () => {
      if (!enabled) return;
      enabled = false;
      document.removeEventListener('focusin', onFocusIn, true);
      if (stopInitialSearchFocusGuard === stop) stopInitialSearchFocusGuard = () => {};
    };
    const onFocusIn = (event) => {
      if (enabled
        && document.documentElement.hasAttribute(searchSuppressedAttribute)
        && event.target.matches?.(searchInputSelector)) {
        requestAnimationFrame(clearInitialSearchFocus);
      }
    };

    document.addEventListener('focusin', onFocusIn, true);
    stopInitialSearchFocusGuard = stop;
    clearInitialSearchFocus();
    window.setTimeout(stop, 900);
  };

  const guardSearchSuggestions = () => {
    setSearchSuggestionsSuppressed(true);
    document.addEventListener('pointerdown', (event) => {
      const isSearchInteraction = event.target.matches?.(searchInputSelector)
        || event.target.closest?.(searchShellSelector)
        || event.composedPath?.().some((node) => node instanceof Element
          && (node.matches(searchInputSelector) || node.matches(searchShellSelector)));
      if (isSearchInteraction) {
        // A real pointer action must immediately take ownership from the
        // startup focus guard, so the first expansion follows the pointer.
        stopInitialSearchFocusGuard();
        setSearchSuggestionsSuppressed(false);
        window.dispatchEvent(new Event('akisato-search-interaction-start'));
        return;
      }
      setSearchSuggestionsSuppressed(!isSearchInteraction);
      clearInitialSearchFocus();
    }, true);
  };

  const enableCardReorderingAnimations = () => {
    document.addEventListener('pointerdown', (event) => {
      if (event.button !== 0 || event.isPrimary === false) return;
      const card = event.target.closest?.(cardSelector);
      if (card) startCardFlipTracking(card);
    }, true);
    const finishReordering = stopCardFlipTracking;
    document.addEventListener('pointerup', finishReordering, true);
    document.addEventListener('pointercancel', finishReordering, true);
  };

  const enableFavoriteSectionHeadingSync = () => {
    const schedule = () => {
      cancelAnimationFrame(favoriteHeadingSyncFrame);
      favoriteHeadingSyncFrame = requestAnimationFrame(syncFavoriteSectionHeading);
    };
    new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.target.closest?.('[data-favorite-dropzone="true"]')
        || [...mutation.addedNodes, ...mutation.removedNodes].some((node) => node instanceof Element
          && (node.matches('[data-favorite-dropzone="true"]')
            || node.closest('[data-favorite-dropzone="true"]')
            || node.querySelector('[data-favorite-dropzone="true"]'))))) {
        schedule();
      }
    }).observe(document.body, { childList: true, subtree: true });
    schedule();
  };

  const enableFavoriteFooterCollision = () => {
    const collisionMutationSelector = [
      'footer',
      '[data-favorite-dropzone="true"]',
      '[data-akisato-title-surface="true"]',
      searchShellSelector,
      '#search-suggestions',
    ].join(',');
    new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.target.closest?.(collisionMutationSelector)
        || [...mutation.addedNodes, ...mutation.removedNodes].some((node) => node instanceof Element
          && (node.matches(collisionMutationSelector)
            || node.querySelector(collisionMutationSelector))))) {
        scheduleFavoriteFooterCollisionSync(420);
      }
    }).observe(document.body, { childList: true, subtree: true });

    window.addEventListener('resize', () => scheduleFavoriteFooterCollisionSync(420), { passive: true });
    window.addEventListener('akisato-search-interaction-start', () => {
      scheduleFavoriteFooterCollisionSync(520);
    });
    window.addEventListener('akisato-search-suppression-change', () => {
      scheduleFavoriteFooterCollisionSync(520);
    });
    document.addEventListener('transitionrun', (event) => {
      if (event.target.closest?.(collisionMutationSelector)) {
        scheduleFavoriteFooterCollisionSync(520);
      }
    }, true);
    document.addEventListener('pointerdown', (event) => {
      if (event.target.closest?.(cardSelector)) scheduleFavoriteFooterCollisionSync(1200);
    }, true);
    document.addEventListener('pointerover', (event) => {
      if (event.target.closest?.(cardSelector)) scheduleFavoriteFooterCollisionSync(420);
    }, true);
    document.addEventListener('pointerout', (event) => {
      if (event.target.closest?.(cardSelector)) scheduleFavoriteFooterCollisionSync(420);
    }, true);
    document.addEventListener('pointermove', () => {
      if (cardFlipDraggingCard) scheduleFavoriteFooterCollisionSync(160);
    }, true);
    document.addEventListener('pointerup', () => scheduleFavoriteFooterCollisionSync(420), true);
    scheduleFavoriteFooterCollisionSync(520);
  };

  const findSettingsModal = () => {
    const title = [...document.querySelectorAll('.ui-modal-title')]
      .find((element) => !element.closest('[data-akisato-capsule-settings-view]')
        && element.parentElement?.parentElement?.querySelector('.settings-label'));
    const panel = title?.closest('.glass-panel');
    const frame = panel?.parentElement;
    if (!panel || !frame) return null;
    return { panel, frame, backdrop: frame.previousElementSibling };
  };

  const findBookmarkCapsule = () => {
    const avatar = document.querySelector('img[alt="Avatar"]');
    const capsule = avatar?.closest('div.fixed');
    if (!capsule || !capsule.contains(avatar)) return null;
    capsule.setAttribute('data-akisato-capsule', 'true');
    capsule.firstElementChild?.setAttribute('data-akisato-capsule-header', 'true');
    [...capsule.children].forEach((child) => {
      if (child !== capsule.firstElementChild
        && !child.hasAttribute('data-akisato-capsule-settings-view')) {
        child.setAttribute('data-akisato-capsule-bookmark-body', 'true');
      }
    });
    return capsule;
  };

  const releaseCapsuleExpansionRecovery = () => {
    cancelAnimationFrame(capsuleExpansionRecoveryFrame);
    window.clearTimeout(capsuleExpansionRecoveryTimer);
    capsuleExpansionRecoveryFrame = 0;
    capsuleExpansionRecoveryTimer = 0;
    capsuleExpansionRecoveryActive = false;
  };

  const releaseCapsuleExpansionRecoveryWhenStable = () => {
    cancelAnimationFrame(capsuleExpansionRecoveryFrame);
    window.clearTimeout(capsuleExpansionRecoveryTimer);
    const check = () => {
      capsuleExpansionRecoveryFrame = 0;
      const capsule = findBookmarkCapsule();
      if (capsule?.querySelector('[data-akisato-capsule-bookmark-body]')) {
        releaseCapsuleExpansionRecovery();
        return;
      }
      capsuleExpansionRecoveryFrame = requestAnimationFrame(check);
    };
    capsuleExpansionRecoveryFrame = requestAnimationFrame(check);
    capsuleExpansionRecoveryTimer = window.setTimeout(
      releaseCapsuleExpansionRecovery,
      420,
    );
  };

  const settingsControlSelector = 'button,input,select,textarea';
  const wallpaperPresetSelector = 'img[src*="img.remit.ee/api/file/"]';
  const wallpaperPresetAttribute = 'data-akisato-wallpaper-preset-index';
  const settingsControlIndexAttribute = 'data-akisato-settings-control-index';
  const settingsPortalAttribute = 'data-akisato-settings-portal';
  const settingsPortalLockAttribute = 'data-akisato-settings-portal-lock';
  const settingsPortalWidthProperty = '--akisato-settings-portal-width';
  const settingsViewEnteredAttribute = 'data-akisato-settings-view-entered';
  const bookmarkToggleIcon = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>';

  const removeSettingsMirror = () => {
    settingsMirrorView?.remove();
    settingsMirrorView = null;
    settingsMirrorPanel = null;
  };

  const findNativeSettingsCloseButton = () => {
    const panel = settingsMirrorPanel || findSettingsModal()?.panel;
    return panel
      ?.querySelector('.ui-modal-title')
      ?.parentElement
      ?.querySelector('button');
  };

  const closeNativeSettings = (closeButton = findNativeSettingsCloseButton()) => {
    closeButton?.click();
  };

  const suppressSettingsSync = () => {
    settingsSyncSuppressed = true;
  };

  const resumeSettingsSync = () => {
    settingsSyncSuppressed = false;
  };

  const clearSettingsOpenFromCollapsedPending = () => {
    window.clearTimeout(settingsOpenFromCollapsedTimer);
    settingsOpenFromCollapsedTimer = 0;
    settingsOpenFromCollapsedPending = false;
  };

  const beginSettingsOpenFromCollapsed = () => {
    window.clearTimeout(settingsOpenFromCollapsedTimer);
    settingsOpenFromCollapsedPending = true;
    settingsOpenFromCollapsedTimer = window.setTimeout(() => {
      settingsOpenFromCollapsedTimer = 0;
      settingsOpenFromCollapsedPending = false;
      scheduleSettingsCapsuleSync();
    }, 700);
  };

  const resetSettingsCapsuleView = (capsule = findBookmarkCapsule()) => {
    const root = document.documentElement;
    clearSettingsOpenFromCollapsedPending();
    window.clearTimeout(settingsViewEntranceTimer);
    settingsViewEntranceTimer = 0;
    root.style.removeProperty(settingsPortalWidthProperty);
    root.removeAttribute(settingsViewEnteredAttribute);
    root.removeAttribute('data-akisato-settings-open');
    removeSettingsMirror();
    if (capsule) syncCapsuleHeaderMode(capsule, false);
  };

  const completeSettingsViewEntrance = () => {
    window.clearTimeout(settingsViewEntranceTimer);
    settingsViewEntranceTimer = 0;
    const root = document.documentElement;
    if (root.hasAttribute('data-akisato-settings-open')) {
      root.setAttribute(settingsViewEnteredAttribute, 'true');
    }
  };

  const animateBookmarkReturn = (capsule) => {
    requestAnimationFrame(() => {
      if (!capsule || document.documentElement.hasAttribute('data-akisato-settings-open')) return;
      const body = capsule.querySelector('[data-akisato-capsule-bookmark-body]');
      if (!body) return;
      body.getAnimations?.()
        .filter((animation) => animation.id === 'akisato-bookmark-return')
        .forEach((animation) => animation.cancel());
      const animation = body.animate([
        { opacity: 0.76, translate: '0 5px' },
        { opacity: 1, translate: '0 0' },
      ], {
        duration: 230,
        easing: 'cubic-bezier(.22,.8,.36,1)',
      });
      animation.id = 'akisato-bookmark-return';
    });
  };

  const exitSettingsCapsule = (capsule = findBookmarkCapsule(), animateBookmarks = false) => {
    const closeButton = findNativeSettingsCloseButton();
    clearCapsuleThemeStateLock();
    suppressSettingsSync();
    // Switch the visible capsule first. Closing the hidden React controller
    // happens afterwards and no longer blocks the button response.
    resetSettingsCapsuleView(capsule);
    if (animateBookmarks) animateBookmarkReturn(capsule);
    closeNativeSettings(closeButton);
  };

  const syncCapsuleHeaderMode = (capsule, settingsOpen) => {
    const taggedToggle = capsule.querySelector('[data-akisato-capsule-mode-toggle]');
    const settingsButtons = [...capsule.querySelectorAll('button[aria-label="打开设置"]')];
    const toggleButton = taggedToggle?.parentElement?.querySelector('button[title="新建书签"]')
      ? taggedToggle
      : settingsButtons.find((button) => button.parentElement?.querySelector('button[title="新建书签"]'))
        || settingsButtons.at(-1);
    if (!toggleButton) return;

    capsule.querySelectorAll('[data-akisato-capsule-mode-toggle]').forEach((button) => {
      if (button !== toggleButton) button.removeAttribute('data-akisato-capsule-mode-toggle');
    });
    toggleButton.setAttribute('data-akisato-capsule-mode-toggle', 'true');
    if (!toggleButton.__akisatoOriginalMarkup) {
      toggleButton.__akisatoOriginalMarkup = toggleButton.innerHTML;
      toggleButton.__akisatoOriginalTitle = toggleButton.getAttribute('title') || '';
      toggleButton.__akisatoOriginalAriaLabel = toggleButton.getAttribute('aria-label') || '';
    }

    const controls = toggleButton.parentElement;
    const title = controls?.parentElement?.querySelector(':scope > span');
    const addButton = controls?.querySelector('button[title="新建书签"]');
    const themeButton = controls?.querySelector('button[aria-label="切换主题"]');
    const buttons = controls ? [...controls.children].filter((element) => element.tagName === 'BUTTON') : [];
    const closeButton = buttons.at(-1);

    title?.setAttribute('data-akisato-capsule-title', 'true');
    addButton?.setAttribute('data-akisato-capsule-add-bookmark', 'true');
    themeButton?.setAttribute('data-akisato-capsule-theme', 'true');
    closeButton?.setAttribute('data-akisato-capsule-close', 'true');

    const nextMode = settingsOpen ? 'settings' : 'bookmarks';
    const modeChanged = toggleButton.getAttribute('data-akisato-capsule-mode') !== nextMode;
    const nextTitle = settingsOpen ? '个性化设置' : '我的书签';
    if (title && title.textContent !== nextTitle) {
      title.textContent = nextTitle;
      title.animate?.([
        { opacity: 0.25, transform: 'translateY(4px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ], { duration: 230, easing: 'cubic-bezier(.22,.8,.36,1)' });
    }
    toggleButton.setAttribute('data-akisato-capsule-mode', nextMode);

    if (settingsOpen) {
      if (modeChanged || toggleButton.getAttribute('aria-label') !== '打开书签') {
        toggleButton.innerHTML = bookmarkToggleIcon;
      }
      toggleButton.setAttribute('title', '返回书签');
      toggleButton.setAttribute('aria-label', '打开书签');
      return;
    }

    if (modeChanged || toggleButton.getAttribute('aria-label') !== toggleButton.__akisatoOriginalAriaLabel) {
      toggleButton.innerHTML = toggleButton.__akisatoOriginalMarkup;
    }
    toggleButton.setAttribute('title', toggleButton.__akisatoOriginalTitle);
    toggleButton.setAttribute('aria-label', toggleButton.__akisatoOriginalAriaLabel);
  };

  const sourceControlFor = (mirrorControl) => {
    if (!settingsMirrorPanel) return null;
    const index = Number(mirrorControl.getAttribute(settingsControlIndexAttribute));
    return settingsMirrorPanel.querySelectorAll(settingsControlSelector)[index] || null;
  };

  const setNativeControlProperty = (control, property, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), property);
    if (descriptor?.set) descriptor.set.call(control, value);
    else control[property] = value;
  };

  const lockSettingsCapsuleWidth = (capsule = findBookmarkCapsule()) => {
    const root = document.documentElement;
    if (!capsule || !root.hasAttribute('data-akisato-settings-open')) return;
    if (root.style.getPropertyValue(settingsPortalWidthProperty)) return;
    const width = capsule.getBoundingClientRect().width;
    if (width > 0) root.style.setProperty(settingsPortalWidthProperty, `${width}px`);
  };

  const releaseSettingsCapsuleWidth = () => {
    document.documentElement.style.removeProperty(settingsPortalWidthProperty);
  };

  const restoreSettingsCapsuleExpansion = (portalWasLocked = false) => {
    const root = document.documentElement;
    const portalTransitionActive = portalWasLocked
      || root.hasAttribute(settingsPortalLockAttribute);
    if (capsuleExpansionRecoveryActive
      || !portalTransitionActive
      || !root.hasAttribute('data-akisato-settings-open')
      || !settingsMirrorView?.isConnected) return false;

    const capsule = findBookmarkCapsule();
    if (!capsule || capsule.querySelector('[data-akisato-capsule-bookmark-body]')) return false;
    const avatarToggle = capsule.querySelector('img[alt="Avatar"]')
      ?.parentElement
      ?.parentElement;
    if (!avatarToggle) return false;

    // Picker portals are outside the native capsule, so the original page may
    // treat their clicks as outside clicks and collapse its internal state.
    // Toggle it back during the same mutation checkpoint, before that mixed
    // collapsed-header/settings-body state can be painted.
    capsuleExpansionRecoveryActive = true;
    try {
      avatarToggle.click();
    } finally {
      releaseCapsuleExpansionRecoveryWhenStable();
      scheduleSettingsCapsuleSync();
    }
    return true;
  };

  const tagSettingsColorPortals = () => {
    let foundPicker = false;
    [...document.body.children].forEach((element) => {
      if (!(element instanceof HTMLElement)) return;
      const isPicker = Boolean(element.querySelector('input[placeholder="#HEX or gradient"]'));
      const isPickerBackdrop = element.classList.contains('z-[9998]')
        && element.classList.contains('inset-0')
        && element.classList.contains('bg-transparent');
      if (!isPicker && !isPickerBackdrop) return;
      element.setAttribute(settingsPortalAttribute, 'color-picker');
      if (isPicker) foundPicker = true;
    });
    if (foundPicker) {
      lockSettingsCapsuleWidth();
      document.documentElement.setAttribute(settingsPortalLockAttribute, 'true');
    }
    return foundPicker;
  };

  const isSettingsColorPickerOpen = () => Boolean(
    document.querySelector('input[placeholder="#HEX or gradient"]'),
  );

  const syncSettingsPortalLock = () => {
    tagSettingsColorPortals();
    const hasActivePortal = isSettingsColorPickerOpen()
      || Boolean(document.querySelector(`[${settingsPortalAttribute}]`));
    document.documentElement.toggleAttribute(settingsPortalLockAttribute, hasActivePortal);
    if (!hasActivePortal) releaseSettingsCapsuleWidth();
  };

  const tagSettingsColorPortalsWhenMounted = () => {
    let remainingFrames = 8;
    const tag = () => {
      if (tagSettingsColorPortals()) return;
      if (remainingFrames <= 0) {
        document.documentElement.removeAttribute(settingsPortalLockAttribute);
        return;
      }
      remainingFrames -= 1;
      requestAnimationFrame(tag);
    };
    requestAnimationFrame(tag);
  };

  const clickMirroredSourceControl = (mirrorControl, sourceControl) => {
    const isColorTrigger = mirrorControl.matches('.color-trigger')
      && sourceControl.matches('.color-trigger');
    if (!isColorTrigger) {
      sourceControl.click();
      return;
    }

    mirrorControl.setAttribute('data-akisato-color-trigger', 'true');
    // Once the user can interact with the color control, the settings page is
    // already established. Keep that page in its settled state while React
    // mounts and removes the body-level picker portal.
    completeSettingsViewEntrance();
    lockSettingsCapsuleWidth(mirrorControl.closest('[data-akisato-capsule]'));
    document.documentElement.setAttribute(settingsPortalLockAttribute, 'true');
    const visibleRect = mirrorControl.getBoundingClientRect();
    const ownRectDescriptor = Object.getOwnPropertyDescriptor(sourceControl, 'getBoundingClientRect');
    Object.defineProperty(sourceControl, 'getBoundingClientRect', {
      configurable: true,
      value: () => visibleRect,
    });
    try {
      // The original React handler reads its ref rect synchronously here.
      sourceControl.click();
    } finally {
      if (ownRectDescriptor) {
        Object.defineProperty(sourceControl, 'getBoundingClientRect', ownRectDescriptor);
      } else {
        delete sourceControl.getBoundingClientRect;
      }
    }
    tagSettingsColorPortalsWhenMounted();
  };

  const copyMirrorAttributes = (source, mirror) => {
    [...mirror.attributes].forEach((attribute) => {
      if (attribute.name.startsWith('data-akisato-')) return;
      if (!source.hasAttribute(attribute.name)) mirror.removeAttribute(attribute.name);
    });
    [...source.attributes].forEach((attribute) => {
      if (mirror.getAttribute(attribute.name) !== attribute.value) {
        mirror.setAttribute(attribute.name, attribute.value);
      }
    });
  };

  const syncMirrorNodes = (sourceParent, mirrorParent) => {
    const sourceNodes = [...sourceParent.childNodes];
    const mirrorNodes = [...mirrorParent.childNodes];
    if (sourceNodes.length !== mirrorNodes.length) return false;

    for (let index = 0; index < sourceNodes.length; index += 1) {
      const source = sourceNodes[index];
      const mirror = mirrorNodes[index];
      if (source.nodeType !== mirror.nodeType) return false;
      if (source.nodeType === Node.TEXT_NODE) {
        if (mirror.nodeValue !== source.nodeValue) mirror.nodeValue = source.nodeValue;
        continue;
      }
      if (!(source instanceof Element) || !(mirror instanceof Element)
        || source.tagName !== mirror.tagName) return false;

      copyMirrorAttributes(source, mirror);
      if (source instanceof HTMLInputElement) {
        if (mirror.value !== source.value) mirror.value = source.value;
        mirror.checked = source.checked;
        mirror.disabled = source.disabled;
      } else if (source instanceof HTMLTextAreaElement || source instanceof HTMLSelectElement) {
        if (mirror.value !== source.value) mirror.value = source.value;
        mirror.disabled = source.disabled;
      }
      if (!syncMirrorNodes(source, mirror)) return false;
    }
    return true;
  };

  const buildSettingsMirror = (capsule, panel) => {
    const scrollTop = settingsMirrorView?.scrollTop || 0;
    removeSettingsMirror();

    const view = document.createElement('div');
    view.setAttribute('data-akisato-capsule-settings-view', 'true');
    [...panel.childNodes].forEach((node) => view.appendChild(node.cloneNode(true)));
    view.firstElementChild?.setAttribute('data-akisato-settings-view-titlebar', 'true');
    [...view.querySelectorAll(settingsControlSelector)].forEach((control, index) => {
      control.setAttribute(settingsControlIndexAttribute, String(index));
    });

    // Wallpaper presets are clickable cards rather than form controls. Clone
    // their click target explicitly so the two remote presets remain usable in
    // the in-capsule settings mirror.
    const sourceWallpaperGrid = panel.querySelector(wallpaperPresetSelector)?.closest('.grid');
    const mirrorWallpaperGrid = view.querySelector(wallpaperPresetSelector)?.closest('.grid');
    const sourceWallpaperCards = sourceWallpaperGrid
      ? [...sourceWallpaperGrid.children]
      : [...panel.querySelectorAll(wallpaperPresetSelector)]
        .map((image) => image.closest('.relative'))
        .filter(Boolean);
    const mirrorWallpaperCards = mirrorWallpaperGrid
      ? [...mirrorWallpaperGrid.children]
      : [...view.querySelectorAll(wallpaperPresetSelector)]
        .map((image) => image.closest('.relative'))
        .filter(Boolean);
    sourceWallpaperCards.forEach((sourceCard, index) => {
      const mirrorCard = mirrorWallpaperCards[index];
      if (mirrorCard) mirrorCard.setAttribute(wallpaperPresetAttribute, String(index));
      sourceCard.setAttribute(wallpaperPresetAttribute, String(index));
    });

    view.addEventListener('click', (event) => {
      const mirrorWallpaperCard = event.target.closest?.(`[${wallpaperPresetAttribute}]`);
      if (mirrorWallpaperCard) {
        const index = Number(mirrorWallpaperCard.getAttribute(wallpaperPresetAttribute));
        const sourceWallpaperCard = sourceWallpaperCards[index];
        if (sourceWallpaperCard) {
          event.preventDefault();
          event.stopPropagation();
          sourceWallpaperCard.click();
          window.setTimeout(scheduleSettingsCapsuleSync, 0);
        }
        return;
      }
      const mirrorControl = event.target.closest?.(`[${settingsControlIndexAttribute}]`);
      const sourceControl = mirrorControl && sourceControlFor(mirrorControl);
      if (!sourceControl || sourceControl.disabled) return;
      if (sourceControl instanceof HTMLButtonElement || sourceControl.type === 'file') {
        event.preventDefault();
        event.stopPropagation();
        clickMirroredSourceControl(mirrorControl, sourceControl);
        window.setTimeout(scheduleSettingsCapsuleSync, 0);
      }
    });

    const proxyValueChange = (event) => {
      const mirrorControl = event.target.closest?.(`[${settingsControlIndexAttribute}]`);
      const sourceControl = mirrorControl && sourceControlFor(mirrorControl);
      if (!sourceControl || sourceControl.disabled || sourceControl instanceof HTMLButtonElement) return;
      if ('checked' in sourceControl) setNativeControlProperty(sourceControl, 'checked', mirrorControl.checked);
      if ('value' in sourceControl) setNativeControlProperty(sourceControl, 'value', mirrorControl.value);
      sourceControl.dispatchEvent(new Event(event.type, { bubbles: true }));
      window.setTimeout(scheduleSettingsCapsuleSync, 0);
    };
    view.addEventListener('input', proxyValueChange);
    view.addEventListener('change', proxyValueChange);

    settingsMirrorView = view;
    settingsMirrorPanel = panel;
    capsule.appendChild(view);
    view.scrollTop = scrollTop;
  };

  const ensureSettingsMirror = (capsule, panel) => {
    if (!settingsMirrorView || settingsMirrorPanel !== panel
      || settingsMirrorView.parentElement !== capsule) {
      buildSettingsMirror(capsule, panel);
      return;
    }
    if (!syncMirrorNodes(panel, settingsMirrorView)) buildSettingsMirror(capsule, panel);
  };

  const prepareNativeSettingsModal = (modal) => {
    if (!modal) return;
    modal.panel.setAttribute('data-akisato-settings-panel', 'true');
    modal.frame.setAttribute('data-akisato-settings-frame', 'true');
    modal.frame.setAttribute('aria-hidden', 'true');
    modal.backdrop?.setAttribute('data-akisato-settings-backdrop', 'true');
    modal.backdrop?.setAttribute('aria-hidden', 'true');
  };

  const showSettingsCapsule = (capsule, modal) => {
    const root = document.documentElement;
    clearSettingsOpenFromCollapsedPending();
    const side = capsule.classList.contains('right-4') ? 'right' : 'left';
    prepareNativeSettingsModal(modal);
    root.setAttribute('data-akisato-capsule-side', side);
    root.setAttribute('data-akisato-settings-open', 'true');
    syncCapsuleHeaderMode(capsule, true);
    ensureSettingsMirror(capsule, modal.panel);
    if (!root.hasAttribute(settingsViewEnteredAttribute) && !settingsViewEntranceTimer) {
      settingsViewEntranceTimer = window.setTimeout(completeSettingsViewEntrance, 280);
    }
  };

  const syncSettingsCapsule = () => {
    const root = document.documentElement;
    const capsule = findBookmarkCapsule();
    const modal = findSettingsModal();
    const colorPickerOpen = isSettingsColorPickerOpen();
    const portalLocked = colorPickerOpen || root.hasAttribute(settingsPortalLockAttribute);
    const themeTransitionActive = isCapsuleThemeTransitionActive();
    const settingsThemeLocked = themeTransitionActive
      && capsuleThemeTransitionMode === 'settings';
    if (settingsThemeLocked && capsule) {
      // React rebuilds the header and hidden settings controller independently.
      // Reassert the visible mode in the mutation frame so bookmarks can never
      // flash in between those two updates.
      root.setAttribute('data-akisato-settings-open', 'true');
      syncCapsuleHeaderMode(capsule, true);
    }
    if (colorPickerOpen) root.setAttribute(settingsPortalLockAttribute, 'true');
    prepareNativeSettingsModal(modal);
    if (settingsSyncSuppressed) {
      resetSettingsCapsuleView(capsule);
      // Do not release on a fixed timeout: React may keep the closing modal
      // mounted for longer than one animation frame. Wait until it is gone,
      // or until the user explicitly opens settings again.
      if (!modal) resumeSettingsSync();
      return;
    }
    if (!capsule || !modal) {
      // React may briefly replace the hidden controller while a portal control
      // updates. Never interpret that transient gap as a request to close.
      if (portalLocked || themeTransitionActive) return;
      if (settingsOpenFromCollapsedPending) return;
      resetSettingsCapsuleView(capsule);
      return;
    }

    // The settings view must never establish the expanded height by itself.
    // Wait until the capsule's native bookmark body exists, which also means
    // the native expansion has supplied the correct expanded width.
    if (!capsule.querySelector('[data-akisato-capsule-bookmark-body]')) {
      if (portalLocked) {
        // Color-picker updates may temporarily replace the native bookmark
        // body. Do not interpret that transient gap as a real settings exit;
        // the mutation observer restores native expansion in the same update.
        return;
      }
      if (themeTransitionActive) return;
      if (settingsOpenFromCollapsedPending) return;
      // The capsule has genuinely collapsed outside a picker transition.
      // Close the hidden native settings controller as well as the mirror;
      // otherwise that stale modal reopens settings on the next avatar click.
      exitSettingsCapsule(capsule);
      return;
    }

    showSettingsCapsule(capsule, modal);
  };

  const scheduleSettingsCapsuleSync = () => {
    cancelAnimationFrame(scheduleSettingsCapsuleSync.frame);
    scheduleSettingsCapsuleSync.frame = requestAnimationFrame(syncSettingsCapsule);
  };

  const enableSettingsCapsule = () => {
    const observer = new MutationObserver(() => {
      // Tag the old modal in the mutation microtask, before the browser can
      // paint it. The frame is then permanently hidden by CSS.
      prepareNativeSettingsModal(findSettingsModal());
      const portalWasLocked = document.documentElement.hasAttribute(settingsPortalLockAttribute);
      syncSettingsPortalLock();
      restoreSettingsCapsuleExpansion(portalWasLocked);
      scheduleSettingsCapsuleSync();
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    document.addEventListener('click', (event) => {
      const root = document.documentElement;
      const capsule = findBookmarkCapsule();
      const modeToggle = event.target.closest?.('[data-akisato-capsule-mode-toggle]')
        || event.composedPath?.().find((node) => node instanceof Element
          && node.matches('[data-akisato-capsule-mode-toggle]'));
      const settingsMode = root.hasAttribute('data-akisato-settings-open')
        || modeToggle?.getAttribute('aria-label') === '打开书签';

      if (settingsMode && event.isTrusted && isSettingsColorPickerOpen()) {
        // The real picker is a stronger signal than asynchronously applied
        // portal tags. Its own backdrop decides when only the picker closes.
        tagSettingsColorPortals();
        return;
      }

      if (settingsMode && event.isTrusted && root.hasAttribute(settingsPortalLockAttribute)) {
        // Re-tag synchronously in case this is the first pointer event after
        // React mounted the portal but before the mutation callback ran.
        tagSettingsColorPortals();
        if (event.target.closest?.(`[${settingsPortalAttribute}]`)) return;
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      if (modeToggle && settingsMode) {
        event.preventDefault();
        event.stopPropagation();
        exitSettingsCapsule(capsule, true);
        return;
      }

      // Mirrored settings controls dispatch programmatic clicks to their
      // hidden native counterparts. Those are not outside-click gestures.
      if (!settingsMode || !event.isTrusted) return;

      // Color controls render through a body-level React portal. Treat that
      // portal as part of the settings capsule so its own controls stay live.
      if (event.target.closest?.(`[${settingsPortalAttribute}]`)) return;

      if (event.target.closest?.('[data-akisato-capsule-close]')) {
        exitSettingsCapsule(capsule);
        return;
      }

      const avatar = event.target.closest?.('img[alt="Avatar"]');
      if (avatar) {
        // In settings, the avatar acts like the bookmarks mode button: switch
        // pages but keep the capsule open. A later avatar click from bookmarks
        // is left to the native component and closes the capsule normally.
        event.preventDefault();
        event.stopPropagation();
        exitSettingsCapsule(capsule, true);
        return;
      }

      if (capsule && !capsule.contains(event.target)) {
        // An actual outside click still closes the settings state together
        // with the capsule's native collapse animation.
        exitSettingsCapsule(capsule);
      }
    }, true);

    document.addEventListener('click', (event) => {
      const settingsButton = event.target.closest?.('[aria-label="打开设置"]');
      if (!settingsButton) {
        scheduleSettingsCapsuleSync();
        return;
      }

      // Opening settings is an intentional mode change. It must supersede a
      // still-running theme reconstruction lock from the bookmarks page.
      clearCapsuleThemeStateLock();
      resumeSettingsSync();
      // Let the existing React handler open settings first, then expand the
      // same capsule on the next tick when it was collapsed.
      const capsule = settingsButton.closest('[data-akisato-capsule="true"]') || findBookmarkCapsule();
      const wasCollapsed = !capsule?.querySelector('[data-akisato-capsule-bookmark-body]');
      const modal = findSettingsModal();
      if (capsule && !wasCollapsed && modal) showSettingsCapsule(capsule, modal);
      if (capsule && wasCollapsed) {
        beginSettingsOpenFromCollapsed();
        window.setTimeout(() => {
          const avatar = capsule.querySelector('img[alt="Avatar"]');
          avatar?.parentElement?.parentElement?.click();
          scheduleSettingsCapsuleSync();
        }, 0);
      }
      scheduleSettingsCapsuleSync();
    });

    document.addEventListener('input', scheduleSettingsCapsuleSync, true);
    document.addEventListener('change', scheduleSettingsCapsuleSync, true);

    window.addEventListener('resize', scheduleSettingsCapsuleSync, { passive: true });
    scheduleSettingsCapsuleSync();
  };

  const enableCapsuleThemeClickGuard = () => {
    let guardUntil = 0;
    let lastThemeRect = null;

    const expandedThemeButton = (capsule) => [...(capsule?.querySelectorAll('button[aria-label="切换主题"]') || [])]
      .find((button) => button.parentElement?.querySelector('button[title="新建书签"]'));
    const rememberThemeButton = (button) => {
      const rect = button.getBoundingClientRect();
      lastThemeRect = {
        left: rect.left - 6,
        right: rect.right + 6,
        top: rect.top - 6,
        bottom: rect.bottom + 6,
      };
    };

    const pointStayedOnTheme = (event) => lastThemeRect
      && isCapsuleThemeTransitionActive()
      && event.clientX >= lastThemeRect.left
      && event.clientX <= lastThemeRect.right
      && event.clientY >= lastThemeRect.top
      && event.clientY <= lastThemeRect.bottom;

    const restoreThemeCapsuleExpansion = () => {
      if (capsuleExpansionRecoveryActive || !isCapsuleThemeTransitionActive()) return;
      const capsule = findBookmarkCapsule();
      if (!capsule) return;

      if (capsuleThemeTransitionMode === 'settings') {
        // The settings mirror is outside React's state. Restore its mode in the
        // mutation checkpoint before a rebuilt bookmarks header can be painted.
        document.documentElement.setAttribute('data-akisato-settings-open', 'true');
        syncCapsuleHeaderMode(capsule, true);
      }

      if (capsule.querySelector('[data-akisato-capsule-bookmark-body]')) return;
      const avatarToggle = capsule.querySelector('img[alt="Avatar"]')
        ?.parentElement
        ?.parentElement;
      if (!avatarToggle) return;

      // Theme changes replace parts of the capsule tree. If the original
      // component drops its expanded state during that rebuild, restore it in
      // the same mutation checkpoint so rapid clicks never see a closed pill.
      capsuleExpansionRecoveryActive = true;
      try {
        avatarToggle.click();
      } finally {
        releaseCapsuleExpansionRecoveryWhenStable();
      }
    };

    // Use the window capture phase so a rapid follow-up click is filtered
    // before the document-level settings/bookmarks switcher can see it.
    window.addEventListener('pointerdown', (event) => {
      if (!event.isTrusted || event.button !== 0) return;
      const capsule = findBookmarkCapsule();
      const themeButton = event.target.closest?.('button[aria-label="切换主题"]');
      if (themeButton && themeButton === expandedThemeButton(capsule)) {
        if (Date.now() < guardUntil) {
          event.preventDefault();
          event.stopImmediatePropagation();
          event.stopPropagation();
          return;
        }
        rememberThemeButton(themeButton);
        return;
      }
      if (pointStayedOnTheme(event)) {
        // During a theme rebuild the pointer may land on a transient collapsed
        // header or the page behind it. Keep that pointerdown away from native
        // outside-click logic until the expanded theme button is stable again.
        event.preventDefault();
        event.stopImmediatePropagation();
        event.stopPropagation();
      }
    }, true);

    window.addEventListener('click', (event) => {
      if (!event.isTrusted) return;
      const capsule = findBookmarkCapsule();
      const themeButton = event.target.closest?.('button[aria-label="切换主题"]');
      if (themeButton && themeButton === expandedThemeButton(capsule)) {
        if (Date.now() < guardUntil) {
          event.preventDefault();
          event.stopImmediatePropagation();
          event.stopPropagation();
          return;
        }
        rememberThemeButton(themeButton);
        guardUntil = Date.now() + capsuleThemeClickCooldown;
        beginCapsuleThemeStateLock(capsule);
        return;
      }

      const intentionalCapsuleToggle = event.target.closest?.([
        'img[alt="Avatar"]',
        '[data-akisato-capsule-close]',
        '[data-akisato-capsule-mode-toggle]',
      ].join(','));
      const intentionalOutsideClick = capsule && !capsule.contains(event.target);
      if ((intentionalCapsuleToggle || intentionalOutsideClick)
        && !pointStayedOnTheme(event)) {
        // Explicit navigation/closing wins over the temporary state lock. A
        // second click at the old theme coordinates is excluded above because
        // it is a transient hit target, not an intentional outside click.
        clearCapsuleThemeStateLock();
        return;
      }

      if (!pointStayedOnTheme(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
    }, true);

    window.addEventListener('dblclick', (event) => {
      if (!event.isTrusted || !pointStayedOnTheme(event)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      event.stopPropagation();
    }, true);

    new MutationObserver(() => {
      restoreThemeCapsuleExpansion();
    }).observe(document.body, {
      childList: true,
      subtree: true,
    });
  };

  const renderOffsetControl = (control) => {
    const range = control.querySelector('input');
    const value = control.querySelector('.akisato-search-offset-value');
    const offset = readSearchOffset();
    range.value = String(offset);
    value.textContent = `${offset > 0 ? '+' : ''}${offset}px`;
  };

  const injectSearchOffsetControl = () => {
    const label = [...document.querySelectorAll('.settings-label')]
      .find((element) => !element.closest('[data-akisato-capsule-settings-view]')
        && element.textContent.trim() === '搜索框位置');
    const row = label?.parentElement;
    if (!row) return;

    const existing = row.parentElement.querySelector('.akisato-search-offset-control');
    if (existing) {
      renderOffsetControl(existing);
      return;
    }

    const control = document.createElement('div');
    control.className = 'akisato-search-offset-control pt-2 border-t border-slate-200/50 dark:border-white/10';
    control.innerHTML = [
      '<div class="flex items-center justify-between mb-2">',
      '<span class="settings-label text-xs font-bold text-slate-600 dark:text-slate-300">搜索框垂直偏移</span>',
      '<span class="akisato-search-offset-value text-xs text-slate-500 font-mono"></span>',
      '</div>',
      `<input class="w-full accent-blue-500" type="range" min="-${offsetLimit}" max="${offsetLimit}" step="${offsetStep}">`,
    ].join('');

    const range = control.querySelector('input');
    range.addEventListener('input', () => {
      const position = readSearchPosition();
      const offset = applySearchOffset(range.value, position);
      localStorage.setItem(offsetKeyFor(position), String(offset));
      renderOffsetControl(control);
    });

    row.insertAdjacentElement('afterend', control);
    renderOffsetControl(control);
  };

  const renderCapsuleHeightControl = (control) => {
    const range = control.querySelector('input');
    const value = control.querySelector('.akisato-capsule-height-value');
    const height = readCapsuleHeight();
    range.value = String(height);
    value.textContent = `${height}vh`;
  };

  const injectCapsuleHeightControl = () => {
    const label = [...document.querySelectorAll('.settings-label')]
      .find((element) => !element.closest('[data-akisato-capsule-settings-view]')
        && element.textContent.trim() === '顶部胶囊位置');
    const row = label?.parentElement;
    if (!row) return;

    const existing = row.parentElement.querySelector('.akisato-capsule-height-control');
    if (existing) {
      renderCapsuleHeightControl(existing);
      return;
    }

    const control = document.createElement('div');
    control.className = 'akisato-capsule-height-control pt-2 border-t border-slate-200/50 dark:border-white/10';
    control.innerHTML = [
      '<div class="flex items-center justify-between mb-2">',
      '<span class="settings-label text-xs font-bold text-slate-600 dark:text-slate-300">胶囊展开高度</span>',
      '<span class="akisato-capsule-height-value text-xs text-slate-500 font-mono"></span>',
      '</div>',
      `<input class="w-full accent-blue-500" type="range" min="${capsuleHeightMin}" max="${capsuleHeightMax}" step="${capsuleHeightStep}">`,
    ].join('');

    const range = control.querySelector('input');
    range.addEventListener('input', () => {
      const height = applyCapsuleHeight(range.value);
      localStorage.setItem(capsuleHeightKey, String(height));
      renderCapsuleHeightControl(control);
    });

    row.insertAdjacentElement('afterend', control);
    renderCapsuleHeightControl(control);
  };

  const renderSubmenuHeightControl = (control) => {
    const range = control.querySelector('input');
    const value = control.querySelector('.akisato-submenu-height-value');
    const height = readSubmenuHeight();
    range.value = String(height);
    value.textContent = `${height}vh`;
  };

  const injectSubmenuHeightControl = () => {
    const label = [...document.querySelectorAll('.settings-label')]
      .find((element) => !element.closest('[data-akisato-capsule-settings-view]')
        && element.textContent.trim() === '顶部胶囊位置');
    const row = label?.parentElement;
    if (!row) return;

    const existing = row.parentElement.querySelector('.akisato-submenu-height-control');
    if (existing) {
      renderSubmenuHeightControl(existing);
      return;
    }

    const control = document.createElement('div');
    control.className = 'akisato-submenu-height-control pt-2 border-t border-slate-200/50 dark:border-white/10';
    control.innerHTML = [
      '<div class="flex items-center justify-between mb-2">',
      '<span class="settings-label text-xs font-bold text-slate-600 dark:text-slate-300">书签二级菜单高度</span>',
      '<span class="akisato-submenu-height-value text-xs text-slate-500 font-mono"></span>',
      '</div>',
      `<input class="w-full accent-blue-500" type="range" min="${submenuHeightMin}" max="${submenuHeightMax}" step="${submenuHeightStep}">`,
    ].join('');

    const range = control.querySelector('input');
    range.addEventListener('input', () => {
      const height = applySubmenuHeight(range.value);
      localStorage.setItem(submenuHeightKey, String(height));
      renderSubmenuHeightControl(control);
    });

    const capsuleHeightControl = row.parentElement.querySelector('.akisato-capsule-height-control');
    (capsuleHeightControl || row).insertAdjacentElement('afterend', control);
    renderSubmenuHeightControl(control);
  };

  const syncUi = () => {
    applySearchOffset();
    applyCapsuleHeight();
    applySubmenuHeight();
    syncCardSizing();
    syncFavoriteSectionHeading();
    scheduleFavoriteFooterCollisionSync(360);
    injectSearchOffsetControl();
    injectCapsuleHeightControl();
    injectSubmenuHeightControl();
  };

  const scheduleUiSync = () => {
    cancelAnimationFrame(scheduledSync);
    scheduledSync = requestAnimationFrame(syncUi);
  };

  const start = () => {
    guardSearchSuggestions();
    enableCardReorderingAnimations();
    enableFavoriteSectionHeadingSync();
    enableFavoriteFooterCollision();
    enableBookmarkSubmenuBounds();
    enableSettingsCapsule();
    enableCapsuleThemeClickGuard();
    preventInitialSearchFocus();
    syncUi();

    window.addEventListener('resize', scheduleUiSync, { passive: true });
    document.addEventListener('input', (event) => {
      if (event.target.matches?.('input[type="range"]')) scheduleUiSync();
    }, true);
    document.addEventListener('click', () => {
      window.setTimeout(() => {
        applySearchOffset();
        applyCapsuleHeight();
        applySubmenuHeight();
        injectSearchOffsetControl();
        injectCapsuleHeightControl();
        injectSubmenuHeightControl();
      }, 0);
    }, true);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
