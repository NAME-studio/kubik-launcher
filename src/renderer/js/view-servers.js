'use strict';

window.Views = window.Views || {};

window.Views.servers = (() => {
  const state = { servers: [], status: {}, loading: false, token: 0 };

  function normalizeAddress(value) {
    return String(value || '')
      .trim()
      .replace(/^minecraft:\/\//i, '')
      .replace(/\/+$/, '');
  }

  async function loadServers() {
    try {
      state.servers = await UI.req(window.api.servers.list());
    } catch {
      state.servers = [];
    }
    return state.servers;
  }

  async function persist() {
    try {
      state.servers = await UI.req(window.api.servers.save(state.servers));
    } catch (error) {
      UI.toast(error.message, 'error');
    }
  }

  function addDialog() {
    const nameInput = UI.el('input', { class: 'input', placeholder: 'Название, например «Мой сервер»' });
    const addressInput = UI.el('input', { class: 'input', placeholder: 'play.example.ru:25565' });
    const body = UI.el('div', { class: 'stack', style: { gap: '12px' } },
      UI.el('div', { class: 'field' }, UI.el('label', {}, 'Название'), nameInput),
      UI.el('div', { class: 'field' }, UI.el('label', {}, 'Адрес (IP или домен, можно с портом)'), addressInput),
      UI.el('div', { class: 'notice' }, UI.icon('info'),
        UI.el('span', {}, 'Лаунчер проверяет статус по протоколу Minecraft (Server List Ping) — сервер должен быть онлайн и разрешать запросы статуса.')),
    );
    const modal = UI.modal({
      title: 'Новый сервер',
      subtitle: 'Добавьте адрес и проверяйте онлайн прямо в лаунчере',
      body,
      actions: [
        { label: 'Отмена', kind: 'ghost' },
        {
          label: 'Добавить',
          kind: 'primary',
          icon: 'plus',
          onClick: async () => {
            const address = normalizeAddress(addressInput.value);
            if (!address) {
              UI.toast('Введите адрес сервера', 'error');
              return false;
            }
            if (state.servers.length >= 60) {
              UI.toast('Слишком много серверов — максимум 60', 'error');
              return false;
            }
            state.servers.push({
              id: `srv-${Date.now().toString(36)}`,
              name: nameInput.value.trim() || address,
              address,
            });
            await persist();
            UI.toast('Сервер добавлен', 'success');
            App.refresh();
            return true;
          },
        },
      ],
    });
    setTimeout(() => nameInput.focus(), 60);
    return modal;
  }

  async function pingAll(hostList) {
    const token = ++state.token;
    await Promise.all(
      state.servers.map(async (server) => {
        if (!hostList) return;
        const result = await window.api.servers.ping(server.address);
        if (token !== state.token) return;
        state.status[server.address] = result.ok ? result.data : { online: false, error: (result && result.error) || 'Ошибка' };
        renderList(hostList);
      }),
    );
  }

  async function joinServer(server) {
    const list = App.state.instances || [];
    if (!list.length) {
      UI.toast('Сначала создайте сборку — сервер запустится внутри неё', 'info', 6000);
      return;
    }
    const settings = App.state.settings || {};
    const preferred = list.find((item) => item.id === settings.lastInstance) || list[0];
    try {
      UI.toast(`Запускаю «${preferred.name}» и подключаюсь к ${server.address}`, 'info', 6000);
      const result = await UI.req(window.api.game.launch(preferred.id, server.address));
      App.state.running[preferred.id] = true;
      App.state.logFiles = App.state.logFiles || {};
      App.state.logFiles[preferred.id] = result.logFile;
      App.refresh();
    } catch (error) {
      if (App.showLaunchError) App.showLaunchError(preferred, error);
      else UI.toast(error.message, 'error', 9000);
    }
  }

  function serverCard(server, hostList) {
    const status = state.status[server.address];
    const online = status && status.online;
    const dot = UI.el('span', { class: `server-dot ${status ? (online ? 'online' : 'offline') : ''}` });

    const meta = UI.el('div', { class: 'server-meta' });
    if (!status) meta.append(UI.el('span', {}, 'проверяю…'));
    else if (online) {
      meta.append(
        UI.el('span', {}, `${status.players && status.players.online != null ? status.players.online : 0} / ${status.players && status.players.max != null ? status.players.max : '?'} игроков`),
        UI.el('span', {}, status.version || ''),
        UI.el('span', {}, `${status.latency} мс`),
      );
    } else {
      meta.append(UI.el('span', {}, status.error || 'Недоступен'));
    }

    return UI.el('div', { class: 'server-card' },
      UI.el('div', { class: 'server-icon' }, status && status.icon
        ? UI.el('img', { src: status.icon, alt: '', style: { width: '46px', height: '46px', borderRadius: '10px' } })
        : UI.icon('server')),
      UI.el('div', { class: 'grow' },
        UI.el('div', { class: 'row', style: { gap: '8px', alignItems: 'center' } }, dot, UI.el('div', { class: 'server-name', text: server.name })),
        UI.el('div', { class: 'tiny muted', text: server.address }),
        meta,
        status && status.motd ? UI.el('div', { class: 'tiny', style: { marginTop: '4px', color: 'var(--muted)' }, text: status.motd }) : null,
      ),
      UI.el('button', {
        class: 'btn sm primary',
        title: 'Запустить игру и подключиться',
        onclick: (event) => {
          event.stopPropagation();
          joinServer(server);
        },
      }, UI.icon('play'), 'Играть'),
      UI.el('button', {
        class: 'btn sm ghost icon-only',
        title: 'Поделиться с другом',
        onclick: () => shareServerDialog(server),
      }, UI.icon('send')),
      UI.el('button', {
        class: 'btn sm ghost icon-only',
        title: 'Проверить снова',
        onclick: async () => {
          state.status[server.address] = undefined;
          renderList(hostList);
          await pingOne(server, hostList);
        },
      }, UI.icon('refresh')),
      UI.el('button', {
        class: 'btn sm ghost icon-only',
        title: 'Удалить сервер',
        onclick: async () => {
          state.servers = state.servers.filter((item) => item.id !== server.id);
          delete state.status[server.address];
          await persist();
          UI.toast('Сервер удалён', 'success');
          App.refresh();
        },
      }, UI.icon('trash')),
    );
  }

  async function shareServerDialog(server) {
    let friends = [];
    try {
      const state = await UI.req(window.api.friends.state());
      friends = (state && state.friends) || [];
    } catch (error) {
      UI.toast(error.message, 'error');
      return;
    }
    if (!friends.length) {
      UI.toast('Сначала добавьте друга на вкладке «Друзья»', 'info', 6000);
      return;
    }
    const select = UI.el('select', { class: 'select' });
    for (const friend of friends) select.append(UI.el('option', { value: friend.id, text: friend.name }));

    UI.modal({
      title: 'Поделиться сервером',
      subtitle: server.name || server.address,
      body: UI.el('div', { class: 'stack', style: { gap: '12px' } },
        UI.el('div', { class: 'field' }, UI.el('label', {}, 'Кому отправить'), select),
        UI.el('div', { class: 'notice' }, UI.icon('info'),
          UI.el('span', {}, 'Другу придёт карточка сервера в чат — одной кнопкой добавит его себе в список.')),
      ),
      actions: [
        { label: 'Отмена', kind: 'ghost' },
        {
          label: 'Отправить',
          kind: 'primary',
          icon: 'send',
          onClick: async () => {
            try {
              await UI.req(window.api.friends.send(select.value, `Сервер ${server.name || server.address}`, 'server', {
                name: server.name || server.address,
                address: server.address,
              }));
              UI.toast('Сервер отправлен другу', 'success');
            } catch (error) {
              UI.toast(error.message, 'error');
              return false;
            }
          },
        },
      ],
    });
  }

  async function pingOne(server, hostList) {
    const result = await window.api.servers.ping(server.address);
    state.status[server.address] = result.ok ? result.data : { online: false, error: (result && result.error) || 'Ошибка' };
    renderList(hostList);
  }

  let hostRef = null;

  function renderList(host) {
    const target = host || hostRef;
    if (!target) return;
    UI.clear(target);
    if (!state.servers.length) {
      target.append(
        UI.el('div', { class: 'card empty', style: { padding: '28px' } },
          UI.el('h3', {}, 'Пока нет серверов'),
          UI.el('p', {}, 'Добавьте адрес — лаунчер покажет онлайн, пинг и версию сервера.'),
        ),
      );
      return;
    }
    const list = UI.el('div', { class: 'server-list' });
    for (const server of state.servers) list.append(serverCard(server, target));
    target.append(list);
  }

  return {
    title: 'Серверы',
    kicker: 'Онлайн, пинг и версия',
    render(container, actions) {
      hostRef = UI.el('div');
      state.status = {};
      UI.clear(actions || document.getElementById('page-actions'));
      actions.append(
        UI.el('div', { class: 'row', style: { gap: '8px' } },
          UI.el('button', {
            class: 'btn sm',
            onclick: () => {
              const token = ++state.token;
              state.status = {};
              renderList(hostRef);
              pingAll(hostRef);
              return token;
            },
          }, UI.icon('refresh'), 'Обновить'),
          UI.el('button', { class: 'btn sm primary', onclick: () => addDialog() }, UI.icon('plus'), 'Добавить сервер'),
        ),
      );
      container.append(hostRef);
      renderList(hostRef);
      loadServers().then(() => {
        renderList(hostRef);
        pingAll(hostRef);
      });
    },
    destroy() {
      state.token += 1;
      hostRef = null;
    },
  };
})();
