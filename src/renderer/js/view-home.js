'use strict';

window.Views = window.Views || {};

window.Views.home = (() => {
  let refs = {};

  function metaLine(instance) {
    if (!instance) return 'Сборка не выбрана';
    const parts = [`Minecraft ${instance.mcVersion}`];
    const loader = App.loaderLabel(instance.loader);
    if (loader) parts.push(loader);
    return parts.join(' • ');
  }

  function renderHero() {
    const instance = App.instance();

    const playButton = UI.el('button', { class: 'btn primary lg', id: 'home-play' }, UI.icon('play'), 'Играть');
    const secondary = UI.el(
      'button',
      {
        class: 'btn lg ghost',
        onclick: () => (instance ? App.go('instances') : App.go('modpacks')),
      },
      UI.icon(instance ? 'settings' : 'package'),
      instance ? 'Настроить' : 'Обзор модпаков',
    );

    const progressBox = UI.el('div', { class: 'hidden', style: { width: '100%', maxWidth: '440px' } });
    const actions = UI.el('div', { class: 'hero-actions' }, playButton, secondary);
    const meta = UI.el('div', { class: 'hero-meta' });

    const hero = UI.el(
      'div',
      { class: 'hero hero-art' },
      UI.el('div', { class: 'hero-bg' }),
      UI.el(
        'div',
        { class: 'hero-content' },
        UI.el('div', { class: 'hero-eyebrow' }, 'Kubik Launcher'),
        UI.el('h2', { text: instance ? instance.name : 'Мир ждёт тебя' }),
        UI.el('p', {
          text: instance
            ? `${metaLine(instance)}. Всё готово к запуску — проверяем файлы и стартуем.`
            : 'Создайте сборку: выберите версию Minecraft, загрузчик и играйте. Скины — Ely.by или свой ник.',
        }),
        actions,
        progressBox,
        meta,
      ),
    );

    function updateMeta() {
      UI.clear(meta);
      if (!instance) {
        meta.append(
          UI.el('span', {}, UI.icon('cube'), 'Версии Mojang'),
          UI.el('span', {}, UI.icon('puzzle'), 'Modrinth'),
          UI.el('span', {}, UI.icon('shield'), 'Ely.by'),
        );
        return;
      }
      meta.append(
        UI.el('span', {}, UI.icon('cube'), `Minecraft ${instance.mcVersion}`),
        UI.el('span', {}, UI.icon('layers'), App.loaderLabel(instance.loader) || 'Vanilla'),
        UI.el('span', {}, UI.icon('cpu'), `${instance.memoryMB} МБ RAM`),
        UI.el('span', {}, UI.icon('folder'), instance.lastPlayed ? `Запуск: ${UI.ago(instance.lastPlayed)}` : 'Ещё не запускалась'),
      );
    }

    function setProgress(payload) {
      if (!payload) {
        progressBox.classList.add('hidden');
        return;
      }
      progressBox.classList.remove('hidden');
      UI.clear(progressBox);
      const percent = Math.max(0, Math.min(100, payload.percent || 0));
      progressBox.append(
        UI.el('div', { class: 'progress' }, UI.el('i', { style: { width: `${percent}%` } })),
        UI.el(
          'div',
          { class: 'progress-label' },
          UI.el('span', { text: payload.detail || 'Подготовка…' }),
          UI.el('span', { text: `${percent}%` }),
        ),
      );
    }

    function refreshPlayButton() {
      const running = instance && App.state.running[instance.id];
      UI.clear(playButton);
      if (!instance) {
        playButton.append(UI.icon('plus'), 'Создать сборку');
        playButton.onclick = () => App.createInstanceDialog();
        return;
      }
      playButton.disabled = false;
      if (running) {
        playButton.classList.remove('primary');
        playButton.classList.add('danger');
        playButton.append(UI.icon('stop'), 'Остановить');
        playButton.onclick = async () => {
          try {
            await UI.req(window.api.game.stop(instance.id));
            App.state.running[instance.id] = false;
            App.refresh();
          } catch (error) {
            UI.toast(error.message, 'error');
          }
        };
      } else {
        playButton.classList.add('primary');
        playButton.classList.remove('danger');
        playButton.append(UI.icon('play'), 'Играть');
        playButton.onclick = () => play();
      }
    }

    async function play() {
      if (!instance) return;
      if (!App.requireAccount('Выберите аккаунт, чтобы играть')) return;
      playButton.disabled = true;
      setProgress({ percent: 1, detail: 'Проверяю файлы игры…' });
      const offProgress = App.on('progress', (payload) => {
        if (!payload || payload.instanceId !== instance.id) return;
        setProgress(payload);
      });
      try {
        const result = await UI.req(window.api.game.launch(instance.id));
        App.state.running[instance.id] = true;
        UI.toast('Игра запускается…', 'success');
        refs.logFile = result.logFile;
        refreshPlayButton();
        setProgress({ percent: 100, detail: 'Игра запущена' });
        setTimeout(() => setProgress(null), 2500);
      } catch (error) {
        UI.toast(error.message, 'error', 9000);
        setProgress(null);
        playButton.disabled = false;
      } finally {
        offProgress();
      }
    }

    refs = { hero, playButton, progressBox, setProgress, refreshPlayButton, updateMeta, meta };
    updateMeta();
    refreshPlayButton();
    const progress = instance ? App.state.progress[instance.id] : null;
    if (progress) setProgress(progress);
    return hero;
  }

  function renderStats() {
    const state = App.state;
    const instances = state.instances.length;

    const modsValue = UI.el('div', { class: 'stat-value', text: '—' });
    const diskValue = UI.el('div', { class: 'stat-value', text: '—' });

    const card = UI.el(
      'div',
      { class: 'stats' },
      UI.el(
        'div',
        { class: 'stat' },
        UI.el('div', { class: 'stat-icon' }, UI.icon('layers')),
        UI.el('div', {}, UI.el('div', { class: 'stat-value', text: String(instances) }), UI.el('div', { class: 'stat-label', text: 'сборок' })),
      ),
      UI.el(
        'div',
        { class: 'stat' },
        UI.el('div', { class: 'stat-icon blue' }, UI.icon('puzzle')),
        modsValue,
        UI.el('div', { class: 'stat-label', text: 'модов и ресурсов' }),
      ),
      UI.el(
        'div',
        { class: 'stat' },
        UI.el('div', { class: 'stat-icon violet' }, UI.icon('hard-drive')),
        diskValue,
        UI.el('div', { class: 'stat-label', text: 'занято сборками' }),
      ),
    );

    (async () => {
      try {
        let total = 0;
        for (const inst of state.instances) {
          const content = await UI.req(window.api.content.installed(inst.id)).catch(() => ({ items: [], manual: [] }));
          total += (content.items || []).length + (content.manual || []).length;
        }
        modsValue.textContent = String(total);
      } catch {
        modsValue.textContent = '0';
      }
      try {
        let size = 0;
        for (const inst of state.instances) {
          size += await UI.req(window.api.instances.size(inst.id)).catch(() => 0);
        }
        diskValue.textContent = UI.bytes(size);
      } catch {
        diskValue.textContent = '—';
      }
    })();

    return card;
  }

  function renderAccount() {
    const account = App.state.currentAccount;
    const card = UI.el('div', { class: 'card account-strip' });
    const typeLabel = { local: 'Офлайн-аккаунт', ely: 'Ely.by', microsoft: 'Microsoft' };

    if (!account) {
      card.append(
        UI.el('div', { class: 'skin-mini' }, UI.icon('user')),
        UI.el(
          'div',
          { class: 'grow' },
          UI.el('div', { style: { fontWeight: '600' } }, 'Вы не авторизованы'),
          UI.el('div', { class: 'small muted' }, 'Можно просто ник — или вход через Ely.by и Microsoft'),
        ),
        UI.el('button', { class: 'btn ghost', onclick: () => App.openAccount({ tab: 'local' }) }, 'Офлайн-ник'),
        UI.el('button', { class: 'btn primary', onclick: () => App.openAccount() }, 'Войти'),
      );
      return card;
    }

    const avatarBox = UI.el('div', { class: 'skin-mini' }, UI.icon('user'));
    card.append(
      avatarBox,
      UI.el(
        'div',
        { class: 'grow' },
        UI.el('div', { style: { fontWeight: '600' } }, account.username),
        UI.el('div', { class: 'small muted', text: `${typeLabel[account.type] || 'аккаунт'} • скин и настройки в лаунчере` }),
      ),
      UI.el('button', { class: 'btn sm', onclick: () => App.go('skins') }, UI.icon('shirt'), 'Скин'),
      UI.el('button', { class: 'btn sm ghost', onclick: () => App.openAccount() }, 'Сменить'),
    );
    App.accountAvatar(account).then((url) => {
      if (!url) return;
      UI.clear(avatarBox);
      avatarBox.append(UI.el('img', { src: url, alt: '' }));
    });

    return card;
  }

  function renderModpacks() {
    const wrap = UI.el('div', { class: 'grid auto' });
    wrap.append(UI.el('div', { class: 'skeleton' }));
    const holder = UI.el('div', {}, wrap);
    (async () => {
      try {
        if (!App.state.popularModpacks) {
          App.state.popularModpacks = await UI.req(window.api.content.popular('modpack', 6));
        }
        UI.clear(wrap);
        for (const item of App.state.popularModpacks.hits.slice(0, 6)) {
          wrap.append(App.modpackCard(item));
        }
        if (!App.state.popularModpacks.hits.length) {
          wrap.append(UI.el('div', { class: 'muted small', text: 'Не удалось загрузить список' }));
        }
      } catch (error) {
        UI.clear(wrap);
        wrap.append(UI.el('div', { class: 'muted small', text: `Modrinth недоступен: ${error.message}` }));
      }
    })();
    return holder;
  }

  function renderRecent() {
    const state = App.state;
    if (!state.instances.length) {
      return UI.el(
        'div',
        { class: 'card empty' },
        UI.el('img', { src: 'assets/empty-chest.jpg', alt: '' }),
        UI.el('h3', {}, 'Пока нет сборок'),
        UI.el('p', {}, 'Сборка — это отдельная папка с модами, мирами и настройками. Создайте первую.'),
        UI.el('button', { class: 'btn primary', onclick: () => App.createInstanceDialog() }, UI.icon('plus'), 'Создать сборку'),
      );
    }
    const grid = UI.el('div', { class: 'grid auto' });
    for (const instance of state.instances.slice(0, 4)) grid.append(App.instanceCard(instance));
    grid.append(UI.el('button', { class: 'new-instance', onclick: () => App.createInstanceDialog() }, UI.el('div', { class: 'plus' }, UI.icon('plus')), 'Новая сборка'));
    return grid;
  }

  function renderVanilla() {
    const select = UI.el('select', { class: 'select' });
    select.append(UI.el('option', { value: '', text: 'Загружаю версии…' }));
    const playBtn = UI.el('button', { class: 'btn primary', disabled: true }, UI.icon('play'), 'Играть');
    const hint = UI.el('div', { class: 'tiny muted', text: 'Чистая ванила без сборки: выбираете версию и играете.' });
    const card = UI.el('div', { class: 'card pad vanilla-quick' },
      UI.el('div', { class: 'card-head' },
        UI.el('div', { class: 'card-title' }, UI.icon('cube'), 'Играть без сборки'),
        UI.el('span', { class: 'badge', text: 'ванила' }),
      ),
      UI.el('div', { class: 'vanilla-row' }, select, playBtn),
      hint,
    );

    (async () => {
      try {
        const manifest = await UI.req(window.api.versions.manifest());
        const releases = (manifest.versions || []).filter((version) => version.type === 'release');
        UI.clear(select);
        for (const version of releases.slice(0, 60)) select.append(UI.el('option', { value: version.id, text: version.id }));
        if (!releases.length) {
          select.append(UI.el('option', { value: '', text: 'Нет версий' }));
          hint.textContent = 'Не удалось получить список версий Minecraft.';
          return;
        }
        playBtn.disabled = false;
      } catch (error) {
        hint.textContent = `Список версий недоступен: ${error.message}`;
      }
    })();

    playBtn.addEventListener('click', async () => {
      const version = select.value;
      if (!version) return;
      playBtn.disabled = true;
      const label = playBtn.lastChild;
      if (label && label.nodeType === 3) label.textContent = ' Запускаю…';
      try {
        await App.quickPlay(version);
      } finally {
        if (label && label.nodeType === 3) label.textContent = ' Играть';
        playBtn.disabled = false;
      }
    });

    return card;
  }

  return {
    title: 'Главная',
    kicker: 'Добро пожаловать в Kubik',
    render(container) {
      const stack = UI.el('div', { class: 'stack' });
      stack.append(renderHero(), renderStats(), renderVanilla(), renderAccount());
      stack.append(
        UI.el(
          'div',
          { class: 'section-title' },
          UI.el('h2', {}, 'Популярные модпаки'),
          UI.el('button', { class: 'link', onclick: () => App.go('modpacks') }, 'Все модпаки →'),
        ),
        renderModpacks(),
        UI.el(
          'div',
          { class: 'section-title' },
          UI.el('h2', {}, 'Мои сборки'),
          UI.el('button', { class: 'link', onclick: () => App.go('instances') }, 'Все →'),
        ),
        renderRecent(),
      );
      container.append(stack);
    },
    onEvent(type, payload) {
      if (type === 'progress') {
        if (refs.setProgress) refs.setProgress(payload);
        return;
      }
      if (type === 'state') {
        if (payload.state === 'exited') {
          refs.setProgress &&
            refs.setProgress({ percent: 100, detail: payload.code === 0 ? 'Игра закрыта' : `Процесс завершился (код ${payload.code})` });
          setTimeout(() => refs.setProgress && refs.setProgress(null), 4000);
        }
        if (refs.refreshPlayButton) refs.refreshPlayButton();
      }
    },
    destroy() {
      refs = {};
    },
  };
})();
