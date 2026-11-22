'use strict';

window.Views = window.Views || {};

window.Views.versions = (() => {
  let observer = null;
  const state = { types: { release: true, snapshot: false, old_beta: false, old_alpha: false }, query: '', limit: 60, manifest: null };

  function typeBadge(type) {
    if (type === 'release') return { text: 'релиз', cls: 'accent' };
    if (type === 'snapshot') return { text: 'снапшот', cls: 'blue' };
    if (type === 'old_beta') return { text: 'бета', cls: 'orange' };
    if (type === 'old_alpha') return { text: 'альфа', cls: 'violet' };
    return { text: type, cls: '' };
  }

  async function load() {
    if (state.manifest) return state.manifest;
    state.manifest = await UI.req(window.api.versions.manifest());
    return state.manifest;
  }

  function renderList(container) {
    const manifest = state.manifest;
    if (!manifest) {
      UI.clear(container);
      for (let i = 0; i < 8; i += 1) container.append(UI.el('div', { class: 'skeleton', style: { marginBottom: '8px', minHeight: '52px' } }));
      return;
    }
    const installed = new Set(App.state.installedVersions || []);
    const query = state.query.trim().toLowerCase();
    let versions = manifest.versions.filter((v) => {
      if (!state.types[v.type]) return false;
      if (query && !v.id.toLowerCase().includes(query)) return false;
      return true;
    });

    versions.sort((a, b) => new Date(b.releaseTime || 0) - new Date(a.releaseTime || 0));

    const total = versions.length;
    versions = versions.slice(0, state.limit);

    const list = UI.el('div', { class: 'list' });
    for (const version of versions) {
      const badge = typeBadge(version.type);
      const row = UI.el(
        'div',
        { class: 'list-row' },
        UI.el('div', { class: `version-mark ${version.type}` },
          UI.icon(version.type === 'release' ? 'cube' : version.type === 'snapshot' ? 'sparkles' : 'clock')),
        UI.el(
          'div',
          { class: 'grow' },
          UI.el(
            'div',
            { class: 'row', style: { gap: '8px' } },
            UI.el('span', { class: 'vname', text: version.id }),
            UI.el('span', { class: `badge ${badge.cls}`, text: badge.text }),
            installed.has(version.id) ? UI.el('span', { class: 'badge accent' }, UI.icon('check'), 'установлена') : null,
          ),
          UI.el('div', { class: 'vdate', text: UI.date(version.releaseTime) }),
        ),
        UI.el(
          'button',
          {
            class: 'btn sm',
            onclick: () => {
              Views.instances.createDialog({ mcVersion: version.id, name: `Minecraft ${version.id}` });
            },
          },
          UI.icon('plus'),
          'Создать профиль',
        ),
      );
      list.append(row);
    }

    UI.clear(container);
    container.append(
      UI.el(
        'div',
        { class: 'content-toolbar' },
        UI.el(
          'div',
          { class: 'search grow' },
          UI.icon('search'),
          UI.el('input', {
            class: 'input',
            placeholder: 'Поиск версии: 1.20, 1.8.9, 1.21…',
            value: state.query,
            oninput: (event) => {
              state.query = event.target.value;
              state.limit = 60;
              renderList(container);
            },
          }),
        ),
        UI.el(
          'div',
          { class: 'tabs version-types' },
          ...[
            ['release', 'Релизы'],
            ['snapshot', 'Снапшоты'],
            ['old_beta', 'Беты'],
            ['old_alpha', 'Альфы'],
          ].map(([id, label]) =>
            UI.el('button', {
              class: `tab${state.types[id] ? ' active' : ''}`,
              text: label,
              title: state.types[id] ? 'Скрыть' : 'Показать',
              onclick: () => {
                state.types[id] = !state.types[id];
                const any = Object.values(state.types).some(Boolean);
                if (!any) state.types[id] = true;
                state.limit = 60;
                renderList(container);
              },
            }),
          ),
        ),
      ),
    );
    container.append(list);
    container.append(
      UI.el(
        'div',
        { class: 'row between', style: { marginTop: '12px' } },
        UI.el('span', { class: 'small muted', text: `Показано ${versions.length} из ${total}` }),
      ),
    );

    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (versions.length < total) {
      const sentinel = UI.el('div', { class: 'load-more', text: 'Подгружаю ещё…' });
      container.append(sentinel);
      observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        state.limit += 120;
        if (observer) {
          observer.disconnect();
          observer = null;
        }
        renderList(container);
      }, { rootMargin: '300px' });
      observer.observe(sentinel);
    }
  }

  return {
    title: 'Версии Minecraft',
    kicker: 'Каталог Mojang',
    async render(container) {
      container.append(UI.el('p', { class: 'muted small', style: { marginBottom: '14px' } }, 'Список официальных версий. Выберите нужную — лаунчер создаст профиль и скачает файлы.'));
      const list = UI.el('div');
      container.append(list);
      renderList(list);
      try {
        const manifest = await load();
        if (manifest) {
          const installed = await UI.req(window.api.versions.installed()).catch(() => []);
          App.state.installedVersions = (installed || []).filter((v) => v.hasJar).map((v) => v.id);
          renderList(list);
        }
      } catch (error) {
        UI.toast(error.message, 'error');
      }
    },
    destroy() {
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      state.query = '';
      state.limit = 60;
    },
  };
})();
