const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const projectRoot = path.resolve(__dirname, '..');
const indexSource = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf8');
const appSource = fs.readFileSync(path.join(projectRoot, 'app.js'), 'utf8');
const compatibilitySource = fs.readFileSync(path.join(projectRoot, 'url-compat.js'), 'utf8');
const enhancementSource = fs.readFileSync(path.join(projectRoot, 'ui-enhancements.js'), 'utf8');

assert.ok(
  indexSource.indexOf('url-compat.js') < indexSource.indexOf('app.js'),
  'URL compatibility must load before the application bundle',
);
assert.equal(
  appSource.includes('ze.url.trim().startsWith("http")?ze.url.trim():`https://${ze.url.trim()}`'),
  false,
  'bookmark saves must not force https://',
);
assert.equal(
  appSource.includes('W.url&&!W.url.startsWith("http")&&(W.url=`https://${W.url}`,x=!0)'),
  false,
  'startup migration must not force https://',
);
assert.equal(
  appSource.includes('x=ze.url.trim()'),
  false,
  'browser bookmark saves must receive the exact URL text',
);
assert.equal(
  appSource.includes('url:ze.url.trim()'),
  false,
  'local bookmark saves must preserve the exact URL text',
);
assert.ok(
  appSource.includes('window.addEventListener("akisato-bookmark-overrides-changed"'),
  'the bookmark tree must refresh after a browser-rejected URL is saved locally',
);
assert.ok(
  appSource.includes('globalThis.__AKISATO_UPDATE_BROWSER_BOOKMARK__(L,Wt.browserId'),
  'browser bookmark edits must directly call the compatibility save path',
);
assert.ok(
  appSource.includes('globalThis.__AKISATO_GET_BROWSER_BOOKMARK_TREE__(d,se=>'),
  'browser bookmark reads must directly apply local URL overrides',
);
assert.ok(
  appSource.includes('globalThis.__AKISATO_OPEN_RAW_URL__(d.url,"_blank")'),
  'bookmark clicks must directly use raw URL navigation',
);
assert.ok(
  enhancementSource.includes('wallpaperPresetSelector')
    && enhancementSource.includes('sourceWallpaperCard.click()'),
  'wallpaper preset cards must proxy clicks from the settings mirror',
);
assert.equal(
  appSource.includes('alert(`\\u521B\\u5EFA\\u6D4F\\u89C8\\u5668\\u4E66\\u7B7E\\u5931\\u8D25'),
  false,
  'a browser-rejected bookmark URL must fall back locally instead of showing Invalid URL',
);
assert.ok(
  appSource.includes('source:"manual"};hr([...tr,W]),S();return'),
  'the browser create fallback must actually persist the bookmark locally',
);
assert.ok(
  appSource.includes('onPointerDown:$=>{$.button===1?globalThis.__AKISATO_HANDLE_CAPSULE_MIDDLE_PRESS__($,r.url):a($,r)}'),
  'capsule bookmarks must distinguish a middle-click from an autoscroll movement gesture',
);
assert.ok(
  appSource.includes('onAuxClick:S=>{S.button===1&&globalThis.__AKISATO_OPEN_BACKGROUND_URL__(d.url)}'),
  'favorite cards must open in a background tab on middle click',
);
assert.ok(
  appSource.includes('onPointerDown:S=>{if(S.button===1){S.stopPropagation();return}let L,R;'),
  'favorite-card middle clicks must not start the drag interaction',
);

const storedValues = new Map([
  ['user_bookmarks', JSON.stringify([
    { id: 'edge-flags', url: 'https://edge://flags/' },
    { id: 'web', url: 'https://example.com/' },
  ])],
]);
const openedUrls = [];
const createdTabs = [];
const updatedTabs = [];
const dispatchedEvents = [];
const blockedInternalPrompts = [];
const windowEventListeners = new Map();
let simulatedLastError = null;
const browserTree = [{
  id: '0',
  children: [{ id: '42', title: 'Old title', url: 'https://example.com/' }],
}];

const context = {
  console,
  localStorage: {
    getItem: (key) => storedValues.get(key) ?? null,
    setItem: (key, value) => storedValues.set(key, value),
  },
  chrome: {
    runtime: {
      get lastError() {
        return simulatedLastError;
      },
    },
    bookmarks: {
      getTree: (callback) => callback(JSON.parse(JSON.stringify(browserTree))),
      update: (id, changes, callback) => {
        const bookmark = browserTree[0].children.find((item) => item.id === id);
        if (changes.url === 'chrome://restart') {
          simulatedLastError = { message: 'Invalid bookmark URL' };
          callback?.();
          simulatedLastError = null;
          return;
        }
        Object.assign(bookmark, changes);
        callback?.(bookmark);
      },
    },
    tabs: {
      create: (options, callback) => {
        createdTabs.push(options);
        callback?.();
      },
      update: (options, callback) => {
        updatedTabs.push(options.url);
        callback?.();
      },
    },
  },
  window: {
    open: (url) => {
      openedUrls.push(url);
      return null;
    },
    location: { assign: (url) => openedUrls.push(url) },
    dispatchEvent: (event) => dispatchedEvents.push(event.type),
    addEventListener: (type, listener) => {
      const listeners = windowEventListeners.get(type) || new Set();
      listeners.add(listener);
      windowEventListeners.set(type, listeners);
    },
    removeEventListener: (type, listener) => windowEventListeners.get(type)?.delete(listener),
    prompt: (_message, value) => blockedInternalPrompts.push(value),
  },
  Event: class Event {
    constructor(type) {
      this.type = type;
    }
  },
  setTimeout,
  clearTimeout,
  requestAnimationFrame: (callback) => setTimeout(() => callback(Date.now()), 10),
  cancelAnimationFrame: clearTimeout,
};
context.globalThis = context;
vm.runInNewContext(compatibilitySource, context, { filename: 'url-compat.js' });

