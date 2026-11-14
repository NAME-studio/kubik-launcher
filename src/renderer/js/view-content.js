'use strict';

window.Views = window.Views || {};

window.Views.contentView = (config) => {
  const labels = {
    mod: { one: 'мод', many: 'Моды', gen: 'модов', add: 'Скачать мод', placeholder: 'Поиск модов: sodium, create, jei…' },
    modpack: { one: 'модпак', many: 'Модпаки', gen: 'модпаков', add: 'Скачать модпак', placeholder: 'Поиск модпаков: better mc, rlcraft…' },
    resourcepack: { one: 'ресурспак', many: 'Ресурспаки', gen: 'ресурспаков', add: 'Скачать ресурспак', placeholder: 'Поиск ресурспаков: faithful, bare bones…' },
    shader: { one: 'шейдер', many: 'Шейдеры', gen: 'шейдеров', add: 'Скачать шейдер', placeholder: 'Поиск шейдеров: complementary, bsl…' },
    datapack: { one: 'карта', many: 'Карты и миры', gen: 'карт', add: 'Скачать карту', placeholder: 'Поиск миров: dungeons, towns, terralith…' },
  }[config.type];

  const needsInstance = config.type !== 'modpack';

  const s = {
    query: '',
    sort: 'relevance',
    tab: 'browse',
    source: 'modrinth',
    hits: [],
    total: 0,
    loading: false,
    token: 0,
    instanceId: null,
    noInstance: false,
    anyVersion: true,
    installed: null,
    installedQuery: '',
    updates: null,
    updatesLoading: false,
    updating: false,
    installState: {},
    installNodes: new Map(),
    installedIds: new Set(),
    observer: null,
    curseHasKey: null,
    lastError: null,
  };

  const curseType = { mod: 'mod', resourcepack: 'resourcepack', shader: 'shader', modpack: 'modpack' }[config.type] || null;

  function currentInstance() {
    if (s.noInstance) return null;
    const list = App.state.instances;
    if (!list.length) return null;
    return list.find((i) => i.id === s.instanceId) || App.instance() || list[0];
  }

  function cleanText(text, limit = 180) {
    const plain = String(text || '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return plain.length > limit ? `${plain.slice(0, limit)}…` : plain;
  }

  function searchParams(offset) {
    const instance = currentInstance();
    return {
      projectType: config.type,
      gameVersion: needsInstance && instance && !s.anyVersion ? instance.mcVersion : null,
      loader: needsInstance && !s.anyVersion && config.type === 'mod' && instance && (instance.loader || {}).type && instance.loader.type !== 'vanilla' ? instance.loader.type : null,
      query: s.query,
      index: s.sort,
      limit: 12,
      offset,
      categories: config.categories || null,
    };
  }

  function cacheKey(params) {
    return `content:${params.projectType}:${params.gameVersion || ''}:${params.loader || ''}:${(params.categories || []).join(',')}:${params.query}:${params.index}:${params.offset}`;  }

  async function search(append = false) {
    const token = ++s.token;
    const params = searchParams(append ? s.hits.length : 0);
    s.loading = true;
    s.lastError = null;
    s.lastErrorCode = null;
    if (!append) {
      s.hits = [];
      s.total = 0;
    }
    renderResults();
    try {
      const key = cacheKey(params);
      const cached = App.state.contentCache && App.state.contentCache[key];
      let result;
      if (s.source === 'curse') {
        result = await UI.req(
          window.api.content.curseSearch({
            projectType: params.projectType,
            query: params.query,
            gameVersion: params.gameVersion,
            loader: params.loader,
            index: params.offset,
            limit: params.limit,
          }),
        );
      } else if (cached && Date.now() - cached.time < 180000) {
        result = cached.data;
      } else {
        result = await UI.req(window.api.content.search(params));
        App.state.contentCache = App.state.contentCache || {};
        App.state.contentCache[key] = { time: Date.now(), data: result };
      }
      if (token !== s.token) return;
      s.hits = append ? s.hits.concat(result.hits) : result.hits;
      s.total = result.total;
    } catch (error) {
      if (token === s.token) {
        s.lastError = error.message;
        s.lastErrorCode = error.code || null;
        renderResults();
        UI.toast(
          s.source === 'curse' ? error.message : `Modrinth не ответил: ${error.message}`,
          'error',
          7000,
        );
      }
    } finally {
      if (token === s.token) {
        s.loading = false;
        renderResults();
      }
    }
  }

  async function refreshInstalled() {
    const instance = currentInstance();
    s.installedIds = new Set();
    if (!instance || !needsInstance) {
      renderResults();
      return;
    }
    try {
      const data = await UI.req(window.api.content.installed(instance.id));
      s.installed = data;
      for (const item of data.items || []) s.installedIds.add(item.projectId);
      if (config.type === 'resourcepack') {
        s.packOrder = await UI.req(window.api.packs.list(instance.id)).catch(() => []);
      }
    } catch {
      s.installed = { items: [], manual: [] };
    }
    renderResults();
    renderInstalled();
  }

  function iconPlaceholder() {
    return UI.el('div', { class: 'mod-icon placeholder' }, UI.icon(config.type === 'datapack' ? 'map' : 'puzzle'));
  }

  const installQueue = [];
  const INSTALL_PARALLEL = 3;
  let installsActive = 0;

  function pumpInstalls() {
    while (installsActive < INSTALL_PARALLEL && installQueue.length) {
      const job = installQueue.shift();
      installsActive += 1;
      Promise.resolve()
        .then(job)
        .catch(() => {})
        .then(() => {
          installsActive -= 1;
          pumpInstalls();
        });
    }
  }

  function queueInstall(job) {
    installQueue.push(job);
    pumpInstalls();
  }

  async function quickInstall(item, button) {
    if (!App.requireAccount('Создайте аккаунт, чтобы скачивать — это бесплатно')) return;
    if (item.source === 'curse') {
      if (config.type === 'modpack') {
        button.disabled = true;
        button.textContent = 'Ставлю…';
        try {
          const result = await UI.req(window.api.content.curseModpackInstall(item.curseId, item.title));
          await App.reloadInstances();
          App.setInstance(result.instance.id);
          const failed = (result.failures || []).length;
          UI.toast(
            failed ? `Модпак установлен, ${failed} файлов не скачались` : `Модпак «${item.title}» установлен`,
            failed ? 'info' : 'success',
          );
          App.refresh();
        } catch (error) {
          UI.toast(error.message, 'error', 8000);
          button.disabled = false;
          button.textContent = 'Скачать';
        }
        return;
      }
      const target = currentInstance();
      if (!target) {
        UI.toast('Сначала создайте сборку', 'info');
        App.createInstanceDialog();
        return;
      }
      button.disabled = true;
      button.textContent = 'Скачиваю…';
      try {
        await UI.req(window.api.content.curseInstall(target.id, item.curseId, config.type));
        s.installedIds.add(item.id);
        button.textContent = 'Установлено';
        button.classList.add('done');
        UI.toast(`${item.title} установлен`, 'success');
      } catch (error) {
        button.disabled = false;
        button.textContent = 'Скачать';
        UI.toast(error.message, 'error', 8000);
      }
      return;
    }
    if (config.type === 'modpack') {
      button.disabled = true;
      button.textContent = 'Ставлю…';
      try {
        const result = await UI.req(window.api.content.installModpack(item.id));
        await App.reloadInstances();
        App.setInstance(result.instance.id);
        const failed = (result.failures || []).length;
        UI.toast(
          failed ? `Модпак установлен, ${failed} файлов не скачались` : `Модпак «${item.title}» установлен`,
          failed ? 'info' : 'success',
        );
        App.refresh();
      } catch (error) {
        UI.toast(error.message, 'error', 8000);
        button.disabled = false;
        button.textContent = 'Скачать';
      }
      return;
    }
    const instance = currentInstance();
    if (!instance) {
      UI.toast('Сначала создайте сборку', 'info');
      App.createInstanceDialog();
      return;
    }
    if (config.type === 'mod' && instance && (instance.loader || {}).type === 'vanilla') {
      UI.toast('В сборке нет загрузчика модов — мод не загрузится в игре', 'info', 7000);
    }
    button.disabled = true;
    button.textContent = 'В очереди…';
    const targetId = instance.id;
    queueInstall(async () => {
      button.textContent = 'Скачиваю…';
      try {
        await UI.req(window.api.content.install(targetId, item.id));
        s.installedIds.add(item.id);
        UI.toast(`${item.title} установлен`, 'success');
        button.textContent = 'Установлено';
        button.classList.add('done');
        refreshInstalled();
      } catch (error) {
        UI.toast(error.message, 'error', 7000);
        button.disabled = false;
        button.textContent = 'Скачать';
      }
    });
  }

  function modCard(item) {
    const installed = s.installedIds.has(item.id);
    const icon = item.icon
      ? UI.el('img', { class: 'mod-icon', src: item.icon, loading: 'lazy', decoding: 'async', alt: '' })
      : iconPlaceholder();

    const downloadBtn = UI.el(
      'button',
      { class: `btn sm download${installed ? ' done' : ''}`, onclick: (event) => { event.stopPropagation(); quickInstall(item, downloadBtn); } },
      UI.icon(installed ? 'check' : 'download'),
      installed ? 'Установлено' : 'Скачать',
    );

    const card = UI.el(
      'div',
      { class: 'mod-card', tabindex: '0', onclick: () => openItem(item) },
      icon,
      UI.el(
        'div',
        { class: 'mod-main' },
        UI.el('div', { class: 'mod-title', text: item.title }),
        UI.el('div', { class: 'mod-desc', text: cleanText(item.description, 130) }),
        UI.el(
          'div',
          { class: 'mod-foot' },
          UI.icon('download'),
          UI.num(item.downloads || 0),
          item.categories && item.categories.length ? UI.el('span', { text: item.categories.slice(0, 2).join(' • ') }) : null,
          downloadBtn,
        ),
      ),
    );
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') openItem(item);
    });
    return card;
  }

  function openItem(item) {
    if (item.source === 'curse') {
      openCurseProject(item);
      return;
    }
    openProject(item.id);
  }

  function renderResults() {
    const host = document.getElementById('content-results');
    if (!host) return;
    UI.clear(host);

    if (s.loading && !s.hits.length) {
      const grid = UI.el('div', { class: 'mod-grid' });
      for (let i = 0; i < 8; i += 1) grid.append(UI.el('div', { class: 'skeleton', style: { minHeight: '96px' } }));
      host.append(grid);
      return;
    }

    if (!s.hits.length) {
      if (s.lastError) {
        const code = s.lastErrorCode || '';
        const needsKey = code === 'CF_NO_KEY' || (s.source === 'curse' && !code && /API-ключ/.test(s.lastError || ''));
        const title = needsKey
          ? 'CurseForge требует API-ключ'
          : s.source === 'curse'
            ? (code === 'CF_NETWORK'
                ? 'Нет связи с CurseForge'
                : code === 'CF_FORBIDDEN'
                  ? 'CurseForge недоступен в вашей сети'
                  : 'CurseForge временно недоступен')
            : 'Каталог недоступен';
        if (needsKey) {
          const keyInput = UI.el('input', {
            class: 'input',
            type: 'password',
            placeholder: 'Вставьте ключ сюда',
            style: { minWidth: '240px', flex: '1 1 220px' },
          });
          const saveKey = async () => {
            const value = keyInput.value.trim();
            if (!value) {
              UI.toast('Вставьте ключ CurseForge', 'info');
              return;
            }
            try {
              await UI.req(window.api.settings.save({ curseforgeKey: value }));
              UI.toast('Ключ сохранён, повторяю поиск', 'success');
              search(false);
            } catch (error) {
              UI.toast(error.message, 'error', 7000);
            }
          };

          host.append(
            UI.el(
              'div',
              { class: 'card empty' },
              UI.el('h3', {}, 'Для CurseForge нужен бесплатный ключ'),
              UI.el(
                'p',
                {},
                'Ключ выдаётся один раз за минуту: войдите на console.curseforge.com, создайте API Key и вставьте его ниже. Это бесплатно и делается однажды — лаунчер запомнит ключ.',
              ),
              UI.el(
                'div',
                { class: 'row', style: { gap: '8px', justifyContent: 'center', flexWrap: 'wrap' } },
                UI.el(
                  'button',
                  { class: 'btn sm', onclick: () => window.api.openExternal('https://console.curseforge.com/') },
                  'Получить ключ',
                ),
                keyInput,
                UI.el('button', { class: 'btn sm primary', onclick: saveKey }, 'Сохранить'),
                UI.el('button', { class: 'btn sm ghost', onclick: () => search(false) }, 'Повторить'),
              ),
              UI.el('p', { class: 'small muted' }, 'Пока ключа нет — каталог Modrinth работает без всяких настроек.'),
            ),
          );
          return;
        }

        host.append(
          UI.el('div', { class: 'card empty' },
            UI.el('h3', {}, title),
            UI.el('p', {}, s.lastError),
            UI.el('div', { class: 'row', style: { gap: '8px', justifyContent: 'center' } },
              UI.el('button', { class: 'btn sm primary', onclick: () => search(false) }, UI.icon('refresh'), 'Повторить'),
            ),
          ),
        );
        return;
      }
      host.append(
        UI.el(
          'div',
          { class: 'card empty' },
          UI.el('img', { src: 'assets/empty-chest.jpg', alt: '' }),
          UI.el('h3', {}, 'Ничего не найдено'),
          UI.el('p', {}, s.source === 'curse'
            ? 'CurseForge не нашёл подходящих файлов. Попробуйте другой запрос.'
            : 'Попробуйте другой запрос или смените версию Minecraft у сборки.'),
        ),
      );
      return;
    }

    const grid = UI.el('div', { class: 'mod-grid' });
    for (const item of s.hits) grid.append(modCard(item));
    host.append(grid);

    if (s.hits.length < s.total) {
      const sentinel = UI.el('div', { class: 'load-more' }, s.loading ? 'Загрузка…' : 'Прокрутите, чтобы загрузить ещё');
      host.append(sentinel);
      if (s.observer) s.observer.disconnect();
      s.observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting) && !s.loading) search(true);
      }, { root: document.getElementById('page'), rootMargin: '240px' });
      s.observer.observe(sentinel);
    }
  }

  const isPackView = config.type === 'resourcepack';

  function packName(filename) {
    return `file/${String(filename || '').replace(/\\/g, '/')}`;
  }

  function packActive(filename) {
    return (s.packOrder || []).includes(packName(filename));
  }

  function packSwitch(filename) {
    const active = packActive(filename);
    return UI.el('div', {
      class: `switch${active ? ' on' : ''}`,
      title: active ? 'Отключить в игре' : 'Включить в игре',
      onclick: async (event) => {
        event.stopPropagation();
        try {
          const res = await UI.req(window.api.packs.toggle(currentInstance().id, filename));
          s.packOrder = res.list || [];
          await refreshInstalled();
        } catch (error) {
          UI.toast(error.message, 'error');
        }
      },
    });
  }

  function renderInstalled() {
    const host = document.getElementById('content-installed');
    if (!host) return;
    UI.clear(host);
    if (!currentInstance()) {
      host.append(
        UI.el('div', { class: 'card empty' },
          UI.el('h3', {}, 'Сборка не выбрана'),
          UI.el('p', {}, 'Выберите сборку в списке сверху, чтобы видеть, что в ней установлено.'),
        ),
      );
      return;
    }
    if (!s.installed) {
      host.append(UI.el('div', { class: 'skeleton', style: { minHeight: '80px' } }));
      return;
    }
    const items = (s.installed.items || []).filter((item) => item.projectType === config.type);
    const manual = (s.installed.manual || []).filter((item) => item.projectType === config.type);

    if (!items.length && !manual.length) {
      host.append(
        UI.el(
          'div',
          { class: 'card empty' },
          UI.el('img', { src: 'assets/empty-chest.jpg', alt: '' }),
          UI.el('h3', {}, 'Пока пусто'),
          UI.el('p', {}, `Установленные ${labels.many.toLowerCase()} появятся здесь.`),
        ),
      );
      return;
    }

    const rows = [];
    const enabledCount = items.filter((item) => item.enabled).length + manual.filter((file) => !file.disabled).length;

    const searchInput = UI.el('input', {
      class: 'input',
      type: 'search',
      placeholder: `Поиск среди ${labels.gen}…`,
      value: s.installedQuery || '',
    });
    searchInput.addEventListener('input', () => {
      s.installedQuery = searchInput.value;
      const q = searchInput.value.trim().toLowerCase();
      for (const row of rows) {
        row.el.style.display = !q || row.text.toLowerCase().includes(q) ? '' : 'none';
      }
    });

    const updateButton = config.type === 'mod'
      ? UI.el(
          'button',
          {
            class: 'btn sm ghost',
            disabled: s.updatesLoading || s.updating,
            onclick: async () => {
              s.updatesLoading = true;
              renderInstalled();
              try {
                const list = await UI.req(window.api.content.updates(currentInstance().id));
                s.updates = Array.isArray(list) ? list : [];
                UI.toast(
                  s.updates.length ? `Доступно обновлений: ${s.updates.length}` : 'Все моды актуальны',
                  s.updates.length ? 'info' : 'success',
                );
              } catch (error) {
                UI.toast(error.message, 'error');
              } finally {
                s.updatesLoading = false;
                renderInstalled();
              }
            },
          },
          UI.icon('refresh'),
          s.updatesLoading ? 'Проверяю…' : 'Проверить обновления',
        )
      : null;

    const updateAllButton = config.type === 'mod' && s.updates && s.updates.length
      ? UI.el(
          'button',
          {
            class: 'btn sm',
            disabled: s.updating,
            onclick: async () => {
              s.updating = true;
              renderInstalled();
              try {
                const result = await UI.req(window.api.content.updateAll(currentInstance().id));
                const ok = (result || []).filter((r) => r.ok).length;
                const failed = (result || []).filter((r) => !r.ok);
                UI.toast(
                  failed.length ? `Обновлено ${ok}, с ошибкой ${failed.length}` : `Обновлено: ${ok}`,
                  failed.length ? 'error' : 'success',
                  7000,
                );
                s.updates = null;
              } catch (error) {
                UI.toast(error.message, 'error');
              } finally {
                s.updating = false;
                await refreshInstalled();
              }
            },
          },
          UI.icon('download'),
          s.updating ? 'Обновляю…' : `Обновить всё (${s.updates.length})`,
        )
      : null;

    const bar = UI.el(
      'div',
      { style: { display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginBottom: '10px' } },
      searchInput,
      UI.el('div', {
        class: 'tiny muted',
        text: `включено ${enabledCount} из ${items.length + manual.length}`,
      }),
      updateButton,
      updateAllButton,
    );

    const list = UI.el('div', { class: 'list' });
    for (const item of items) {
      const update = !isPackView && s.updates ? s.updates.find((entry) => entry.projectId === item.projectId) : null;
      const row = UI.el('div', { class: `installed-row${(isPackView ? packActive(item.filename) : item.enabled) ? '' : ' off'}` });
      row.append(...[
        item.icon ? UI.el('img', { class: 'mod-icon', style: { width: '38px', height: '38px' }, src: item.icon, loading: 'lazy' }) : iconPlaceholder(),
        UI.el(
          'div',
          { class: 'grow' },
          UI.el('div', { style: { fontWeight: '600' } }, item.title),
          UI.el('div', {
            class: 'tiny muted',
            text: isPackView
              ? [item.versionNumber || '', item.sizeLabel, packActive(item.filename) ? '' : 'выключен'].filter(Boolean).join(' • ')
              : `${item.versionNumber || ''} • ${item.sizeLabel} ${item.fromModpack ? '• из модпака' : ''}`,
          }),
        ),
        isPackView
          ? packSwitch(item.filename)
          : UI.el('div', {
              class: `switch${item.enabled ? ' on' : ''}`,
              onclick: async (event) => {
                event.stopPropagation();
                try {
                  const res = await UI.req(window.api.content.toggle(currentInstance().id, item.projectId));
                  item.enabled = res.enabled;
                  await refreshInstalled();
                } catch (error) {
                  UI.toast(error.message, 'error');
                }
              },
            }),
        (() => {
          const state = s.installState[item.projectId];
          if (state && state.busy) {
            const label = `Скачиваю ${Math.round(state.percent || 0)}%`;
            const button = UI.el(
              'button',
              { class: 'btn sm ghost update-badge busy', disabled: true, title: 'Идёт загрузка' },
              UI.icon('download'),
              label,
            );
            s.installNodes.set(item.projectId, button);
            return button;
          }
          if (state && state.error) {
            return UI.el(
              'button',
              {
                class: 'btn sm ghost update-badge error',
                title: state.error,
                onclick: (event) => {
                  event.stopPropagation();
                  delete s.installState[item.projectId];
                  renderInstalled();
                },
              },
              UI.icon('alert'),
              'Ошибка',
            );
          }
          if (!update) return null;
          return UI.el(
            'button',
            {
              class: 'btn sm ghost update-badge',
              title: `Обновить до ${update.latest}`,
              onclick: async (event) => {
                event.stopPropagation();
                s.installState[item.projectId] = { busy: true, percent: 0 };
                renderInstalled();
                try {
                  await UI.req(window.api.content.install(currentInstance().id, item.projectId, update.versionId));
                  delete s.installState[item.projectId];
                  s.updates = (s.updates || []).filter((entry) => entry.projectId !== item.projectId);
                  UI.toast(`${item.title} обновлён до ${update.latest}`, 'success');
                  await refreshInstalled();
                } catch (error) {
                  s.installState[item.projectId] = { busy: false, error: error.message };
                  renderInstalled();
                  UI.toast(error.message, 'error');
                }
              },
            },
            UI.icon('download'),
            update.latest,
          );
        })(),
        UI.el('button', {
          class: 'btn sm ghost icon-only',
          title: 'Удалить',
          onclick: async (event) => {
            event.stopPropagation();
            try {
              await UI.req(window.api.content.remove(currentInstance().id, item.projectId));
              UI.toast('Удалено', 'success');
              await refreshInstalled();
            } catch (error) {
              UI.toast(error.message, 'error');
            }
          },
        }, UI.icon('trash')),
      ].filter(Boolean));
      rows.push({ el: row, text: `${item.title || ''} ${item.versionNumber || ''}` });
      list.append(row);
    }

    for (const file of manual) {
      const active = isPackView ? packActive(file.filename) : !file.disabled;
      const row = UI.el(
        'div',
        { class: `installed-row${active ? '' : ' off'}` },
        UI.el('div', { class: 'mod-icon placeholder', style: { width: '38px', height: '38px' } }, UI.icon('hard-drive')),
        UI.el(
          'div',
          { class: 'grow' },
          UI.el('div', { style: { fontWeight: '600' } }, file.title || file.filename),
          UI.el('div', {
            class: 'tiny muted',
            text: [
              file.version ? `версия ${file.version}` : '',
              file.sizeLabel || UI.bytes(file.size),
              isPackView ? (active ? '' : 'выключен') : file.filename,
            ].filter(Boolean).join(' • '),
          }),
        ),
        isPackView
          ? packSwitch(file.filename)
          : UI.el('div', {
              class: `switch${file.disabled ? '' : ' on'}`,
              title: file.disabled ? 'Включить' : 'Отключить',
              onclick: async (event) => {
                event.stopPropagation();
                try {
                  const res = await UI.req(window.api.content.toggle(currentInstance().id, file.filename, file.folder));
                  file.disabled = !res.enabled;
                  await refreshInstalled();
                } catch (error) {
                  UI.toast(error.message, 'error');
                }
              },
            }),
        UI.el('button', {
          class: 'btn sm ghost icon-only',
          title: 'Удалить',
          onclick: async () => {
            try {
              await UI.req(window.api.content.remove(currentInstance().id, file.filename, file.folder));
              await refreshInstalled();
            } catch (error) {
              UI.toast(error.message, 'error');
            }
          },
        }, UI.icon('trash')),
      );
      rows.push({ el: row, text: `${file.title || ''} ${file.version || ''} ${file.filename}` });
      list.append(row);
    }
    host.append(bar, list);
  }

  function htmlToText(text) {
    return String(text || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '• ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#(\d+);/g, (match, code) => String.fromCharCode(Number(code)))
      .replace(/[ \t]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function openCurseProject(item) {
    const body = UI.el('div', { class: 'stack' }, UI.el('div', { class: 'skeleton', style: { minHeight: '160px' } }));
    UI.modal({ title: item.title || 'Загрузка…', subtitle: 'CurseForge', wide: true, body, actions: [{ label: 'Закрыть', kind: 'ghost' }] });

    (async () => {
      try {
        const project = await UI.req(window.api.content.curseProject(item.curseId));
        UI.clear(body);

        const installedItem = s.installed
          ? (s.installed.items || []).find((entry) => entry.projectId === project.id && entry.projectType === config.type)
          : null;

        body.append(
          UI.el(
            'div',
            { class: 'row', style: { alignItems: 'flex-start', gap: '14px' } },
            item.icon ? UI.el('img', { class: 'mod-icon', style: { width: '76px', height: '76px' }, src: item.icon }) : iconPlaceholder(),
            UI.el(
              'div',
              { class: 'grow' },
              UI.el('div', { style: { fontSize: '18px', fontWeight: '650' } }, project.title || item.title),
              UI.el(
                'div',
                { class: 'row', style: { gap: '6px', flexWrap: 'wrap', marginTop: '8px' } },
                UI.el('span', { class: `badge accent${installedItem ? '' : ' hidden'}` }, UI.icon('check'), 'Установлено'),
                UI.el('span', { class: 'badge accent' }, UI.icon('download'), UI.num(project.downloads || 0)),
                project.author ? UI.el('span', { class: 'badge', text: project.author }) : null,
                ...(project.categories || []).slice(0, 3).map((cat) => UI.el('span', { class: 'badge', text: cat })),
                project.updated ? UI.el('span', { class: 'badge', text: `обновлён ${UI.date(project.updated)}` }) : null,
              ),
            ),
          ),
        );

        const gallery = (project.gallery || []).slice(0, 6);
        if (gallery.length) {
          const strip = UI.el('div', { class: 'gallery' });
          for (const image of gallery) strip.append(UI.el('img', { src: image.url, alt: image.title || '', loading: 'lazy' }));
          body.append(strip);
        }

        const fullText = htmlToText(project.description).slice(0, 6000);
        const descNode = UI.el('div', { class: 'project-body', style: { whiteSpace: 'pre-wrap' } }, fullText || 'Описание не указано.');
        body.append(descNode);

        const translatedNote = UI.el('div', { class: 'small muted hidden', text: 'Переведено автоматически' });
        const translateButton = UI.el(
          'button',
          {
            class: 'btn sm ghost',
            onclick: async () => {
              translateButton.disabled = true;
              const label = translateButton.textContent;
              translateButton.textContent = 'Перевожу…';
              try {
                const short = await UI.req(window.api.content.translate(fullText));
                if (short && short.text) descNode.textContent = short.text;
                translatedNote.classList.remove('hidden');
              } catch (error) {
                UI.toast(error.message, 'error', 7000);
              }
              translateButton.disabled = false;
              translateButton.textContent = label;
            },
          },
          'Перевести на русский',
        );
        const translateEnButton = UI.el(
          'button',
          {
            class: 'btn sm ghost',
            onclick: async () => {
              translateEnButton.disabled = true;
              const label = translateEnButton.textContent;
              translateEnButton.textContent = 'Перевожу…';
              try {
                const result = await UI.req(window.api.content.translate(fullText, 'en'));
                if (result && result.text) descNode.textContent = result.text;
                translatedNote.classList.remove('hidden');
              } catch (error) {
                UI.toast(error.message, 'error', 7000);
              }
              translateEnButton.disabled = false;
              translateEnButton.textContent = label;
            },
          },
          'Перевести на английский',
        );
        const settingsNow = (App.state && App.state.settings) || {};
        if (fullText) {
          body.append(
            UI.el(
              'div',
              { class: 'row', style: { gap: '8px', alignItems: 'center' } },
              translateButton,
              translateEnButton,
              translatedNote,
            ),
          );
          if (settingsNow.translateDescriptions !== false) {
            const auto = /[а-яё]/i.test(fullText) ? translateEnButton : translateButton;
            setTimeout(() => auto.click(), 80);
          }
        }

        if ((project.files || []).length) {
          const list = UI.el('div', { class: 'card', style: { padding: '10px 12px' } });
          list.append(UI.el('div', { class: 'small muted', style: { marginBottom: '6px' }, text: 'Последние файлы' }));
          for (const file of project.files.slice(0, 5)) {
            const size = file.size ? `${Math.round(file.size / 1024 / 1024)} МБ` : '';
            list.append(
              UI.el(
                'div',
                { class: 'row', style: { gap: '8px', fontSize: '12px', justifyContent: 'space-between' } },
                UI.el('span', { style: { overflow: 'hidden', textOverflow: 'ellipsis' }, text: file.name }),
                UI.el('span', { class: 'muted', text: [file.date ? UI.date(file.date) : '', size].filter(Boolean).join(' • ') }),
              ),
            );
          }
          body.append(list);
        }

        const foot = UI.el('div', { class: 'modal-foot' });
        foot.append(
          UI.el('button', {
            class: 'btn ghost',
            onclick: () => window.api.openExternal(project.url || `https://www.curseforge.com/minecraft/search?search=${encodeURIComponent(project.title || '')}`),
          }, UI.icon('image'), 'Открыть на CurseForge'),
        );
        const actionBtn = UI.el('button', { class: 'btn primary' }, UI.icon('download'), labels.add);
        actionBtn.addEventListener('click', async () => {
          const before = actionBtn.disabled;
          if (before) return;
          await quickInstall(item, actionBtn);
        });
        foot.append(actionBtn);
        body.append(foot);
      } catch (error) {
        UI.clear(body);
        body.append(
          UI.el('div', { class: 'notice' }, UI.icon('alert'), UI.el('span', {}, error.message || 'Не удалось загрузить проект')),
        );
      }
    })();
  }

  function openProject(projectId) {
    const body = UI.el('div', { class: 'stack' }, UI.el('div', { class: 'skeleton', style: { minHeight: '160px' } }));
    const modal = UI.modal({
      title: 'Загрузка…',
      subtitle: 'Modrinth',
      wide: true,
      body,
      actions: [{ label: 'Закрыть', kind: 'ghost' }],
    });

    (async () => {
      try {
        const instance = needsInstance ? currentInstance() : null;
        const project = await UI.req(window.api.content.project(projectId));
        const versions = await UI.req(
          window.api.content.versions(project.id, instance ? instance.mcVersion : null, instance && config.type === 'mod' ? (instance.loader || {}).type || null : null),
        );

        UI.clear(body);
        const installedItem = instance && s.installed
          ? (s.installed.items || []).find((entry) => entry.projectId === project.id && entry.projectType === config.type)
          : null;
        const statusBadge = UI.el('span', {
          class: `badge accent${installedItem ? '' : ' hidden'}`,
        }, UI.icon('check'), 'Установлено');
        body.append(
          UI.el(
            'div',
            { class: 'row', style: { alignItems: 'flex-start', gap: '14px' } },
            project.icon ? UI.el('img', { class: 'mod-icon', style: { width: '76px', height: '76px' }, src: project.icon }) : iconPlaceholder(),
            UI.el(
              'div',
              { class: 'grow' },
              UI.el('div', { style: { fontSize: '18px', fontWeight: '650' } }, project.title),
              UI.el('div', { class: 'row', style: { gap: '6px', flexWrap: 'wrap', marginTop: '8px' } },
                statusBadge,
                UI.el('span', { class: 'badge accent' }, UI.icon('download'), UI.num(project.downloads || 0)),
                ...(project.categories || []).slice(0, 3).map((cat) => UI.el('span', { class: 'badge', text: cat })),
                UI.el('span', { class: 'badge', text: `обновлён ${UI.date(project.updated)}` }),
              ),
            ),
          ),
        );

        const gallery = (project.gallery || []).slice(0, 5);
        if (gallery.length) {
          const strip = UI.el('div', { class: 'gallery' });
          for (const image of gallery) strip.append(UI.el('img', { src: image.url, alt: image.title || '', loading: 'lazy' }));
          body.append(strip);
        }

        const descNode = project.description
          ? UI.el('p', { class: 'small muted' }, cleanText(project.description, 400))
          : null;
        const translatedNote = UI.el('div', { class: 'small muted hidden', text: 'Переведено автоматически' });
        const bodyWrap = project.body ? UI.el('div', { class: 'project-body', html: UI.md(project.body) }) : null;
        const translateButton = UI.el(
          'button',
          {
            class: 'btn sm ghost',
            onclick: async () => {
              translateButton.disabled = true;
              const label = translateButton.textContent;
              translateButton.textContent = 'Перевожу…';
              try {
                if (project.description) {
                  const short = await UI.req(window.api.content.translate(project.description));
                  if (short && short.text && descNode) descNode.textContent = short.text;
                }
                if (project.body) {
                  const long = await UI.req(window.api.content.translate(project.body.slice(0, 4000)));
                  if (long && long.text && bodyWrap) bodyWrap.innerHTML = UI.md(long.text);
                }
                translatedNote.classList.remove('hidden');
              } catch (error) {
                UI.toast(error.message, 'error', 7000);
              }
              translateButton.disabled = false;
              translateButton.textContent = label;
            },
          },
          'Перевести на русский',
        );
        const translateEnButton = UI.el(
          'button',
          {
            class: 'btn sm ghost',
            onclick: async () => {
              translateEnButton.disabled = true;
              const label = translateEnButton.textContent;
              translateEnButton.textContent = 'Перевожу…';
              try {
                if (project.description) {
                  const short = await UI.req(window.api.content.translate(project.description, 'en'));
                  if (short && short.text && descNode) descNode.textContent = short.text;
                }
                if (project.body) {
                  const long = await UI.req(window.api.content.translate(project.body.slice(0, 4000), 'en'));
                  if (long && long.text && bodyWrap) bodyWrap.innerHTML = UI.md(long.text);
                }
                translatedNote.classList.remove('hidden');
              } catch (error) {
                UI.toast(error.message, 'error', 7000);
              }
              translateEnButton.disabled = false;
              translateEnButton.textContent = label;
            },
          },
          'Перевести на английский',
        );
        if (descNode) body.append(descNode);
        const settingsNow = (App.state && App.state.settings) || {};
        const sourceText = String(project.description || project.body || '');
        const cyrillicSource = /[а-яё]/i.test(sourceText);
        if (project.description || project.body) {
          body.append(
            UI.el(
              'div',
              { class: 'row', style: { gap: '8px', alignItems: 'center' } },
              translateButton,
              translateEnButton,
              translatedNote,
            ),
          );
        }
        if (settingsNow.translateDescriptions !== false && sourceText) {
          const auto = cyrillicSource ? translateEnButton : translateButton;
          setTimeout(() => auto.click(), 80);
        }

        const versionSelect = UI.el('select', { class: 'select' });
        for (const version of versions.slice(0, 80)) {
          versionSelect.append(
            UI.el('option', {
              value: version.id,
              text: `${version.versionNumber} • ${version.gameVersions.slice(0, 2).join(', ')} • ${version.type}`,
            }),
          );
        }
        if (!versions.length) versionSelect.append(UI.el('option', { value: '', text: 'Нет совместимых версий' }));

        body.append(
          UI.el('div', { class: 'field' }, UI.el('label', {}, instance ? `Версия для Minecraft ${instance.mcVersion}` : 'Версия проекта'), versionSelect),
        );

        if (needsInstance && !instance) {
          body.append(UI.el('div', { class: 'notice' }, UI.icon('alert'),
            UI.el('span', {}, 'Установка идёт в сборку — создайте её, чтобы скачивать.')));
        }

        if (bodyWrap) {
          body.append(bodyWrap);
        }

        const foot = UI.el('div', { class: 'modal-foot' });
        foot.append(
          UI.el('button', {
            class: 'btn ghost',
            onclick: () => window.api.openExternal(`https://modrinth.com/${config.type === 'datapack' ? 'datapack' : config.type}/${project.slug || project.id}`),
          }, UI.icon('image'), 'Открыть на Modrinth'),
        );

        let installedNow = Boolean(installedItem);
        const actionBtn = UI.el('button', { class: 'btn primary' });
        const isModpack = config.type === 'modpack';

        const paintAction = () => {
          if (isModpack) return;
          statusBadge.classList.toggle('hidden', !installedNow);
          actionBtn.className = installedNow ? 'btn ghost' : 'btn primary';
          actionBtn.replaceChildren(
            UI.icon(installedNow ? 'trash' : 'download'),
            document.createTextNode(installedNow ? 'Удалить из сборки' : labels.add),
          );
        };
        if (isModpack) actionBtn.replaceChildren(UI.icon('download'), document.createTextNode(labels.add));

        actionBtn.addEventListener('click', async () => {
          if (!App.requireAccount('Создайте аккаунт, чтобы скачивать — это бесплатно')) return;
          const versionId = versionSelect.value || undefined;

          if (installedNow && instance) {
            actionBtn.disabled = true;
            actionBtn.replaceChildren(UI.icon('trash'), document.createTextNode('Удаляю…'));
            try {
              await UI.req(window.api.content.remove(instance.id, project.id));
              installedNow = false;
              s.installedIds.delete(project.id);
              await refreshInstalled();
              UI.toast('Удалено из сборки', 'success');
            } catch (error) {
              UI.toast(error.message, 'error', 8000);
            } finally {
              actionBtn.disabled = false;
              paintAction();
            }
            return;
          }

          actionBtn.disabled = true;
          actionBtn.replaceChildren(UI.icon('refresh'), document.createTextNode('Устанавливаю…'));
          const offPercent = App.on('progress', (payload) => {
            if (!payload || payload.projectId !== project.id) return;
            const percent = Math.max(0, Math.min(100, Number(payload.percent) || 0));
            actionBtn.replaceChildren(UI.icon('download'), document.createTextNode(`Скачиваю ${Math.round(percent)}%`));
          });
          try {
            if (isModpack) {
              const result = await UI.req(window.api.content.installModpack(project.id, versionId));
              await App.reloadInstances();
              App.setInstance(result.instance.id);
              modal.close();
              const failed = (result.failures || []).length;
              UI.toast(failed ? `Установлено, ${failed} файлов не скачались` : 'Модпак установлен', failed ? 'info' : 'success');
              App.refresh();
              return;
            }
            if (!instance) {
              modal.close();
              App.createInstanceDialog();
              return;
            }
            await UI.req(window.api.content.install(instance.id, project.id, versionId));
            installedNow = true;
            s.installedIds.add(project.id);
            UI.toast(`${project.title} установлен`, 'success');
            await refreshInstalled();
          } catch (error) {
            UI.toast(error.message, 'error', 8000);
          } finally {
            if (typeof offPercent === 'function') offPercent();
            actionBtn.disabled = false;
            if (!isModpack) paintAction();
          }
        });
        foot.append(actionBtn);
        paintAction();

        const oldFoot = modal.box.querySelector('.modal-foot');
        if (oldFoot) oldFoot.remove();
        modal.box.append(foot);
      } catch (error) {
        UI.clear(body);
        body.append(UI.el('div', { class: 'notice' }, UI.icon('alert'), UI.el('span', { text: error.message })));
      }
    })();

    return modal;
  }

  function buildToolbar() {
    const instance = needsInstance ? currentInstance() : null;
    const toolbar = UI.el('div', { class: 'content-toolbar' });

    if (curseType) {
      const switcher = UI.el('div', { class: 'tabs mini' });
      for (const [id, label] of [['modrinth', 'Modrinth'], ['curse', 'CurseForge']]) {
        const tab = UI.el('button', { class: `tab${s.source === id ? ' active' : ''}`, text: label });
        tab.addEventListener('click', () => {
          if (s.source === id) return;
          s.source = id;
          s.hits = [];
          s.total = 0;
          [...switcher.children].forEach((node) => node.classList.toggle('active', node === tab));
          search();
        });
        switcher.append(tab);
      }
      toolbar.append(switcher);
    }

    if (needsInstance) {
      if (App.state.instances.length) {
        const select = UI.el('select', { class: 'select', style: { maxWidth: '300px' } });
        select.append(UI.el('option', { value: '', text: 'Без сборки — только смотреть' }));
        for (const item of App.state.instances) {
          select.append(
            UI.el('option', {
              value: item.id,
              text: `${item.name} • ${item.mcVersion}${(item.loader || {}).type && item.loader.type !== 'vanilla' ? ` ${item.loader.type}` : ''}`,
            }),
          );
        }
        select.value = instance ? instance.id : '';
        select.addEventListener('change', () => {
          s.instanceId = select.value || null;
          s.noInstance = !select.value;
          if (select.value) {
            App.setInstance(select.value);
          } else {
            s.installed = null;
            s.installedIds = new Set();
            renderInstalled();
          }
          s.installed = s.instanceId ? s.installed : null;
          s.hits = [];
          search();
          if (s.instanceId) refreshInstalled();
        });
        toolbar.append(select);
        const filterBtn = UI.el('button', {
          class: `btn sm${s.anyVersion ? '' : ' primary'}`,
          title: 'Показывать только контент, совместимый с выбранной сборкой',
        }, UI.icon('layers'), s.anyVersion ? 'Все версии' : 'Под сборку');
        filterBtn.addEventListener('click', () => {
          s.anyVersion = !s.anyVersion;
          filterBtn.className = `btn sm${s.anyVersion ? '' : ' primary'}`;
          filterBtn.replaceChildren(UI.icon('layers'), document.createTextNode(s.anyVersion ? 'Все версии' : 'Под сборку'));
          s.hits = [];
          search();
        });
        toolbar.append(filterBtn);
      } else {
        toolbar.append(
          UI.el('button', { class: 'btn sm', onclick: () => App.createInstanceDialog() }, UI.icon('plus'), 'Создать сборку'),
        );
      }
    }

    const searchBox = UI.el(
      'div',
      { class: 'search grow' },
      UI.icon('search'),
      UI.el('input', {
        class: 'input',
        placeholder: labels.placeholder,
        value: s.query,
        oninput: UI.debounce((event) => {
          s.query = event.target.value;
          search();
        }, 400),
      }),
    );

    const sortSelect = UI.el(
      'select',
      { class: 'select', style: { maxWidth: '190px' } },
      UI.el('option', { value: 'relevance', text: 'По релевантности' }),
      UI.el('option', { value: 'downloads', text: 'По загрузкам' }),
      UI.el('option', { value: 'follows', text: 'По подпискам' }),
      UI.el('option', { value: 'newest', text: 'Новые' }),
      UI.el('option', { value: 'updated', text: 'Обновлённые' }),
    );
    sortSelect.value = s.sort;
    sortSelect.addEventListener('change', () => {
      s.sort = sortSelect.value;
      search();
    });

    toolbar.append(searchBox, sortSelect);
    return toolbar;
  }

  return {
    title: labels.many,
    kicker: 'Modrinth',
    render(container) {
      if (needsInstance && !s.instanceId) {
        const instance = App.instance();
        s.instanceId = instance ? instance.id : null;
      }

      const tabs = UI.el('div', { class: 'tabs' });
      const browseTab = UI.el('button', { class: `tab${s.tab === 'browse' ? ' active' : ''}`, text: 'Каталог' });
      const installedTab = UI.el('button', { class: `tab${s.tab === 'installed' ? ' active' : ''}`, text: 'Установленные' });
      tabs.append(browseTab);
      if (needsInstance) tabs.append(installedTab);

      const browse = UI.el('div', { id: 'content-browse', class: s.tab === 'installed' ? 'hidden' : '' }, buildToolbar(), UI.el('div', { id: 'content-results' }));
      const installedWrap = UI.el('div', { id: 'content-installed-wrap', class: s.tab === 'installed' ? '' : 'hidden' }, UI.el('div', { id: 'content-installed' }));

      browseTab.addEventListener('click', () => {
        s.tab = 'browse';
        browseTab.classList.add('active');
        installedTab.classList.remove('active');
        browse.classList.remove('hidden');
        installedWrap.classList.add('hidden');
      });
      installedTab.addEventListener('click', () => {
        s.tab = 'installed';
        installedTab.classList.add('active');
        browseTab.classList.remove('active');
        browse.classList.add('hidden');
        installedWrap.classList.remove('hidden');
        refreshInstalled();
      });

      container.append(tabs, UI.el('div', { style: { height: '12px' } }), browse, installedWrap);

      if (config.notice) {
        container.insertBefore(
          UI.el('div', { class: 'notice page-notice' }, UI.icon('info'), UI.el('span', { text: config.notice })),
          tabs,
        );
      }

      if (!s.offContentProgress && typeof App.on === 'function') {
        s.offContentProgress = App.on('progress', (payload) => {
          if (!payload || !payload.projectId) return;
          const state = s.installState[payload.projectId];
          if (!state || !state.busy) return;
          state.percent = Math.max(0, Math.min(100, Number(payload.percent) || 0));
          const node = s.installNodes.get(payload.projectId);
          if (node && node.lastChild) node.lastChild.textContent = `Скачиваю ${Math.round(state.percent)}%`;
        });
      }

      if (needsInstance) refreshInstalled();
      if (s.tab !== 'installed') search();
    },
    openProject,
    destroy() {
      s.token += 1;
      if (s.offContentProgress) {
        s.offContentProgress();
        s.offContentProgress = null;
      }
      s.installNodes.clear();
      if (s.observer) s.observer.disconnect();
      s.observer = null;
      s.hits = [];
    },
  };
};

window.Views.mods = window.Views.contentView({ type: 'mod' });
window.Views.modpacks = window.Views.contentView({ type: 'modpack' });
window.Views.resourcepacks = window.Views.contentView({ type: 'resourcepack' });
window.Views.shaders = window.Views.contentView({ type: 'shader' });
