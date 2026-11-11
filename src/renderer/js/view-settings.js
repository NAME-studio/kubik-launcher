'use strict';

window.Views = window.Views || {};

window.Views.settings = (() => {
  let unsubscribers = [];

  async function save(patch) {
    try {
      const updated = await UI.req(window.api.settings.save(patch));
      Object.assign(App.state.settings, updated);
      return updated;
    } catch (error) {
      UI.toast(error.message, 'error');
      return null;
    }
  }

  function switchRow(title, description, value, onChange) {
    const control = UI.el('div', { class: `switch${value ? ' on' : ''}` });
    control.addEventListener('click', async () => {
      const next = !control.classList.contains('on');
      control.classList.toggle('on', next);
      await onChange(next);
    });
    return UI.el(
      'div',
      { class: 'switch-row' },
      UI.el('div', { class: 'switch-text' }, UI.el('strong', { text: title }), description ? UI.el('small', { text: description }) : null),
      control,
    );
  }

  function memorySlider(value, onInput) {
    const max = Math.max(8192, Math.round((App.state.info.totalMemory || 8e9) / 1048576));
    const badge = UI.el('span', { class: 'badge accent', text: `${value} МБ` });
    const slider = UI.el('input', { class: 'slider', type: 'range', min: '1024', max: String(max), step: '512', value: String(value) });
    const fill = () => `${((Number(slider.value) - 1024) / (max - 1024)) * 100}%`;
    slider.style.setProperty('--fill', fill());
    slider.addEventListener('input', () => {
      badge.textContent = `${slider.value} МБ`;
      slider.style.setProperty('--fill', fill());
    });
    slider.addEventListener('change', () => onInput(Number(slider.value)));
    return UI.el('div', { class: 'field' }, UI.el('div', { class: 'row between' }, UI.el('label', {}, 'Память по умолчанию'), badge), slider);
  }

  function sliderRow(title, min, max, step, value, suffix, onChange) {
    const badge = UI.el('span', { class: 'badge accent', text: `${value}${suffix || ''}` });
    const slider = UI.el('input', { class: 'slider', type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
    slider.style.setProperty('--fill', `${((value - min) / (max - min)) * 100}%`);
    slider.addEventListener('input', () => {
      badge.textContent = `${slider.value}${suffix || ''}`;
      slider.style.setProperty('--fill', `${((Number(slider.value) - min) / (max - min)) * 100}%`);
    });
    slider.addEventListener('change', () => onChange(Number(slider.value)));
    return UI.el('div', { class: 'field' }, UI.el('div', { class: 'row between' }, UI.el('label', {}, title), badge), slider);
  }

  function accountCard() {
    const account = App.state.currentAccount;
    const labels = { local: 'Офлайн-аккаунт', ely: 'Ely.by', microsoft: 'Microsoft' };
    const card = UI.el('div', { class: 'card pad full' });
    card.append(UI.el('div', { class: 'card-head' }, UI.el('div', { class: 'card-title' }, UI.icon('user'), 'Аккаунт')));

    if (!account) {
      card.append(
        UI.el(
          'div',
          { class: 'row', style: { gap: '14px', padding: '2px 0 6px' } },
          UI.el('div', { class: 'stat-icon violet' }, UI.icon('user')),
          UI.el(
            'div',
            { class: 'grow' },
            UI.el('div', { style: { fontWeight: '600' } }, 'Аккаунт не выбран'),
            UI.el('div', { class: 'small muted' }, 'Офлайн — только ник. Ely.by — скин и серверы Ely.by. Microsoft — официальная лицензия.'),
          ),
          UI.el('button', { class: 'btn', onclick: () => App.openAccount({ tab: 'local' }) }, 'Офлайн-ник'),
          UI.el('button', { class: 'btn primary', onclick: () => App.openAccount() }, 'Войти'),
        ),
      );
      return card;
    }

    const avatar = UI.el('img', { class: 'mod-icon', style: { width: '56px', height: '56px' } });
    App.accountAvatar(account).then((url) => {
      if (url) avatar.src = url;
      else avatar.classList.add('hidden');
    });
    card.append(
      UI.el(
        'div',
        { class: 'row', style: { gap: '14px' } },
        avatar,
        UI.el(
          'div',
          { class: 'grow' },
          UI.el('div', { style: { fontWeight: '650', fontSize: '15px' } }, account.username),
          UI.el('div', { class: 'small muted', text: `${labels[account.type] || 'аккаунт'} • UUID ${account.uuid}` }),
        ),
        account.type === 'local'
          ? UI.el('button', { class: 'btn sm', onclick: () => App.go('skins') }, UI.icon('shirt'), 'Скин')
          : UI.el('button', {
              class: 'btn sm',
              onclick: async () => {
                try {
                  const updated = await UI.req(window.api.accounts.refresh());
                  if (updated) {
                    UI.toast('Данные аккаунта обновлены', 'success');
                    App.refreshAccount();
                  }
                } catch (error) {
                  UI.toast(error.message, 'error');
                }
              },
            }, UI.icon('refresh'), 'Обновить'),
        UI.el('button', { class: 'btn sm ghost', onclick: () => App.openAccount() }, 'Сменить'),
      ),
    );
    return card;
  }

  function javaCard() {
    const card = UI.el('div', { class: 'card pad' });
    card.append(UI.el('div', { class: 'card-head' }, UI.el('div', { class: 'card-title' }, UI.icon('cpu'), 'Java')));
    const list = UI.el('div', { class: 'setting-block' });

    const autoRow = UI.el('div', { class: `java-option${!App.state.settings.javaPath ? ' active' : ''}` });
    autoRow.append(
      UI.el('div', { class: 'grow' }, UI.el('strong', {}, 'Автоматически'), UI.el('div', { class: 'tiny muted' }, 'Подбирать Java под версию игры и скачивать при необходимости')),
    );
    autoRow.addEventListener('click', async () => {
      await save({ javaPath: '' });
      refreshJavaActive();
    });
    list.append(autoRow);

    const rows = [];
    function refreshJavaActive() {
      autoRow.classList.toggle('active', !App.state.settings.javaPath);
      rows.forEach((row) => row.classList.toggle('active', App.state.settings.javaPath === row.dataset.path));
    }

    for (const item of App.state.javaList || []) {
      const row = UI.el('div', { class: 'java-option', dataset: { path: item.path } });
      row.append(
        UI.el('span', { class: 'badge accent', text: `Java ${item.major}` }),
        UI.el('div', { class: 'grow' }, UI.el('div', { class: 'path', text: item.path }), UI.el('div', { class: 'tiny muted', text: item.version || '' })),
      );
      row.addEventListener('click', async () => {
        await save({ javaPath: item.path });
        refreshJavaActive();
        UI.toast(`Выбрана Java ${item.major}`, 'success');
      });
      rows.push(row);
      list.append(row);
    }

    const progress = UI.el('div', { class: 'hidden' });
    const downloadButtons = UI.el(
      'div',
      { class: 'row wrap' },
      ...[8, 17, 21].map((major) =>
        UI.el('button', {
          class: 'btn sm',
          onclick: async () => {
            progress.classList.remove('hidden');
            const bar = progress.querySelector('i');
            bar.style.width = '4%';
            progress.querySelector('span').textContent = `Скачиваю Java ${major}…`;
            try {
              await UI.req(window.api.java.download(major));
              App.state.javaList = await UI.req(window.api.java.list());
              UI.toast(`Java ${major} установлена`, 'success');
              App.refresh();
            } catch (error) {
              UI.toast(error.message, 'error', 8000);
            }
          },
        }, UI.icon('download'), `Java ${major}`),
      ),
    );

    progress.append(
      UI.el('div', { class: 'progress thin' }, UI.el('i', { style: { width: '0%' } })),
      UI.el('div', { class: 'progress-label' }, UI.el('span', { text: 'Скачивание…' })),
    );

    list.append(UI.el('div', { class: 'divider' }), UI.el('div', { class: 'tiny muted', text: 'Скачать Java от Adoptium в папку лаунчера:' }), downloadButtons, progress);

    unsubscribers.push(
      App.on('java', (payload) => {
        progress.classList.remove('hidden');
        const bar = progress.querySelector('i');
        if (bar) bar.style.width = `${payload.percent || 0}%`;
        const label = progress.querySelector('span');
        if (label) label.textContent = payload.detail || 'Скачивание…';
      }),
    );

    card.append(list);
    return card;
  }

  function discordCard() {
    const card = UI.el('div', { class: 'card pad' });
    card.append(UI.el('div', { class: 'card-head' }, UI.el('div', { class: 'card-title' }, UI.icon('users'), 'Discord')));
    const status = UI.el('div', { class: 'tiny muted', text: 'Проверяю подключение…' });

    const refreshStatus = async () => {
      try {
        const res = await window.api.rpc.status();
        const data = (res && res.data) || {};
        if (!data.clientId) {
          status.style.color = '';
          status.textContent = 'Client ID не указан — статус работать не будет.';
        } else if (!data.enabled) {
          status.style.color = '';
          status.textContent = 'Статус выключен переключателем ниже.';
        } else if (data.connected) {
          status.style.color = 'var(--accent)';
          status.textContent = data.appliedAt
            ? 'Подключено, статус отправлен в Discord'
            : 'Подключено к Discord';
        } else {
          status.style.color = 'var(--danger, #ff7a7a)';
          status.textContent = `Не подключено: ${data.error || 'Discord не запущен'}`;
        }
      } catch (error) {
        status.textContent = `Не удалось проверить: ${error.message}`;
      }
    };

    const reconnect = async () => {
      status.style.color = '';
      status.textContent = 'Подключаюсь к Discord…';
      const res = await window.api.rpc.restart();
      if (res && res.data && res.data.ok === false) {
        status.textContent = `Не подключено: ${res.data.reason === 'no-id' ? 'нет Client ID' : res.data.reason === 'disabled' ? 'статус выключен' : res.data.reason}`;
        return;
      }
      await refreshStatus();
    };

    const input = UI.el('input', {
      class: 'input',
      placeholder: 'Client ID приложения Discord',
      value: App.state.settings.discordClientId || '',
      onchange: async (event) => {
        await save({ discordClientId: event.target.value.trim() });
        await reconnect();
      },
    });

    card.append(
      UI.el('div', { class: 'setting-block' },
        switchRow('Показывать статус в Discord', 'Видно, что вы в лаунчере или в игре', App.state.settings.discordRichPresence !== false, async (v) => {
          await save({ discordRichPresence: v });
          await reconnect();
        }),
        UI.el('div', { class: 'field' }, UI.el('label', {}, 'Client ID'), input),
        status,
        UI.el('div', { class: 'row', style: { gap: '8px', marginTop: '6px', flexWrap: 'wrap' } },
          UI.el('button', { class: 'btn sm', onclick: reconnect }, UI.icon('plug'), 'Проверить подключение'),
          UI.el('button', {
            class: 'btn sm ghost',
            onclick: () => window.api.openExternal('https://discord.com/developers/applications'),
          }, 'Создать приложение'),
        ),
        UI.el('p', { class: 'tiny muted' }, 'Discord должен быть запущен на этом ПК, а в настройках Discord → «Игровая активность» включён показ статуса. Client ID берётся на discord.com/developers → New Application → General Information → Application ID.'),
      ),
    );
    setTimeout(refreshStatus, 400);
    return card;
  }

  function updateCard() {
    const card = UI.el('div', { class: 'card pad' });
    card.append(UI.el('div', { class: 'card-head' }, UI.el('div', { class: 'card-title' }, UI.icon('refresh'), 'Обновления')));
    const status = UI.el('div', { class: 'tiny muted', text: '' });
    const bar = UI.el('div', { class: 'update-bar' }, UI.el('div', { class: 'update-bar-fill' }));
    const fill = bar.firstChild;
    bar.style.display = 'none';
    const actions = UI.el('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', marginTop: '8px' } });
    const releases = 'https://github.com/NAME-studio/kubik-launcher/releases';
    let current = { status: 'idle', supported: true, version: App.state.info.version, progress: 0, reason: '' };

    const render = (patch) => {
      current = { ...current, ...(patch || {}) };
      bar.style.display = current.status === 'downloading' ? 'block' : 'none';
      fill.style.width = `${current.progress || 0}%`;
      const labels = {
        idle: `Версия ${current.version}`,
        checking: 'Проверяем обновления…',
        available: `Доступна версия ${current.available}`,
        downloading: `Скачиваем обновление… ${current.progress || 0}%`,
        ready: `Версия ${current.available} готова к установке`,
        latest: 'У вас последняя версия',
        error: current.error || 'Не удалось проверить обновления',
      };
      status.textContent = current.supported ? labels[current.status] || '' : current.reason;

      actions.replaceChildren();
      if (!current.supported) {
        actions.append(UI.el('button', {
          class: 'btn sm',
          onclick: () => window.api.openExternal(releases),
        }, UI.icon('download'), 'Скачать с GitHub'));
        return;
      }
      const checkBtn = UI.el('button', {
        class: 'btn sm',
        onclick: async () => render(await UI.req(window.api.update.check())),
      }, UI.icon('refresh'), 'Проверить обновления');
      checkBtn.disabled = current.status === 'checking' || current.status === 'downloading';
      actions.append(checkBtn);
      if (current.status === 'available') {
        actions.append(UI.el('button', {
          class: 'btn sm primary',
          onclick: async () => render(await UI.req(window.api.update.download())),
        }, UI.icon('download'), 'Скачать обновление'));
      }
      if (current.status === 'ready') {
        actions.append(UI.el('button', {
          class: 'btn sm primary',
          onclick: () => window.api.update.install(),
        }, UI.icon('refresh'), 'Перезапустить и обновить'));
      }
    };

    card.append(
      status,
      bar,
      actions,
      UI.el('p', { class: 'tiny muted' }, 'Обновления приходят с GitHub-релизов репозитория kubik-launcher. Portable-версия обновляется только скачиванием нового Setup.'),
    );

    UI.req(window.api.update.state()).then(render).catch(() => {});
    unsubscribers.push(window.api.update.onStatus(render));
    return card;
  }

  function filesCard() {
    const settings = App.state.settings;
    const rootValue = settings.root || App.state.info.root;
    const rootInput = UI.el('input', { class: 'input', value: rootValue, readonly: true });
    const card = UI.el('div', { class: 'card pad' });
    card.append(UI.el('div', { class: 'card-head' }, UI.el('div', { class: 'card-title' }, UI.icon('folder'), 'Папка лаунчера')));

    const resW = UI.el('input', { class: 'input', type: 'number', value: String(settings.resolution.width), min: '640' });
    const resH = UI.el('input', { class: 'input', type: 'number', value: String(settings.resolution.height), min: '480' });
    const saveRes = UI.debounce(() => {
      save({ resolution: { ...App.state.settings.resolution, width: Number(resW.value) || 1280, height: Number(resH.value) || 720 } });
    }, 600);
    resW.addEventListener('input', saveRes);
    resH.addEventListener('input', saveRes);

    card.append(
      UI.el(
        'div',
        { class: 'field' },
        UI.el('label', {}, 'Всё хранится в одной папке: versions, libraries, assets, runtime, skins'),
        UI.el(
          'div',
          { class: 'row' },
          rootInput,
          UI.el('button', {
            class: 'btn icon-only',
            title: 'Выбрать папку',
            onclick: async () => {
              const dir = await UI.req(window.api.pickFolder('Выберите папку для данных лаунчера'));
              if (!dir) return;
              const confirmed = await UI.confirm(
                'Сменить папку данных?',
                'Новые сборки и файлы будут создаваться в новой папке. Старые останутся на месте.',
                { okText: 'Сменить' },
              );
              if (!confirmed) return;
              await save({ root: dir });
              App.state.info.root = dir;
              rootInput.value = dir;
              await App.reloadInstances();
              UI.toast('Папка изменена', 'success');
              App.refresh();
            },
          }, UI.icon('folder')),
          UI.el('button', { class: 'btn icon-only', title: 'Открыть', onclick: () => window.api.openPath(App.state.settings.root || App.state.info.root) }, UI.icon('upload')),
        ),
      ),
      UI.el(
        'div',
        { class: 'field-row' },
        UI.el('div', { class: 'field' }, UI.el('label', {}, 'Ширина окна'), resW),
        UI.el('div', { class: 'field' }, UI.el('label', {}, 'Высота окна'), resH),
      ),
      switchRow('Своё разрешение окна', 'Применять указанный размер при запуске', settings.resolution.custom, (v) =>
        save({ resolution: { ...App.state.settings.resolution, custom: v } }),
      ),
      switchRow('Полноэкранный режим', 'Запускать игру на весь экран', settings.fullscreen, (v) => save({ fullscreen: v })),
    );
    return card;
  }

  function appearanceCard() {
    const card = UI.el('div', { class: 'card pad' });
    card.append(UI.el('div', { class: 'card-head' }, UI.el('div', { class: 'card-title' }, UI.icon('sparkles'), 'Оформление и звук')));

    const accentRow = UI.el('div', { class: 'accent-row' });
    for (const name of ['lime', 'blue', 'violet', 'red', 'orange']) {
      const chip = UI.el('button', {
        class: `accent-chip${App.state.settings.accent === name ? ' active' : ''}`,
        dataset: { accent: name },
        title: name,
        onclick: async () => {
          await save({ accent: name });
          window.Effects.applyAccent(name);
          [...accentRow.children].forEach((node) => node.classList.toggle('active', node === chip));
        },
      });
      accentRow.append(chip);
    }

    card.append(
      UI.el('div', { class: 'setting-block' },
        UI.el('div', { class: 'field' }, UI.el('label', {}, 'Акцентный цвет'), accentRow),
        switchRow('Звуки интерфейса', 'Щелчки, успешное действие и ошибка', App.state.settings.sounds !== false, async (v) => {
          await save({ sounds: v });
          window.Effects.setSoundEnabled(v);
          if (v) window.Effects.sound('success');
        }),
        UI.el('div', { class: 'field' },
          UI.el('label', {}, 'CurseForge API-ключ (для вкладки CurseForge в каталоге)'),
          UI.el('div', { class: 'row' },
            UI.el('input', {
              class: 'input',
              type: 'password',
              placeholder: 'Встроенный ключ уже используется — поле можно оставить пустым',
              value: App.state.settings.curseforgeKey || '',
              onchange: async (event) => {
                await save({ curseforgeKey: event.target.value.trim() });
                UI.toast('Ключ сохранён', 'success');
              },
            }),
            UI.el('button', {
              class: 'btn sm',
              onclick: () => window.api.openExternal('https://console.curseforge.com/'),
            }, 'Получить ключ'),
          ),
        ),
      ),
    );
    return card;
  }

  return {
    title: 'Настройки',
    kicker: 'Лаунчер и игра',
    render(container) {
      unsubscribers = [];
      const settings = App.state.settings;

      const performance = UI.el('div', { class: 'card pad' });
      performance.append(UI.el('div', { class: 'card-head' }, UI.el('div', { class: 'card-title' }, UI.icon('cpu'), 'Производительность')));
      performance.append(
        UI.el('div', { class: 'setting-block' },
          memorySlider(settings.memoryMB, (value) => save({ memoryMB: value })),
          sliderRow('Потоков загрузки', 4, 32, 1, settings.downloadThreads, '', (value) => save({ downloadThreads: value })),
          UI.el('div', { class: 'field' }, UI.el('label', {}, 'Аргументы JVM'), UI.el('textarea', {
            class: 'textarea',
            value: settings.jvmArgs,
            placeholder: '-XX:+UseG1GC',
            onchange: (event) => save({ jvmArgs: event.target.value }),
          })),
          UI.el('div', { class: 'field' }, UI.el('label', {}, 'Дополнительные аргументы игры'), UI.el('textarea', {
            class: 'textarea',
            value: settings.gameArgs,
            placeholder: '--fullscreen',
            onchange: (event) => save({ gameArgs: event.target.value }),
          })),
        ),
      );

      const launcher = UI.el('div', { class: 'card pad' });
      launcher.append(UI.el('div', { class: 'card-head' }, UI.el('div', { class: 'card-title' }, UI.icon('settings'), 'Поведение лаунчера')));
      launcher.append(
        UI.el('div', { class: 'setting-block' },
          switchRow('Сворачивать при запуске игры', 'Лаунчер уйдёт в панель задач', settings.minimizeOnLaunch, (v) => save({ minimizeOnLaunch: v })),
          switchRow('Скрывать в трей после запуска', 'Игра работает, лаунчер доступен из значка в трее', settings.closeOnLaunch, (v) => save({ closeOnLaunch: v })),
          switchRow('Показывать консоль игры', 'Открывать окно cmd с логом', settings.showConsole, (v) => save({ showConsole: v })),
          switchRow('authlib-injector для Ely.by', 'Скины и вход на серверы Ely.by', settings.useAuthlibInjector, (v) => save({ useAuthlibInjector: v })),
          switchRow('Закрывать в трей', 'Лаунчер остаётся в фоне: друзья, сообщения и обновления продолжают работать', settings.closeToTray !== false, (v) => save({ closeToTray: v })),
          switchRow('Запускать с Windows', 'Автозапуск в трее при входе в систему', settings.autoStart === true, async (v) => {
            await window.api.setAutostart(v);
            await save({ autoStart: v });
          }),
          switchRow('Стартовать свёрнутым', 'При автозапуске окно не открывается, только значок в трее', settings.startInTray === true, (v) => save({ startInTray: v })),
        ),
      );

      const about = UI.el('div', { class: 'card pad full' });
      about.append(UI.el('div', { class: 'card-head' }, UI.el('div', { class: 'card-title' }, UI.icon('info'), 'О лаунчере')));
      const info = App.state.info;
      about.append(
        UI.el(
          'div',
          { class: 'grid cols-2' },
          UI.el(
            'div',
            {},
            UI.el('div', { class: 'kv' }, UI.el('span', {}, 'Версия лаунчера'), UI.el('span', {}, info.version)),
            UI.el('div', { class: 'kv' }, UI.el('span', {}, 'Electron'), UI.el('span', {}, info.electron)),
            UI.el('div', { class: 'kv' }, UI.el('span', {}, 'Chromium'), UI.el('span', {}, info.chrome)),
            UI.el('div', { class: 'kv' }, UI.el('span', {}, 'Node.js'), UI.el('span', {}, info.node)),
          ),
          UI.el(
            'div',
            {},
            UI.el('div', { class: 'kv' }, UI.el('span', {}, 'Папка лаунчера'), UI.el('span', {}, info.root)),
            UI.el('div', { class: 'kv' }, UI.el('span', {}, 'Память ПК'), UI.el('span', {}, UI.bytes(info.totalMemory))),
            UI.el('div', { class: 'kv' }, UI.el('span', {}, 'Ядер CPU'), UI.el('span', {}, String(info.cpuCount))),
          ),
        ),
        UI.el(
          'div',
          { class: 'row', style: { marginTop: '12px', gap: '8px', flexWrap: 'wrap' } },
          UI.el('button', { class: 'btn sm', onclick: () => window.api.openExternal('https://modrinth.com') }, 'Modrinth'),
          UI.el('button', { class: 'btn sm', onclick: () => window.api.openExternal('https://ely.by') }, 'Ely.by'),
          UI.el('button', { class: 'btn sm ghost', onclick: () => window.api.openExternal('https://docs.ely.by/ru/minecraft-auth.html') }, 'Документация Ely.by'),
          UI.el('button', { class: 'btn sm ghost', onclick: () => window.api.openPath(info.root) }, UI.icon('folder'), 'Открыть папку'),
        ),
      );

      const cols = UI.el('div', { class: 'settings-cols' },
        accountCard(),
        filesCard(),
        performance,
        launcher,
        updateCard(),
        javaCard(),
        appearanceCard(),
        discordCard(),
      );
      container.append(cols, UI.el('div', { class: 'settings-about' }, about));
    },
    destroy() {
      unsubscribers.forEach((fn) => fn && fn());
      unsubscribers = [];
    },
  };
})();