const repairedBookmarks = JSON.parse(storedValues.get('user_bookmarks'));
assert.equal(repairedBookmarks[0].url, 'edge://flags/');
assert.equal(repairedBookmarks[1].url, 'https://example.com/');

context.window.open('edge://flags/', '_blank');
context.window.open('chrome://restart', '_blank');
context.window.open('example.com/path', '_blank');
context.window.open('http://example.org/', '_blank');

assert.deepEqual(updatedTabs, ['edge://flags/', 'chrome://restart']);
assert.deepEqual(createdTabs, []);
assert.deepEqual(openedUrls, ['example.com/path', 'http://example.org/']);

context.__AKISATO_OPEN_BACKGROUND_URL__('https://example.net/middle-click');
assert.equal(createdTabs.length, 1);
assert.equal(createdTabs[0].url, 'https://example.net/middle-click');
assert.equal(createdTabs[0].active, false);

new Promise((resolve) => {
  context.__AKISATO_UPDATE_BROWSER_BOOKMARK__(
    context.chrome.bookmarks,
    '42',
    { title: 'Restart browser', url: 'chrome://restart' },
    () => resolve(context.chrome.runtime.lastError),
  );
}).then((lastErrorDuringAppCallback) => {
  assert.equal(lastErrorDuringAppCallback, null, 'the app callback must see a successful fallback save');
  return new Promise((resolve) => context.__AKISATO_GET_BROWSER_BOOKMARK_TREE__(
    context.chrome.bookmarks,
    resolve,
  ));
}).then((tree) => {
  assert.equal(tree[0].children[0].title, 'Restart browser');
  assert.equal(tree[0].children[0].url, 'chrome://restart');
  assert.ok(dispatchedEvents.includes('akisato-bookmark-overrides-changed'));
  const dispatchWindowEvent = (type, event) => {
    [...(windowEventListeners.get(type) || [])].forEach((listener) => listener(event));
  };
  const tabsBeforeScrollGesture = createdTabs.length;
  let preventedMiddleDefaults = 0;
  context.__AKISATO_HANDLE_CAPSULE_MIDDLE_PRESS__(
    {
      button: 1,
      clientX: 20,
      clientY: 20,
      preventDefault: () => { preventedMiddleDefaults += 1; },
    },
    'https://example.net/should-not-open',
  );
  dispatchWindowEvent('pointerup', { button: 1, clientX: 20, clientY: 20 });
  dispatchWindowEvent('pointermove', { button: -1, clientX: 20, clientY: 40 });
  return new Promise((resolve) => setTimeout(resolve, 100)).then(() => {
    assert.equal(preventedMiddleDefaults, 0);
    assert.equal(createdTabs.length, tabsBeforeScrollGesture);
    context.__AKISATO_HANDLE_CAPSULE_MIDDLE_PRESS__(
      {
        button: 1,
        clientX: 50,
        clientY: 50,
        preventDefault: () => { preventedMiddleDefaults += 1; },
      },
      'https://example.net/stable-middle-click',
    );
    dispatchWindowEvent('pointerup', { button: 1, clientX: 50, clientY: 50 });
    return new Promise((stableResolve) => setTimeout(stableResolve, 160));
  });
}).then(() => {
  assert.equal(createdTabs.at(-1).url, 'https://example.net/stable-middle-click');
  assert.equal(createdTabs.at(-1).active, false);
  context.chrome.tabs.update = (_options, callback) => {
    simulatedLastError = { message: 'Internal URL blocked' };
    callback?.();
    simulatedLastError = null;
  };
  context.chrome.tabs.create = (_options, callback) => {
    simulatedLastError = { message: 'Internal URL blocked' };
    callback?.();
    simulatedLastError = null;
  };
  context.__AKISATO_OPEN_RAW_URL__('chrome://restart', '_blank');
  return new Promise((resolve) => setTimeout(resolve, 220));
}).then(() => {
  assert.equal(openedUrls.at(-1), 'chrome://restart');
  assert.deepEqual(blockedInternalPrompts, ['chrome://restart']);
  console.log('URL compatibility regression checks passed.');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
