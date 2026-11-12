'use strict';

(() => {
  const listeners = new Map();
  let previousView = null;

  const AccountLabels = {
    local: 'Офлайн',
    ely: 'Ely.by',
    microsoft: 'Microsoft',
  };

  const App = {
    state: {
      info: null,
      settings: null,
      accounts: { current: '', list: [] },
      currentAccount: null,
      instances: [],
      running: {},
      progress: {},
      skinCache: {},
      avatarCache: {},
      accountSkinCache: {},
      manifest: null,
      javaList: [],
      installedVersions: [],
      popularModpacks: null,
      selectedInstanceId: null,
      route: 'home',
    },
    views: window.Views || {},
  };

  App.on = (type, callback) => {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(callback);
    return () => listeners.get(type) && listeners.get(type).delete(callback);
  };

  App.emit = (type, payload) => {
    const set = listeners.get(type);
    if (set) [...set].forEach((callback) => {
      try {
        callback(payload);
      } catch (error) {
        console.error('listener error', error);
      }
    });
  };

  App.loaderLabel = (loader) => {
    if (!loader || loader.type === 'vanilla') return '';
    const names = { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' };
    return `${names[loader.type] || loader.type}${loader.version ? ` ${loader.version}` : ''}`;
  };

  App.instance = () => {
    if (!App.state.instances.length) return null;
    return (
      App.state.instances.find((item) => item.id === App.state.selectedInstanceId) ||
      App.state.instances[0]
    );
  };

  App.setInstance = (id) => {
    App.state.selectedInstanceId = id;
    window.api.settings.save({ lastInstance: id });
  };

  App.reloadInstances = async () => {
    try {
      App.state.instances = await UI.req(window.api.instances.list());
      if (!App.state.instances.some((item) => item.id === App.state.selectedInstanceId)) {
        App.state.selectedInstanceId = App.state.instances[0] ? App.state.instances[0].id : null;
      }
    } catch (error) {
      UI.toast(`Не удалось загрузить сборки: ${error.message}`, 'error');
    }
    if (App.updateStatus) App.updateStatus();
    return App.state.instances;
  };

  App.currentView = () => App.views[App.state.route];

  App.refresh = () => {
    if (App.updateStatus) App.updateStatus();
    renderPage();
  };

  App.go = (route) => {
    if (!App.views[route]) route = 'home';
    if (`#${route}` !== location.hash) {
      location.hash = route;
    } else {
      App.state.route = route;
      renderPage();
    }
  };

  function updateNav() {
    document.querySelectorAll('.nav-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.route === App.state.route);
    });
  }

  function renderPage() {
    const route = (location.hash || '#home').replace('#', '');
    App.state.route = App.views[route] ? route : 'home';
    document.body.dataset.route = App.state.route;
    const view = App.currentView();
    if (!view) return;

    if (previousView && previousView.destroy && previousView !== view) {
      try {
        previousView.destroy();
      } catch {
        /* ignore */
      }
    }

    const page = document.getElementById('page');
    const head = document.getElementById('page-title');
    const kicker = document.getElementById('page-kicker');
    const actions = document.getElementById('page-actions');

    UI.clear(page);
    page.style.overflow = '';
    page.style.paddingBottom = '';
    UI.clear(actions);
    head.textContent = typeof view.title === 'string' ? view.title : '';
    kicker.textContent = view.kicker || '';
    updateNav();
    document.querySelector('.main').scrollTop = 0;

    try {
      view.render(page, actions);
    } catch (error) {
      console.error(error);
      UI.toast(`Ошибка интерфейса: ${error.message}`, 'error', 7000);
    }
    if (window.api && window.api.rpc && !Object.values(App.state.running || {}).some(Boolean)) {
      window.api.rpc.update({ state: 'launcher', page: view.title || '' });
    }
    page.scrollTop = 0;
    previousView = view;
  }

  App.createInstanceDialog = (prefill) => window.Views.instances.createDialog(prefill || {});
  App.instanceCard = (instance) => window.Views.instances.card(instance);

  App.modpackCard = (item) => {
    const gallery = item.gallery && item.gallery[0] ? item.gallery[0].url : null;
    const cover = UI.el('div', { class: 'inst-cover' });
    if (gallery) {
      cover.style.backgroundImage = `url("${gallery}")`;
    } else {
      cover.classList.add('no-art');
    }
    if (item.icon) {
      cover.append(UI.el('img', { class: 'cover-icon', src: item.icon, alt: '', loading: 'lazy' }));
    }
    cover.append(
      UI.el('div', { class: 'badges' }, UI.el('span', { class: 'badge accent', text: 'модпак' })),
      UI.el('div', { class: 'cover-shade' }),
    );

    return UI.el(
      'button',
      { class: 'inst-card', onclick: () => window.Views.modpacks.openProject(item.id) },
      cover,
      UI.el(
        'div',
        { class: 'inst-body' },
        UI.el('div', { class: 'inst-name' }, item.title),
        UI.el('div', { class: 'inst-desc', text: item.description || '' }),
        UI.el('div', { class: 'inst-sub' },
          UI.el('span', {}, UI.icon('download')),
          UI.el('span', {}, `${UI.num(item.downloads || 0)} загрузок`),
          item.author ? UI.el('span', { text: `• ${item.author}` }) : null,
        ),
      ),
    );
  };

  App.requireAccount = (message) => {
    if (App.state.currentAccount) return true;
    UI.toast(message || 'Чтобы скачивать, создайте аккаунт — это бесплатно', 'info', 6500);
    App.openAccount({ tab: 'local' });
    return false;
  };

  App.showLaunchError = (instance, error) => {
    const logFile = (error && error.logFile) || '';
    const instanceId = instance && instance.id;
    const message = (error && error.message) || 'Неизвестная ошибка';
    if (error && error.code === 'another-running') {
      const activeName = (error.meta && error.meta.instanceName) || 'другая сборка';
      return UI.modal({
        title: 'Сначала закройте игру',
        subtitle: `Сейчас запущена «${activeName}». Из одного лаунчера одновременно работает только одна сборка.`,
        body: UI.el(
          'div',
          { class: 'stack', style: { gap: '10px' } },
          UI.el('div', { class: 'notice' }, UI.icon('alert'), UI.el('span', { text: message })),
          UI.el('div', {
            style: { fontSize: '13px', opacity: '0.75' },
            text: 'Можно остановить её и сразу запустить выбранную сборку.',
          }),
        ),
        actions: [
          { label: 'Отмена', kind: 'ghost' },
          {
            label: 'Остановить и запустить',
            kind: 'primary',
            onClick: async () => {
              try {
                await UI.req(window.api.game.stopAll());
                App.state.running = {};
                UI.toast('Игра остановлена — запускаю другую сборку', 'info');
                setTimeout(() => App.launchInstance(instance), 400);
              } catch (stopError) {
                UI.toast(stopError.message, 'error');
              }
              return false;
            },
          },
        ],
      });
    }
    const body = UI.el(
      'div',
      { class: 'stack', style: { gap: '12px' } },
      UI.el('div', { class: 'notice' }, UI.icon('alert'), UI.el('span', { text: message })),
      logFile
        ? UI.el('div', { style: { fontSize: '12px', opacity: '0.72', wordBreak: 'break-all' }, text: logFile })
        : null,
    );
    const actions = [];
    if (logFile) {
      actions.push({
        label: 'Скопировать лог',
        onClick: async () => {
          try {
            const result = await UI.req(window.api.game.copyLog(logFile));
            UI.toast(`Лог скопирован (${result.chars} символов)`, 'success');
          } catch (copyError) {
            UI.toast(copyError.message, 'error');
          }
          return false;
        },
      });
      actions.push({
        label: 'Открыть лог',
        onClick: () => {
          window.api.openPath(logFile);
          return false;
        },
      });
    }
    if (instanceId) {
      actions.push({
        label: 'Открыть папку сборки',
        onClick: () => {
          window.api.instances.openFolder(instanceId);
          return false;
        },
      });
    }
    actions.push({ label: 'Закрыть', kind: 'primary' });
    return UI.modal({
      title: 'Не удалось запустить игру',
      subtitle: 'Можно сразу посмотреть лог или открыть папку сборки',
      body,
      actions,
    });
  };

  App.launchInstance = async (instance) => {
    if (!instance) return;
    if (!App.requireAccount('Выберите аккаунт, чтобы играть')) return;
    if (App.state.running[instance.id]) {
      try {
        await UI.req(window.api.game.stop(instance.id));
        App.state.running[instance.id] = false;
        UI.toast('Игра остановлена', 'info');
        App.refresh();
      } catch (error) {
        UI.toast(error.message, 'error');
      }
      return;
    }
    const bar = UI.el('div', { class: 'progress' }, UI.el('i', { style: { width: '1%' } }));
    const label = UI.el('div', { class: 'progress-label' }, UI.el('span', { text: 'Проверяю файлы игры…' }), UI.el('span', { text: '1%' }));
    const modal = UI.modal({
      title: 'Запуск игры',
      subtitle: 'Проверяю библиотеки, ресурсы и Java — окно можно свернуть',
      body: UI.el('div', { class: 'stack', style: { gap: '10px' } }, bar, label),
      actions: [],
    });
    const offProgress = App.on('progress', (payload) => {
      if (!payload || payload.instanceId !== instance.id) return;
      const percent = Math.max(0, Math.min(100, payload.percent || 0));
      bar.querySelector('i').style.width = `${percent}%`;
      label.firstChild.textContent = payload.detail || 'Подготовка…';
      label.lastChild.textContent = `${percent}%`;
    });
    try {
      await UI.req(window.api.game.launch(instance.id));
      App.state.running[instance.id] = true;
      bar.querySelector('i').style.width = '100%';
      label.firstChild.textContent = 'Игра запущена';
      label.lastChild.textContent = '100%';
      UI.toast('Игра запускается…', 'success');
      setTimeout(() => modal.close(), 1200);
    } catch (error) {
      modal.close();
      App.showLaunchError(instance, error);
    } finally {
      offProgress();
    }
    App.refresh();
  };

  App.installInstance = (instanceId, options = {}) => {
    const bar = UI.el('div', { class: 'progress' }, UI.el('i', { style: { width: '2%' } }));
    const detail = UI.el('div', { class: 'progress-label' }, UI.el('span', { text: 'Проверяю файлы…' }), UI.el('span', { text: '' }));
    const body = UI.el('div', { class: 'stack', style: { gap: '10px' } }, bar, detail);
    const modal = UI.modal({
      title: options.title || 'Установка игры',
      subtitle: 'Библиотеки, ресурсы и natives — можно свернуть окно',
      body,
      actions: [],
    });
    const unsubscribe = App.on('progress', (payload) => {
      if (payload.instanceId !== instanceId) return;
      const percent = Math.max(0, Math.min(100, payload.percent || 0));
      bar.querySelector('i').style.width = `${percent}%`;
      detail.firstChild.textContent = payload.detail || 'Установка…';
      detail.lastChild.textContent = `${percent}%`;
    });
    UI.req(window.api.game.install(instanceId))
      .then(() => {
        UI.toast('Игра установлена — можно играть', 'success');
        if (options.autoLaunch) {
          const target = options.instance || (App.state.instances || []).find((item) => item.id === instanceId);
          if (target) setTimeout(() => App.launchInstance(target), 300);
        }
      })
      .catch((error) => {
        UI.toast(error.message, 'error', 9000);
      })
      .finally(() => {
        unsubscribe();
        modal.close();
        App.refresh();
      });
    return modal;
  };

  const quickLocks = new Set();

  App.quickPlay = async (version) => {
    const mc = String(version || '').trim();
    if (!mc) return null;
    if (quickLocks.has(mc)) return null;
    if (!App.requireAccount('Выберите аккаунт, чтобы играть')) return null;
    quickLocks.add(mc);
    try {
      let instance = (App.state.instances || []).find(
        (item) => item.mcVersion === mc && item.loader && item.loader.type === 'vanilla' && !item.sharedPack && !item.modpack,
      );
      if (!instance) {
        const created = await UI.req(window.api.instances.create({
          name: `Ванила ${mc}`,
          mcVersion: mc,
          loader: { type: 'vanilla', version: null },
        }));
        instance = created && created.instance ? created.instance : null;
        if (instance) App.state.instances = [...(App.state.instances || []), instance];
      }
      if (!instance) {
        await App.reloadInstances();
        instance = (App.state.instances || []).find((item) => item.name === `Ванила ${mc}`);
      }
      if (!instance) throw new Error('Не удалось подготовить сборку');
      App.installInstance(instance.id, { title: `Ванила ${mc}`, instance, autoLaunch: true });
      return instance;
    } catch (error) {
      UI.toast(error.message, 'error', 8000);
      return null;
    } finally {
      setTimeout(() => quickLocks.delete(mc), 1500);
    }
  };

  const DEFAULT_SKIN = {
    classic: 'assets/skin-steve.png',
    slim: 'assets/skin-alex.png',
  };

  App.defaultSkin = (model) => DEFAULT_SKIN[model === 'slim' ? 'slim' : 'classic'];

  App.accountSkin = async (account) => {
    if (!account) return { dataUrl: null, model: 'classic' };
    const cached = App.state.accountSkinCache[account.id];
    if (cached) return cached;
    try {
      const data = await UI.req(window.api.accounts.skin(account.id));
      const result = { dataUrl: data.dataUrl || null, model: data.model || account.skinModel || 'classic' };
      App.state.accountSkinCache[account.id] = result;
      return result;
    } catch {
      return { dataUrl: null, model: 'classic' };
    }
  };

  App.accountAvatar = async (account) => {
    if (!account) return null;
    const key = `acc-${account.id}`;
    if (App.state.avatarCache[key]) return App.state.avatarCache[key];
    const skin = await App.accountSkin(account);
    const source = skin.dataUrl || App.defaultSkin(skin.model);
    try {
      const image = await window.SkinRender.loadImage(source);
      const url = window.SkinRender.headAvatar(image, 96);
      App.state.avatarCache[key] = url;
      return url;
    } catch {
      return null;
    }
  };

  App.skinData = async (nickname) => {
    if (!nickname) return null;
    const account = App.state.accounts.list.find((a) => a.username.toLowerCase() === nickname.toLowerCase());
    if (account) {
      const skin = await App.accountSkin(account);
      return skin.dataUrl || App.defaultSkin(skin.model);
    }
    if (App.state.skinCache[nickname]) return App.state.skinCache[nickname];
    try {
      const data = await UI.req(window.api.skins.data(nickname));
      App.state.skinCache[nickname] = data.skin || null;
      return data.skin || null;
    } catch {
      App.state.skinCache[nickname] = null;
      return null;
    }
  };

  App.skinAvatar = async (nickname) => {
    if (!nickname) return null;
    if (App.state.avatarCache[nickname]) return App.state.avatarCache[nickname];
    const data = (await App.skinData(nickname)) || App.defaultSkin('classic');
    try {
      const image = await window.SkinRender.loadImage(data);
      const url = window.SkinRender.headAvatar(image, 96);
      App.state.avatarCache[nickname] = url;
      return url;
    } catch {
      return null;
    }
  };

  function accountRow(account, getModal, reloadAccounts) {
    const active = account.id === App.state.accounts.current;
    const row = UI.el('div', { class: `account-row${active ? ' active' : ''}` });
    const avatar = UI.el('span', { class: 'account-row-avatar' });
    row.append(
      avatar,
      UI.el(
        'div',
        { class: 'grow' },
        UI.el('div', { class: 'account-row-name' }, account.username),
        UI.el('div', { class: 'tiny muted' }, AccountLabels[account.type] || account.type),
      ),
      ...(active ? [UI.el('span', { class: 'badge accent', text: 'выбран' })] : []),
      UI.el('button', {
        class: 'btn sm ghost icon-only',
        title: 'Удалить аккаунт',
        onclick: async (event) => {
          event.stopPropagation();
          await UI.req(window.api.accounts.logout(account.id));
          await reloadAccounts();
          getModal().close();
          accountModal();
        },
      }, UI.icon('trash')),
    );
    App.accountAvatar(account).then((url) => {
      if (url) avatar.append(UI.el('img', { src: url, alt: '' }));
    });
    row.addEventListener('click', async () => {
      await UI.req(window.api.accounts.select(account.id));
      await reloadAccounts();
      getModal().close();
      UI.toast(`Аккаунт ${account.username} выбран`, 'success');
      App.refresh();
    });
    return row;
  }

  function accountModal(options = {}) {
    const body = UI.el('div', { class: 'stack', style: { gap: '14px' } });
    const tabs = UI.el('div', { class: 'tabs account-tabs' });
    const paneWrap = UI.el('div', { class: 'stack', style: { gap: '12px' } });

    const panes = {};
    const tabButtons = {};

    function activate(tab) {
      for (const [key, button] of Object.entries(tabButtons)) button.classList.toggle('active', key === tab);
      for (const [key, pane] of Object.entries(panes)) pane.classList.toggle('hidden', key !== tab);
    }

    for (const [id, label] of [
      ['local', 'Офлайн'],
      ['ely', 'Ely.by'],
      ['official', 'Официальный'],
    ]) {
      const button = UI.el('button', { class: 'tab', text: label });
      button.addEventListener('click', () => activate(id));
      tabButtons[id] = button;
      tabs.append(button);
    }

    // --- офлайн ---
    const localPane = UI.el('div', { class: 'stack', style: { gap: '12px' } });
    const nickInput = UI.el('input', { class: 'input', placeholder: 'Ник, 3–16 символов: Steve_2024' });
    const localBtn = UI.el('button', { class: 'btn primary block' }, UI.icon('user'), 'Играть с этим ником');
    localPane.append(
      UI.el('div', { class: 'field' }, UI.el('label', {}, 'Ваш ник'), nickInput),
      localBtn,
      UI.el('div', { class: 'notice' }, UI.icon('info'),
        UI.el('span', {}, 'Офлайн-аккаунт — только ник, без пароля и интернета. Подходит для одиночной игры и серверов без проверки лицензии. Скин выбирается на странице «Скины».')),
    );
    panes.local = localPane;

    // --- ely.by ---
    const elyPane = UI.el('div', { class: 'stack', style: { gap: '12px' } });
    const userInput = UI.el('input', { class: 'input', placeholder: 'Ник или e-mail', autocomplete: 'off' });
    const passInput = UI.el('input', { class: 'input', type: 'password', placeholder: 'Пароль' });
    const codeInput = UI.el('input', { class: 'input', placeholder: 'Код 2FA (если включён)', style: { display: 'none' } });
    const loginBtn = UI.el('button', { class: 'btn primary block' }, UI.icon('plug'), 'Войти через Ely.by');
    const elyStatus = UI.el('div', { class: 'tiny muted' });
    elyPane.append(
      UI.el('div', { class: 'field' }, UI.el('label', {}, 'Логин Ely.by'), userInput),
      UI.el('div', { class: 'field' }, UI.el('label', {}, 'Пароль'), passInput),
      UI.el('div', { class: 'field' }, codeInput),
      loginBtn,
      elyStatus,
      UI.el('div', { class: 'notice' }, UI.icon('info'),
        UI.el('span', {}, 'Аккаунт Ely.by даёт скин в игре и вход на серверы с Ely.by. Пароль не сохраняется — только токен.')),
    );
    panes.ely = elyPane;

    // --- официальный ---
    const offPane = UI.el('div', { class: 'stack', style: { gap: '12px' } });
    const clientInput = UI.el('input', {
      class: 'input',
      placeholder: 'Client ID приложения Azure',
      value: App.state.settings.microsoftClientId || '',
    });
    const saveClient = UI.el('button', {
      class: 'btn sm',
      onclick: async () => {
        const value = clientInput.value.trim();
        await UI.req(window.api.settings.save({ microsoftClientId: value }));
        App.state.settings.microsoftClientId = value;
        UI.toast(value ? 'Client ID сохранён' : 'Client ID очищен', 'success');
      },
    }, 'Сохранить');
    const msBtn = UI.el('button', { class: 'btn primary block' }, UI.icon('shield'), 'Войти через Microsoft');
    const msStatus = UI.el('div', { class: 'stack', style: { gap: '8px' } });
    offPane.append(
      UI.el('div', { class: 'notice' }, UI.icon('alert'),
        UI.el('span', {}, 'Официальный вход требует бесплатное приложение Azure с Client ID: Microsoft не пускает лаунчеры без него. Инструкция — по кнопке ниже.')),
      UI.el('div', { class: 'field' }, UI.el('label', {}, 'Client ID'), UI.el('div', { class: 'row' }, clientInput, saveClient)),
      msBtn,
      msStatus,
      UI.el('button', {
        class: 'btn sm ghost',
        onclick: () => window.api.openExternal('https://learn.microsoft.com/ru-ru/entra/identity-platform/quickstart-register-app'),
      }, UI.icon('info'), 'Как получить Client ID'),
    );
    panes.official = offPane;

    let closed = false;

    msBtn.addEventListener('click', async () => {
      const clientId = clientInput.value.trim();
      if (!clientId) {
        clientInput.focus();
        return UI.toast('Сначала вставьте Client ID приложения Azure', 'error', 6000);
      }
      await UI.req(window.api.settings.save({ microsoftClientId: clientId }));
      App.state.settings.microsoftClientId = clientId;
      msBtn.disabled = true;
      UI.clear(msStatus);
      msStatus.append(UI.el('div', { class: 'progress-line' }, UI.el('div', { class: 'spinner' }), 'Запрашиваю код у Microsoft…'));
      try {
        const start = await UI.req(window.api.accounts.microsoftStart());
        UI.clear(msStatus);
        msStatus.append(
          UI.el('div', { class: 'device-code' }, start.userCode),
          UI.el('div', { class: 'small muted' }, 'Введите этот код на странице Microsoft и подтвердите вход.'),
          UI.el('button', {
            class: 'btn sm block',
            onclick: () => window.api.openExternal(start.verificationUri || 'https://microsoft.com/link'),
          }, UI.icon('plug'), 'Открыть страницу входа'),
          UI.el('div', { class: 'progress-line' }, UI.el('div', { class: 'spinner' }), 'Ожидаю подтверждения…'),
        );
        const result = await UI.req(window.api.accounts.microsoftPoll(start.deviceCode));
        if (result.state === 'ok') {
          await reloadAccounts();
          if (!closed) modal.close();
          UI.toast(`Добро пожаловать, ${result.account.username}`, 'success');
          App.refresh();
        } else {
          UI.clear(msStatus);
          msStatus.append(UI.el('div', { class: 'notice' }, UI.icon('alert'), UI.el('span', { text: result.error || 'Вход не выполнен' })));
        }
      } catch (error) {
        UI.clear(msStatus);
        msStatus.append(UI.el('div', { class: 'notice' }, UI.icon('alert'), UI.el('span', { text: error.message })));
      } finally {
        msBtn.disabled = false;
      }
    });

    loginBtn.addEventListener('click', async () => {
      const username = userInput.value.trim();
      const password = passInput.value;
      if (!username || !password) return UI.toast('Введите логин и пароль', 'error');
      loginBtn.disabled = true;
      UI.clear(elyStatus);
      elyStatus.append(UI.el('div', { class: 'progress-line' }, UI.el('div', { class: 'spinner' }), 'Вхожу в Ely.by…'));
      try {
        const result = await UI.req(
          window.api.accounts.login({ username, password, twoFactor: codeInput.value.trim() || undefined }),
        );
        if (result.need2fa) {
          codeInput.style.display = '';
          codeInput.focus();
          UI.clear(elyStatus);
          elyStatus.textContent = 'Введите код из приложения-аутентификатора и нажмите «Войти» снова';
          return;
        }
        if (result.error) {
          UI.clear(elyStatus);
          elyStatus.textContent = result.error;
          return;
        }
        await reloadAccounts();
        modal.close();
        UI.toast(`Добро пожаловать, ${result.account.username}`, 'success');
        App.refresh();
      } catch (error) {
        UI.clear(elyStatus);
        elyStatus.textContent = error.message;
      } finally {
        loginBtn.disabled = false;
      }
    });

    localBtn.addEventListener('click', async () => {
      if (nickInput.value.trim().length < 3) return UI.toast('Ник минимум 3 символа', 'error');
      try {
        await UI.req(window.api.accounts.local(nickInput.value.trim()));
        await reloadAccounts();
        modal.close();
        UI.toast('Офлайн-аккаунт готов', 'success');
        App.refresh();
      } catch (error) {
        UI.toast(error.message, 'error');
      }
    });

    paneWrap.append(...Object.values(panes));

    body.append(tabs, paneWrap);
    if (App.state.accounts.list.length) {
      const list = UI.el('div', { class: 'account-list' });
      for (const account of App.state.accounts.list) list.append(accountRow(account, () => modal, reloadAccounts));
      body.append(UI.el('div', { class: 'divider' }), UI.el('div', { class: 'tiny muted' }, 'Сохранённые аккаунты'), list);
    }

    const modal = UI.modal({
      title: App.state.currentAccount ? 'Аккаунты' : 'Вход в аккаунт',
      subtitle: 'Офлайн-ник, Ely.by или официальный Microsoft',
      body,
      actions: [{ label: 'Закрыть', kind: 'ghost' }],
      onClose: () => {
        closed = true;
      },
    });

    const initial = options.tab || 'local';
    activate(panes[initial] ? initial : 'local');
    if (initial === 'local') setTimeout(() => nickInput.focus(), 80);
    if (initial === 'ely') setTimeout(() => userInput.focus(), 80);
    return modal;
  }

  App.openAccount = accountModal;

  async function reloadAccounts() {
    const data = await UI.req(window.api.accounts.list());
    App.state.accounts = { current: data.current, list: data.list || [] };
    App.state.currentAccount = data.currentAccount || data.list.find((a) => a.id === data.current) || null;
    App.state.avatarCache = {};
    updateAccountCard();
    return data;
  }

  App.refreshAccount = reloadAccounts;

  function updateStatus() {
    const host = document.getElementById('tb-status');
    if (!host) return;
    const runningId = Object.keys(App.state.running || {}).find((id) => App.state.running[id]);
    const running = runningId ? (App.state.instances || []).find((item) => item.id === runningId) : null;
    if (running) {
      const loader = App.loaderLabel(running.loader);
      host.textContent = `В игре: ${running.name} · Minecraft ${running.mcVersion}${loader ? ` · ${loader}` : ''}`;
      host.classList.add('in-game');
      return;
    }
    const current = App.instance ? App.instance() : null;
    const loader = current ? App.loaderLabel(current.loader) : '';
    host.textContent = current
      ? `В лаунчере · Minecraft ${current.mcVersion}${loader ? ` · ${loader}` : ''}`
      : 'В лаунчере';
    host.classList.remove('in-game');
  }

  App.updateStatus = updateStatus;

  function updateAccountCard() {
    const name = document.getElementById('account-name');
    const sub = document.getElementById('account-sub');
    const avatarHost = document.getElementById('account-avatar');
    const account = App.state.currentAccount;
    if (!name || !sub || !avatarHost) return;
    UI.clear(avatarHost);
    if (account) {
      name.textContent = account.username;
      sub.textContent = AccountLabels[account.type] || 'аккаунт';
      const img = UI.el('img', { alt: '' });
      avatarHost.append(img);
      App.accountAvatar(account).then((url) => {
        if (url) img.src = url;
        else {
          UI.clear(avatarHost);
          avatarHost.append(UI.icon('user'));
        }
      });
    } else {
      name.textContent = 'Войти в аккаунт';
      sub.textContent = 'офлайн, Ely.by или Microsoft';
      avatarHost.append(UI.icon('user'));
    }
  }

  function bindChrome() {
    document.querySelectorAll('[data-win]').forEach((button) => {
      button.addEventListener('click', () => {
        const action = button.dataset.win;
        if (action === 'min') window.api.window.minimize();
        if (action === 'max') window.api.window.maximize();
        if (action === 'close') window.api.window.close();
      });
    });

    document.querySelectorAll('.nav-item').forEach((item) => {
      const label = item.querySelector('span');
      if (label && label.textContent.trim()) {
        item.dataset.label = label.textContent.trim();
        item.title = label.textContent.trim();
      }
      item.addEventListener('click', () => App.go(item.dataset.route));
    });

    document.getElementById('account-card').addEventListener('click', () => App.openAccount());

    window.addEventListener('hashchange', renderPage);

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        const root = document.getElementById('modal-root');
        if (root.classList.contains('open')) {
          root.classList.remove('open');
          root.innerHTML = '';
        }
      }
      if (event.key === 'F5') {
        event.preventDefault();
        App.refresh();
      }
    });
  }

  async function showCrash(input) {
    const instance = App.state.instances.find((item) => item.id === input.instanceId);
    let diagnosis = null;
    try {
      diagnosis = await UI.req(window.api.game.diagnose(input.logFile, `Код выхода: ${input.code}`));
    } catch {
      diagnosis = null;
    }
    if (!diagnosis) return;
    const body = UI.el('div', { class: 'stack', style: { gap: '12px' } });
    body.append(
      UI.el('div', { class: `notice crash-${diagnosis.kind}` }, UI.icon('alert'),
        UI.el('div', {},
          UI.el('strong', { text: diagnosis.title }),
          UI.el('p', { style: { marginTop: '4px' }, text: diagnosis.hint }),
        ),
      ),
      diagnosis.line ? UI.el('pre', { class: 'crash-line', text: diagnosis.line }) : null,
      UI.el('div', { class: 'tiny muted', text: `${instance ? instance.name : input.instanceId} • код выхода ${input.code}` }),
    );
    UI.modal({
      title: 'Игра вылетела',
      subtitle: 'Разбор лога и что можно сделать',
      body,
      actions: [
        { label: 'Понятно', kind: 'ghost' },
        {
          label: 'Открыть лог',
          kind: '',
          icon: 'terminal',
          onClick: () => {
            App.go('logs');
            return true;
          },
        },
        {
          label: 'Настройки сборки',
          kind: 'primary',
          icon: 'settings',
          onClick: () => {
            if (instance) window.Views.instances.settingsDialog(instance);
            return false;
          },
        },
      ],
    });
  }

  function bindIpc() {
    window.api.on('install:progress', (payload) => {
      App.state.progress[payload.instanceId] = payload;
      App.emit('progress', payload);
    });
    window.api.on('content:progress', (payload) => {
      App.state.progress[payload.instanceId] = payload;
      App.emit('progress', payload);
    });
    window.api.on('modpack:progress', (payload) => App.emit('modpack', payload));
    window.api.on('java:progress', (payload) => App.emit('java', payload));
    window.api.on('friends:update', (payload) => {
      App.state.friends = payload;
      const item = document.querySelector('.nav-item[data-route="friends"]');
      if (!item) return;
      let badge = item.querySelector('.nav-badge');
      const unread = payload && payload.unread ? payload.unread : 0;
      if (!unread) {
        if (badge) badge.remove();
        return;
      }
      if (!badge) {
        badge = UI.el('span', { class: 'nav-badge' });
        item.append(badge);
      }
      badge.textContent = unread > 99 ? '99+' : String(unread);
    });
    window.api.on('launch:log', (payload) => App.emit('log', payload));
    window.api.on('launch:state', async (payload) => {
      if (payload.state === 'running') {
        window.api.friends.heartbeat({ state: 'game', instanceId: payload.instanceId });
      }
      if (payload.state === 'exited') {
        window.api.friends.heartbeat({ state: 'launcher' });
      }
      if (payload.state === 'running') App.state.running[payload.instanceId] = true;
      if (payload.state === 'exited') {
        App.state.running[payload.instanceId] = false;
        if (payload.code !== 0 && payload.logFile) {
          setTimeout(() => showCrash(payload), 500);
        }
        setTimeout(() => App.reloadInstances().then(() => App.refresh()), 600);
      }
      updateStatus();
      App.emit('state', payload);
      const view = App.currentView();
      if (view && view.onEvent) view.onEvent('state', payload);
    });
  }

  async function boot() {
    bindChrome();
    bindIpc();
    if (window.Effects) {
      window.Effects.bindClicks();
    }
    try {
      App.state.info = await UI.req(window.api.info());
      const data = await UI.req(window.api.settings.get());
      App.state.settings = data.settings;
      if (window.Effects) {
        window.Effects.setSoundEnabled(data.settings.sounds !== false);
        window.Effects.applyAccent(data.settings.accent || 'lime');
        window.Effects.applyTheme(data.settings.theme || 'dark');
      }
      App.state.accounts = { current: data.accounts.current, list: data.accounts.list || [] };
      App.state.currentAccount = (data.accounts.list || []).find((a) => a.id === data.accounts.current) || null;
      App.state.instances = await UI.req(window.api.instances.list());
      const wantedInstance = App.state.settings.lastInstance;
      const instanceExists = Boolean(wantedInstance) && App.state.instances.some((item) => item.id === wantedInstance);
      App.state.selectedInstanceId = instanceExists
        ? wantedInstance
        : (App.state.instances[0] && App.state.instances[0].id) || null;
      UI.req(window.api.java.list())
        .then((list) => {
          App.state.javaList = list || [];
        })
        .catch(() => {
          App.state.javaList = App.state.javaList || [];
        });
      document.getElementById('tb-version').textContent = `v${App.state.info.version}`;
      updateStatus();
      document.title = 'Kubik Launcher';
      updateAccountCard();
      renderPage();
      window.__bootMs = Math.round(performance.now());
      if (App.state.settings.firstRun && window.Views.onboarding) {
        window.Views.onboarding.open(() => App.refresh());
      }
    } catch (error) {
      console.error(error);
      const page = document.getElementById('page');
      page.append(
        UI.el('div', { class: 'card empty' },
          UI.el('h3', {}, 'Не удалось запустить лаунчер'),
          UI.el('p', {}, error.message),
        ),
      );
    }
  }

  window.App = App;
  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(boot, 0);
  }
})();
