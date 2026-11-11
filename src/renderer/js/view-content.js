'use strict';

window.Views = window.Views || {};

window.Views.contentView = (config) => {
  const labels = {
    mod: { one: 'мод', many: 'Моды', add: 'Скачать мод', placeholder: 'Поиск модов: sodium, create, jei…' },
    modpack: { one: 'модпак', many: 'Модпаки', add: 'Скачать модпак', placeholder: 'Поиск модпаков: better mc, rlcraft…' },
    resourcepack: { one: 'ресурспак', many: 'Ресурспаки', add: 'Скачать ресурспак', placeholder: 'Поиск ресурспаков: faithful, bare bones…' },
    shader: { one: 'шейдер', many: 'Шейдеры', add: 'Скачать шейдер', placeholder: 'Поиск шейдеров: complementary, bsl…' },
    datapack: { one: 'карта', many: 'Карты и миры', add: 'Скачать карту', placeholder: 'Поиск миров: dungeons, towns, terralith…' },
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
      loader: needsInstance && !s.anyVersion && config.type === 'mod' && instance && instance.loader.type !== 'vanilla' ? instance.loader.type : null,
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
        renderResults();
        UI.toast(
          s.source === 'curse' ? `CurseForge: ${error.message}` : `Modrinth не ответил: ${error.message}`,
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
    } catch {
      s.installed = { items: [], manual: [] };
    }
    renderResults();
    renderInstalled();
  }

  function iconPlaceholder() {
    return UI.el('div', { class: 'mod-icon placeholder' }, UI.icon(config.type === 'datapack' ? 'map' : 'puzzle'));
  }

  async function quickInstall(item, button) {
    if (!App.requireAccount('Создайте аккаунт, чтобы скачивать — это бесплатно')) return;
    if (item.source === 'curse') {
      if (config.type === 'modpack') {
        UI.toast('Модпаки CurseForge открываются на сайте — установка архивов появится позже', 'info', 6000);
        window.api.openExternal(`https://www.curseforge.com/minecraft/search?search=${encodeURIComponent(item.title)}`);
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
    if (config.type === 'mod' && instance.loader.type === 'vanilla') {
      UI.toast('В сборке нет загрузчика модов — мод не загрузится в игре', 'info', 7000);
    }
    button.disabled = true;
    button.textContent = 'Скачиваю…';
    try {
      await UI.req(window.api.content.install(instance.id, item.id));
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
      window.api.openExternal(`https://www.curseforge.com/minecraft/search?search=${encodeURIComponent(item.title)}`);
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
        host.append(
          UI.el('div', { class: 'card empty' },
            UI.el('h3', {}, s.source === 'curse' ? 'CurseForge требует API-ключ' : 'Каталог недоступен'),
            UI.el('p', {}, s.lastError),
            s.source === 'curse'
              ? UI.el('button', {
                  class: 'btn sm primary',
                  onclick: () => App.go('settings'),
                }, UI.icon('settings'), 'Открыть настройки')
              : null,
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

    const list = UI.el('div', { class: 'list' });
    for (const item of items) {
      const row = UI.el('div', { class: `installed-row${item.enabled ? '' : ' off'}` });
      row.append(
        item.icon ? UI.el('img', { class: 'mod-icon', style: { width: '38px', height: '38px' }, src: item.icon, loading: 'lazy' }) : iconPlaceholder(),
        UI.el(
          'div',
          { class: 'grow' },
          UI.el('div', { style: { fontWeight: '600' } }, item.title),
          UI.el('div', { class: 'tiny muted', text: `${item.versionNumber || ''} • ${item.sizeLabel} ${item.fromModpack ? '• из модпака' : ''}` }),
        ),
        UI.el('div', {
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
      );
      list.append(row);
    }

    for (const file of manual) {
      list.append(
        UI.el(
          'div',
          { class: `installed-row${file.disabled ? ' off' : ''}` },
          UI.el('div', { class: 'mod-icon placeholder', style: { width: '38px', height: '38px' } }, UI.icon('hard-drive')),
          UI.el(
            'div',
            { class: 'grow' },
            UI.el('div', { style: { fontWeight: '600' } }, file.filename),
            UI.el('div', { class: 'tiny muted', text: `добавлено вручную • ${UI.bytes(file.size)}` }),
          ),
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
        ),
      );
    }
    host.append(list);
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
          window.api.content.versions(project.id, instance ? instance.mcVersion : null, instance && config.type === 'mod' ? instance.loader.type : null),
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

        if (project.description) body.append(UI.el('p', { class: 'small muted' }, cleanText(project.description, 400)));

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

        if (project.body) {
          body.append(
            UI.el('div', { class: 'project-body', html: UI.md(project.body) }),
          );
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
              text: `${item.name} • ${item.mcVersion}${item.loader.type !== 'vanilla' ? ` ${item.loader.type}` : ''}`,
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

      const browse = UI.el('div', { id: 'content-browse' }, buildToolbar(), UI.el('div', { id: 'content-results' }));
      const installedWrap = UI.el('div', { id: 'content-installed-wrap', class: 'hidden' }, UI.el('div', { id: 'content-installed' }));

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

      search();
      if (needsInstance) refreshInstalled();
    },
    openProject,
    destroy() {
      s.token += 1;
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
