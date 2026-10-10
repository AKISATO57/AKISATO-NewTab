(() => {
  const storageKeys = ['user_bookmarks', 'my_links'];
  const browserBookmarkOverridesKey = 'akisato_browser_bookmark_overrides_v1';
  const bookmarkOverridesChangedEvent = 'akisato-bookmark-overrides-changed';
  const browserInternalProtocolPattern = /^(?:edge|chrome|brave|vivaldi|opera):/i;
  const accidentallyPrefixedSchemePattern = /^https?:\/\/([a-z][a-z0-9+.-]*:.*)$/i;
  const nativeOpen = window.open.bind(window);

  const readBrowserBookmarkOverrides = () => {
    try {
      const value = JSON.parse(localStorage.getItem(browserBookmarkOverridesKey) || '{}');
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch (_) {
      return {};
    }
  };

  let browserBookmarkOverrides = readBrowserBookmarkOverrides();

  const saveBrowserBookmarkOverrides = () => {
    localStorage.setItem(browserBookmarkOverridesKey, JSON.stringify(browserBookmarkOverrides));
  };

  const setBrowserBookmarkOverride = (id, changes) => {
    const key = String(id);
    browserBookmarkOverrides[key] = {
      ...(browserBookmarkOverrides[key] || {}),
      ...(Object.hasOwn(changes, 'title') ? { title: changes.title } : {}),
      ...(Object.hasOwn(changes, 'url') ? { url: changes.url } : {}),
    };
    saveBrowserBookmarkOverrides();
  };

  const clearAcceptedBrowserBookmarkOverride = (id, changes) => {
    const key = String(id);
    const override = browserBookmarkOverrides[key];
    if (!override) return;

    if (Object.hasOwn(changes, 'url')) {
      delete browserBookmarkOverrides[key];
    } else {
      if (Object.hasOwn(changes, 'title')) delete override.title;
      if (Object.keys(override).length === 0) delete browserBookmarkOverrides[key];
    }
    saveBrowserBookmarkOverrides();
  };

  const applyBrowserBookmarkOverrides = (nodes) => {
    const visit = (node) => {
      if (!node || typeof node !== 'object') return node;
      const override = browserBookmarkOverrides[String(node.id)] || null;
      return {
        ...node,
        ...(override || {}),
        ...(Array.isArray(node.children) ? { children: node.children.map(visit) } : {}),
      };
    };
    return Array.isArray(nodes) ? nodes.map(visit) : visit(nodes);
  };

  const getBrowserBookmarkTree = (bookmarks, callback) => {
    if (!bookmarks?.getTree) {
      callback?.([]);
      return undefined;
    }

    return bookmarks.getTree((tree) => callback?.(applyBrowserBookmarkOverrides(tree)));
  };

  const updateBrowserBookmark = (bookmarks, id, changes, callback) => {
    if (!bookmarks?.update) {
      callback?.();
      return undefined;
    }

    const nativeUpdate = bookmarks.update.bind(bookmarks);
    return nativeUpdate(id, changes, (node) => {
      const updateError = globalThis.chrome?.runtime?.lastError;
      if (!updateError) {
        clearAcceptedBrowserBookmarkOverride(id, changes);
        callback?.(applyBrowserBookmarkOverrides(node));
        return;
      }

      if (!Object.hasOwn(changes, 'url')) {
        callback?.(node);
        return;
      }

      setBrowserBookmarkOverride(id, changes);

      const completeFallbackSave = (updatedNode = node) => {
        globalThis.setTimeout(() => {
          callback?.(applyBrowserBookmarkOverrides({
            ...(updatedNode || {}),
            id: String(id),
            ...changes,
          }));
          window.dispatchEvent(new Event(bookmarkOverridesChangedEvent));
        }, 0);
      };

      if (Object.hasOwn(changes, 'title')) {
        nativeUpdate(id, { title: changes.title }, (titleOnlyNode) => {
          // Reading lastError prevents an expected browser warning if even the title update fails.
          void globalThis.chrome?.runtime?.lastError;
          completeFallbackSave(titleOnlyNode);
        });
        return;
      }

      completeFallbackSave();
    });
  };

  const restoreAccidentallyPrefixedScheme = (value) => {
    if (typeof value !== 'string') return value;
    const trimmed = value.trim();
    const match = trimmed.match(accidentallyPrefixedSchemePattern);
    return match ? match[1] : value;
  };

  const repairStoredUrls = (value) => {
    let changed = false;

    const visit = (item) => {
      if (Array.isArray(item)) {
        item.forEach(visit);
        return;
      }
      if (!item || typeof item !== 'object') return;

      if (typeof item.url === 'string') {
        const repairedUrl = restoreAccidentallyPrefixedScheme(item.url);
        if (repairedUrl !== item.url) {
          item.url = repairedUrl;
          changed = true;
        }
      }

      Object.values(item).forEach(visit);
    };

    visit(value);
    return changed;
  };

  const migratePreviouslyCorruptedUrls = () => {
    storageKeys.forEach((key) => {
      try {
        const serialized = localStorage.getItem(key);
        if (!serialized) return;
        const value = JSON.parse(serialized);
        if (repairStoredUrls(value)) {
          localStorage.setItem(key, JSON.stringify(value));
        }
      } catch (error) {
        console.warn(`AKISATO could not repair URLs in ${key}.`, error);
      }
    });
  };

  const showBlockedInternalUrl = (rawUrl) => {
    try {
      globalThis.navigator?.clipboard?.writeText(rawUrl).catch(() => {});
    } catch (_) {
      // Clipboard access is optional; the prompt still exposes the exact address.
    }
    window.prompt?.(
      '\u6d4f\u89c8\u5668\u963b\u6b62\u6269\u5c55\u76f4\u63a5\u6253\u5f00\u8be5\u5185\u90e8\u5730\u5740\uff0c\u8bf7\u590d\u5236\u540e\u7c98\u8d34\u5230\u5730\u5740\u680f\uff1a',
      rawUrl,
    );
  };

  const openRawUrl = (url, target, features) => {
    const rawUrl = typeof url === 'string' ? url : String(url ?? '');

    if (browserInternalProtocolPattern.test(rawUrl)) {
      const tabs = globalThis.chrome?.tabs;
      if (tabs?.update) {
        try {
          tabs.update({ url: rawUrl }, () => {
            if (globalThis.chrome?.runtime?.lastError) {
              if (tabs?.create) {
                tabs.create({ url: rawUrl }, () => {
                  if (!globalThis.chrome?.runtime?.lastError) return;
                  try {
                    window.location.assign(rawUrl);
                  } catch (_) {
                    // Chromium may reserve internal pages for browser-owned UI.
                  }
                  globalThis.setTimeout(() => showBlockedInternalUrl(rawUrl), 180);
                });
                return;
              }
              showBlockedInternalUrl(rawUrl);
            }
          });
          return null;
        } catch (_) {
          try {
            window.location.assign(rawUrl);
          } catch (_) {
            showBlockedInternalUrl(rawUrl);
          }
          return null;
        }
      }
    }

    return nativeOpen(rawUrl, target, features);
  };

  const openBackgroundUrl = (url) => {
    const rawUrl = typeof url === 'string' ? url : String(url ?? '');
    const tabs = globalThis.chrome?.tabs;

    if (tabs?.create) {
      try {
        tabs.create({ url: rawUrl, active: false }, () => {
          if (!globalThis.chrome?.runtime?.lastError) return;
          try {
            nativeOpen(rawUrl, '_blank');
          } catch (_) {
            // Keep the middle-click default action untouched even if navigation is blocked.
          }
        });
        return null;
      } catch (_) {
        // Fall through to the native new-window path.
      }
    }

    return nativeOpen(rawUrl, '_blank');
  };

  const capsuleMiddleMoveThreshold = 12;
  const capsuleMiddleSettleDelay = 50;
  let cancelPendingCapsuleMiddlePress = () => {};

  const handleCapsuleMiddlePress = (event, url) => {
    if (event?.button !== 1) return;
    cancelPendingCapsuleMiddlePress();

    const startX = Number(event.clientX) || 0;
    const startY = Number(event.clientY) || 0;
    let released = false;
    let openTimer = 0;
    let safetyTimer = 0;

    const movedBeyondThreshold = (moveEvent) => Math.hypot(
      (Number(moveEvent.clientX) || 0) - startX,
      (Number(moveEvent.clientY) || 0) - startY,
    ) > capsuleMiddleMoveThreshold;

    const cleanup = () => {
      globalThis.clearTimeout(openTimer);
      globalThis.clearTimeout(safetyTimer);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('mousemove', onMove, true);
      window.removeEventListener('pointerup', onRelease, true);
      window.removeEventListener('mouseup', onRelease, true);
      if (cancelPendingCapsuleMiddlePress === cleanup) {
        cancelPendingCapsuleMiddlePress = () => {};
      }
    };

    const onMove = (moveEvent) => {
      if (movedBeyondThreshold(moveEvent)) cleanup();
    };

    const onRelease = (releaseEvent) => {
      if (released || releaseEvent.button !== 1) return;
      released = true;
      if (movedBeyondThreshold(releaseEvent)) {
        cleanup();
        return;
      }
      openTimer = globalThis.setTimeout(() => {
        openTimer = 0;
        cleanup();
        openBackgroundUrl(url);
      }, capsuleMiddleSettleDelay);
    };

    cancelPendingCapsuleMiddlePress = cleanup;
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('mousemove', onMove, true);
    window.addEventListener('pointerup', onRelease, true);
    window.addEventListener('mouseup', onRelease, true);
    safetyTimer = globalThis.setTimeout(cleanup, 1800);
  };

  window.open = openRawUrl;
  globalThis.__AKISATO_OPEN_RAW_URL__ = openRawUrl;
  globalThis.__AKISATO_OPEN_BACKGROUND_URL__ = openBackgroundUrl;
  globalThis.__AKISATO_HANDLE_CAPSULE_MIDDLE_PRESS__ = handleCapsuleMiddlePress;
  globalThis.__AKISATO_GET_BROWSER_BOOKMARK_TREE__ = getBrowserBookmarkTree;
  globalThis.__AKISATO_UPDATE_BROWSER_BOOKMARK__ = updateBrowserBookmark;
  migratePreviouslyCorruptedUrls();
})();
