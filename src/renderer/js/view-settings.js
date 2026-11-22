'use strict';

window.Views = window.Views || {};

window.Views.settings = (() => {
  let unsubscribers = [];
  let lastTab = 'game';

  const SITE_URL = 'https://name-studio.github.io/kubik-launcher/';
  const GITHUB_URL = 'https://github.com/NAME-studio/kubik-launcher';
  function bugReportUrl() {
  const info = App.state.info || {};
  const title = `Ошибка в ${info.version || 'лаунчере'}`;
  const body = [
    '**Что произошло**',
    '',
    '**Как повторить**',
    '',
    '**Ожидалось**',
    '',
    `Версия: ${info.version || '—'}`,
    `Платформа: ${info.platform || '—'}`,
  ].join('\n');
  return `${GITHUB_URL}/issues/new?template=bug_report.yml&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}
  const DISCORD_URL = 'https://discord.gg/VCemrH6M44';

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

  function openAbout() {
    const info = App.state.info || {};
    const details = [
      ['Версия лаунчера', info.version || '—'],
      ['Electron', info.electron || '—'],
      ['Chromium', info.chrome || '—'],
      ['Node.js', info.node || '—'],
      ['Платформа', info.platform === 'win32' ? 'Windows' : info.platform || '—'],
      ['Папка лаунчера', info.root || '—'],
    ];
    const summary = [
      `Kubik Launcher ${info.version || ''}`.trim(),
      `Платформа: ${info.platform || ''}`,
      `Electron ${info.electron || ''} / Chromium ${info.chrome || ''} / Node ${info.node || ''}`,
      `Папка: ${info.root || ''}`,
    ].join('\n');

    const body = UI.el(
      'div',
      {},
      ...details.map(([key, value]) => UI.el('div', { class: 'kv' }, UI.el('span', {}, key), UI.el('span', {}, value))),
      UI.el(
        'p',
        { class: 'muted', style: { marginTop: '14px' } },
        'Нашли ошибку? Откройте репорт на GitHub: приложите версию, шаги, что произошло, и лог из папки logs.',
      ),
      UI.el(
        'div',
        { class: 'row', style: { gap: '8px', flexWrap: 'wrap', marginTop: '10px' } },
        UI.el('button', { class: 'btn sm', onclick: () => window.api.openExternal(SITE_URL) }, 'Сайт'),
        UI.el('button', { class: 'btn sm ghost', onclick: () => window.api.openExternal(GITHUB_URL) }, 'GitHub'),
        UI.el('button', { class: 'btn sm ghost', onclick: () => window.api.openExternal(DISCORD_URL) }, 'Discord'),
        UI.el('button', { class: 'btn sm ghost', onclick: () => window.api.openExternal(bugReportUrl()) }, 'Сообщить о баге'),
        UI.el('button', { class: 'btn sm ghost', onclick: () => window.api.openPath(info.configDir || info.root) }, UI.icon('folder'), 'Логи и конфиг'),
      ),
    );

    UI.modal({
      title: `Kubik Launcher ${info.version || ''}`.trim(),
      subtitle: 'Бесплатный лаунчер Minecraft: Fabric, Forge, NeoForge, Quilt, Modrinth и CurseForge',
      body,
      actions: [
        {
          label: 'Скопировать сведения',
          kind: 'ghost',
          onClick: () => {
            window.api.copyText(summary);
            UI.toast('Сведения скопированы', 'success');
            return false;
          },
        },
        { label: 'Закрыть', kind: 'primary' },
      ],
    });
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
    const ratio = () => (Number(slider.value) - 1024) / (max - 1024);
    slider.style.setProperty('--ratio', String(ratio()));
    slider.addEventListener('input', () => {
      badge.textContent = `${slider.value} МБ`;
      slider.style.setProperty('--ratio', String(ratio()));
    });
    slider.addEventListener('change', () => onInput(Number(slider.value)));
    return UI.el('div', { class: 'field' }, UI.el('div', { class: 'row between' }, UI.el('label', {}, 'Память по умолчанию'), badge), slider);
  }

  function sliderRow(title, min, max, step, value, suffix, onChange) {
    const badge = UI.el('span', { class: 'badge accent', text: `${value}${suffix || ''}` });
    const slider = UI.el('input', { class: 'slider', type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
    slider.style.setProperty('--ratio', String((value - min) / (max - min)));
    slider.addEventListener('input', () => {
      badge.textContent = `${slider.value}${suffix || ''}`;
      slider.style.setProperty('--ratio', String((Number(slider.value) - min) / (max - min)));
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

  function cloudCard() {
    const card = UI.el('div', { class: 'card pad' });
    card.append(UI.el('div', { class: 'card-head' }, UI.el('div', { class: 'card-title' }, UI.icon('users'), 'Облако друзей')));

    const lines = UI.el('div', { class: 'setting-block' });
    const hint = UI.el('p', {
      class: 'tiny muted',
      text: 'Настраивать ничего не нужно: друзья и общие сборки работают сразу. Откройте раздел «Друзья», скопируйте свой код и отправьте другу — он введёт его у себя и всё.',
    });

    const button = UI.el('button', { class: 'btn sm ghost' }, 'Проверить подключение');
    button.addEventListener('click', async () => {
      button.disabled = true;
      button.textContent = 'Проверяю…';
      lines.replaceChildren();
      try {
        const res = await window.api.friends.diagnose();
        if (!res || !res.ok) {
          lines.append(UI.el('p', { class: 'tiny', text: 'Ошибка: ' + ((res && res.error) || 'облако не ответило') }));
        } else {
          const data = res.data || {};
          for (const step of data.steps || []) {
            const row = UI.el('p', { class: 'tiny', text: (step.ok ? '✓ ' : '✗ ') + step.name + ': ' + step.text });
            if (!step.ok) row.style.color = 'var(--danger, #e05252)';
            lines.append(row);
          }
          if (data.code) lines.append(UI.el('p', { class: 'tiny muted', text: 'Ваш код: ' + data.code }));
        }
      } catch (error) {
        lines.append(UI.el('p', { class: 'tiny', text: 'Ошибка: ' + ((error && error.message) || 'неизвестно') }));
      }
      button.disabled = false;
      button.textContent = 'Проверить подключение';
    });

    card.append(lines, hint, button);
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
          status.style.color = 'var(--accent-text)';
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
      const rawError = String(current.error || '');
      if (/app-update\.yml|ENOENT/i.test(rawError)) {
        labels.error = 'Обновления недоступны в этой сборке: нет файла app-update.yml. Скачайте новый Setup с GitHub — автообновление работает только у установленной версии.';
      }
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
      UI.el('div', { class: 'divider' }),
      UI.el('div', {},
        UI.el('div', { class: 'kv' }, UI.el('span', {}, 'Текущая версия'), UI.el('span', {}, App.state.info.version)),
        UI.el('div', { class: 'kv' }, UI.el('span', {}, 'Источник'), UI.el('span', {}, 'GitHub releases')),
        UI.el('div', { class: 'kv' }, UI.el('span', {}, 'Тип установки'), UI.el('span', {}, 'portable / installed')),
      ),
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

    const accentValue = String(App.state.settings.accent || 'lime');
    const accentRow = UI.el('div', { class: 'accent-row' });
    const hexInput = UI.el('input', {
      class: 'input sm',
      placeholder: '#7ee787',
      value: accentValue.startsWith('#') ? accentValue : '',
      maxlength: '7',
    });
    const preview = UI.el('span', { class: 'palette-preview', style: { background: window.accentColor() } });

    const applyAccentValue = async (value) => {
      const clean = String(value || '').trim().toLowerCase();
      const isPreset = window.Effects.accentPresets().some((preset) => preset.name === clean);
      const isHex = /^#?[0-9a-f]{6}$/.test(clean);
      if (clean && !isPreset && !isHex) {
        UI.toast('Цвет в формате #RRGGBB или пресет', 'error');
        return;
      }
      const normalized = !clean ? 'lime' : isHex ? `#${clean.replace('#', '')}` : clean;
      await save({ accent: normalized });
      window.Effects.applyAccent(normalized);
      [...accentRow.children].forEach((node) => node.classList.toggle('active', node.dataset.accent === normalized));
      hexInput.value = normalized.startsWith('#') ? normalized : '';
      preview.style.background = window.accentColor();
    };

    for (const preset of window.Effects.accentPresets()) {
      accentRow.append(UI.el('button', {
        class: `accent-chip${accentValue === preset.name ? ' active' : ''}`,
        dataset: { accent: preset.name },
        title: preset.name,
        style: { background: `linear-gradient(135deg, ${preset.accent}, ${preset.accent2})` },
        onclick: () => applyAccentValue(preset.name),
      }));
    }

    const customRow = UI.el('div', { class: 'palette-custom' },
      preview,
      UI.el('input', {
        type: 'color',
        class: 'palette-input',
        value: accentValue.startsWith('#') ? accentValue : window.accentColor(),
        oninput: (event) => {
          hexInput.value = event.target.value;
          preview.style.background = event.target.value;
        },
        onchange: (event) => applyAccentValue(event.target.value),
      }),
      hexInput,
      UI.el('button', { class: 'btn sm', onclick: () => applyAccentValue(hexInput.value) }, 'Применить'),
      UI.el('button', { class: 'btn sm ghost', onclick: () => applyAccentValue('lime') }, 'Сбросить'),
    );

    card.append(
      UI.el('div', { class: 'setting-block' },
        UI.el('div', { class: 'field' },
          UI.el('label', {}, 'Тема'),
          UI.el('div', { class: 'tabs mini' },
            ...[['dark', 'Тёмная'], ['light', 'Светлая'], ['neon', 'Неон']].map(([id, label]) => {
              const tab = UI.el('button', { class: `tab${(App.state.settings.theme || 'dark') === id ? ' active' : ''}`, text: label });
              tab.addEventListener('click', async () => {
                await save({ theme: id });
                window.Effects.applyTheme(id);
                [...tab.parentElement.children].forEach((node) => node.classList.toggle('active', node === tab));
              });
              return tab;
            }),
          ),
        ),
        UI.el('div', { class: 'field' }, UI.el('label', {}, 'Акцентный цвет'), accentRow, customRow),
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

  function diagnoseCard() {
    const info = App.state.info;
    const logsDir = `${String(info.root || '').replace(/[\\/]+$/, '')}\\logs`;
    const card = UI.el('div', { class: 'card pad' });
    card.append(UI.el('div', { class: 'card-head' }, UI.el('div', { class: 'card-title' }, UI.icon('info'), 'Диагностика')));

    const copySummary = () => {
      const text = [
        `Kubik Launcher ${info.version}`,
        `Electron ${info.electron}, Chromium ${info.chrome}, Node ${info.node}`,
        `Папка: ${info.root}`,
        `Ядер CPU: ${info.cpuCount}, память ПК: ${UI.bytes(info.totalMemory)}`,
      ].join('\n');
      const done = () => UI.toast('Сведения скопированы', 'success');
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(done);
        return;
      }
      const area = UI.el('textarea', { style: { position: 'fixed', opacity: '0' } });
      area.value = text;
      document.body.append(area);
      area.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      area.remove();
      done();
    };

    card.append(
      UI.el('div', { class: 'kv' }, UI.el('span', {}, 'Electron'), UI.el('span', {}, info.electron)),
      UI.el('div', { class: 'kv' }, UI.el('span', {}, 'Память ПК'), UI.el('span', {}, UI.bytes(info.totalMemory))),
      UI.el('div', { class: 'kv' }, UI.el('span', {}, 'Ядер CPU'), UI.el('span', {}, String(info.cpuCount))),
      UI.el('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', marginTop: '10px' } },
        UI.el('button', { class: 'btn sm ghost', onclick: () => window.api.openPath(info.root) }, UI.icon('folder'), 'Папка лаунчера'),
        UI.el('button', { class: 'btn sm ghost', onclick: () => window.api.openPath(logsDir) }, UI.icon('file'), 'Логи'),
        UI.el('button', { class: 'btn sm ghost', onclick: copySummary }, UI.icon('check'), 'Скопировать сведения'),
      ),
    );
    return card;
  }

  function perfPresetCard() {
    const settings = App.state.settings;
    const card = UI.el('div', { class: 'card pad' });
    card.append(
      UI.el('div', { class: 'card-head' },
        UI.el('div', { class: 'card-title' }, UI.icon('cpu'), 'Пресеты памяти'),
        UI.el('span', { class: 'badge', text: 'быстрый выбор' }),
      ),
    );
    const presets = [
      { label: 'Слабый ПК', memory: 3072, threads: 8, note: '3 ГБ · 8 потоков' },
      { label: 'Обычный', memory: 6144, threads: 16, note: '6 ГБ · 16 потоков' },
      { label: 'Максимум', memory: 8192, threads: 24, note: '8 ГБ · 24 потока' },
    ];
    const row = UI.el('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } });
    for (const preset of presets) {
      const button = UI.el('button', {
        class: `btn sm${settings.memoryMB === preset.memory ? '' : ' ghost'}`,
        title: preset.note,
        onclick: async () => {
          button.disabled = true;
          try {
            await save({ memoryMB: preset.memory, downloadThreads: preset.threads });
            UI.toast(`Пресет «${preset.label}»: ${preset.note}`, 'success');
          } catch (error) {
            UI.toast(error.message, 'error');
          } finally {
            button.disabled = false;
          }
        },
      }, preset.label);
      row.append(button);
    }
    card.append(
      row,
      UI.el('p', { class: 'tiny muted', style: { margin: '10px 0 0' } },
        'Одна кнопка ставит память и число потоков загрузки. Аргументы JVM можно вписать ниже, если нужны свои.'),
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
          UI.el('button', { class: 'btn sm', onclick: openAbout }, UI.icon('info'), 'О лаунчере'),
          UI.el('button', { class: 'btn sm ghost', onclick: () => window.api.openExternal(BUGS_URL) }, 'Сообщить о баге'),
          UI.el('button', { class: 'btn sm ghost', onclick: () => window.api.openExternal(DISCORD_URL) }, 'Discord'),
          UI.el('button', { class: 'btn sm ghost', onclick: () => window.api.openExternal('https://modrinth.com') }, 'Modrinth'),
          UI.el('button', { class: 'btn sm', onclick: () => window.api.openExternal('https://ely.by') }, 'Ely.by'),
          UI.el('button', { class: 'btn sm ghost', onclick: () => window.api.openExternal('https://docs.ely.by/ru/minecraft-auth.html') }, 'Документация Ely.by'),
          UI.el('button', { class: 'btn sm ghost', onclick: () => window.api.openPath(info.root) }, UI.icon('folder'), 'Открыть папку'),
        ),
      );

      const groups = [
        {
          id: 'game',
          label: 'Игра',
          icon: 'play',
          cards: [
            { node: performance, weight: 6 },
            { node: javaCard(), weight: 4 },
            { node: perfPresetCard(), weight: 2 },
          ],
        },
        {
          id: 'launcher',
          label: 'Лаунчер',
          icon: 'settings',
          cards: [
            { node: launcher, weight: 7 },
            { node: updateCard(), weight: 4 },
            { node: filesCard(), weight: 4 },
            { node: appearanceCard(), weight: 4 },
            { node: diagnoseCard(), weight: 3 },
          ],
        },
        {
          id: 'account',
          label: 'Аккаунт',
          icon: 'user',
          cards: [
            { node: accountCard(), weight: 5 },
            { node: cloudCard(), weight: 3 },
            { node: discordCard(), weight: 3 },
          ],
        },
        {
          id: 'about',
          label: 'О лаунчере',
          icon: 'info',
          cards: [{ node: about, weight: 5 }],
        },
      ];
      const panes = new Map();
      const tabs = UI.el('div', { class: 'settings-tabs' });
      for (const group of groups) {
        const single = group.cards.length < 2;
        const left = UI.el('div', { class: 'settings-col' });
        const right = single ? null : UI.el('div', { class: 'settings-col' });
        let leftWeight = 0;
        let rightWeight = 0;
        for (const card of group.cards) {
          if (single || leftWeight <= rightWeight) {
            left.append(card.node);
            leftWeight += card.weight;
          } else {
            right.append(card.node);
            rightWeight += card.weight;
          }
        }
        const pane = single
          ? UI.el('div', { class: 'settings-cols single' }, left)
          : UI.el('div', { class: 'settings-cols' }, left, right);
        panes.set(group.id, pane);
        const button = UI.el('button', {
          class: 'settings-tab',
          type: 'button',
          dataset: { tab: group.id },
          onclick: () => {
            lastTab = group.id;
            for (const [id, node] of panes) node.classList.toggle('hidden', id !== group.id);
            for (const node of tabs.children) node.classList.toggle('on', node.dataset.tab === group.id);
          },
        }, UI.icon(group.icon), UI.el('span', { text: group.label }));
        tabs.append(button);
      }
      const initial = panes.has(lastTab) ? lastTab : 'game';
      for (const [id, node] of panes) node.classList.toggle('hidden', id !== initial);
      for (const node of tabs.children) node.classList.toggle('on', node.dataset.tab === initial);

      container.append(tabs, ...panes.values());
    },
    destroy() {
      unsubscribers.forEach((fn) => fn && fn());
      unsubscribers = [];
    },
  };
})();
