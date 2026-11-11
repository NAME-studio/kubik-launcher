'use strict';

window.Views = window.Views || {};

window.Views.friends = (() => {
  const state = {
    data: null,
    selected: null,
    messages: [],
    timer: null,
    heartbeat: null,
    refs: {},
    busy: false,
  };

  function statusText(friend) {
    if (!friend.online) return 'офлайн';
    const status = friend.status || {};
    if (status.state === 'game') {
      const name = status.instanceName || 'играет';
      const server = status.server ? ` • ${status.server}` : '';
      return `в игре: ${name}${server}`;
    }
    if (status.state === 'launcher') return 'в лаунчере';
    return 'онлайн';
  }

  function initials(name) {
    return String(name || '?').slice(0, 2).toUpperCase();
  }

  function selectedFriend() {
    return (state.data && state.data.friends.find((friend) => friend.id === state.selected)) || null;
  }

  function signature(list) {
    const last = list[list.length - 1];
    return `${list.length}:${last ? last.at || '' : ''}:${last ? last.text || last.kind : ''}`;
  }

  async function load() {
    try {
      state.data = await UI.req(window.api.friends.state());
      return true;
    } catch (error) {
      state.data = state.data || { configured: false, friends: [], packs: [], me: { name: '', code: '' } };
      UI.toast(error.message, 'error', 9000);
      return false;
    }
  }

  async function loadMessages() {
    if (!state.selected) {
      state.messages = [];
      return;
    }
    try {
      state.messages = await UI.req(window.api.friends.messages(state.selected));
      await window.api.friends.read(state.selected);
    } catch {
      state.messages = [];
    }
  }

  function copy(text, label) {
    navigator.clipboard.writeText(String(text || ''));
    UI.toast(`${label || 'Скопировано'}`, 'success');
  }

  function readImageFile(file, maxWidth, maxHeight, type) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const image = new Image();
        image.onload = () => {
          const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round(image.width * scale));
          canvas.height = Math.max(1, Math.round(image.height * scale));
          canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL(type === 'png' ? 'image/png' : 'image/jpeg', 0.82));
        };
        image.onerror = () => reject(new Error('Не удалось прочитать изображение'));
        image.src = reader.result;
      };
      reader.onerror = () => reject(new Error('Не удалось открыть файл'));
      reader.readAsDataURL(file);
    });
  }

  function meCard() {
    const me = state.data.me || {};
    const code = me.code || '------';
    const avatar = me.avatar
      ? UI.el('img', { class: 'friends-me-avatar', src: me.avatar, alt: '' })
      : UI.el('div', { class: 'friends-me-avatar placeholder', text: initials(me.name) });
    const codeValue = UI.el('button', {
      class: 'friend-code',
      title: 'Скопировать код',
      onclick: () => copy(code, 'Код скопирован'),
    }, UI.el('span', { text: code }), UI.icon('file'));
    const nameValue = UI.el('button', {
      class: 'friend-me-name',
      title: 'Настроить профиль',
      onclick: () => profileDialog(),
    }, me.name || 'Без имени', UI.icon('edit'));
    return UI.el('div', { class: 'friends-me' },
      me.banner ? UI.el('div', { class: 'friends-me-banner', style: { backgroundImage: `url("${me.banner}")` } }) : null,
      UI.el('div', { class: 'friends-me-row' }, avatar, nameValue),
      me.about ? UI.el('div', { class: 'friend-about small', text: me.about }) : null,
      UI.el('div', { class: 'friends-me-label', text: 'Ваш код для друзей' }),
      codeValue,
    );
  }

  function addFriendForm() {
    const input = UI.el('input', { class: 'input sm', placeholder: 'Код друга, 6 символов', maxlength: '8' });
    const submit = async () => {
      const code = input.value.trim();
      if (!code) {
        input.focus();
        return;
      }
      submit.disabled = true;
      try {
        const friend = await UI.req(window.api.friends.add(code));
        input.value = '';
        UI.toast(`Добавлен ${friend.name}`, 'success');
        await refresh();
      } catch (error) {
        UI.toast(error.message, 'error', 9000);
      } finally {
        submit.disabled = false;
      }
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') submit();
    });
    const button = UI.el('button', { class: 'btn sm primary', onclick: submit }, UI.icon('plus'), 'Добавить');
    const row = UI.el('div', { class: 'friend-add' }, input, button);
    return row;
  }

  function friendRow(friend) {
    const active = friend.id === state.selected;
    const row = UI.el('button', { class: `friend-row${active ? ' active' : ''}`, type: 'button' },
      friend.avatar
        ? UI.el('span', { class: `friend-avatar image${friend.online ? ' online' : ''}` },
            UI.el('img', { src: friend.avatar, alt: '' }))
        : UI.el('span', { class: `friend-avatar${friend.online ? ' online' : ''}`, text: initials(friend.name) }),
      UI.el('div', { class: 'friend-text' },
        UI.el('div', { class: 'friend-name', text: friend.name }),
        UI.el('div', { class: 'friend-status-line', text: statusText(friend) }),
      ),
      friend.unread ? UI.el('span', { class: 'badge accent friend-unread', text: String(friend.unread) }) : null,
    );
    row.addEventListener('click', async () => {
      if (state.selected === friend.id) return;
      state.selected = friend.id;
      state.messages = [];
      renderList();
      renderChat(true);
      await loadMessages();
      renderChat(true);
    });
    return row;
  }

  function renderList() {
    const host = state.refs.list;
    if (!host || !state.data) return;
    UI.clear(host);
    if (!state.data.friends.length) {
      host.append(UI.el('div', { class: 'friends-empty' },
        UI.el('p', { class: 'tiny muted' }, 'Список пуст.'),
        UI.el('p', { class: 'tiny muted' }, 'Передайте другу ваш код выше — он добавит вас, а вы его код введите в поле «Код друга».'),
      ));
      return;
    }
    for (const friend of state.data.friends) host.append(friendRow(friend));
  }

  function packRow(pack) {
    const linked = (App.state.instances || []).find((instance) => instance.sharedPack === pack.id);
    const action = linked
      ? UI.el('button', {
          class: 'btn sm',
          onclick: async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            try {
              const result = await UI.req(window.api.friends.syncPack(pack.id));
              UI.toast(`Синхронизировано: +${result.installed} вам, +${result.uploaded} другу`, 'success', 6000);
              await App.reloadInstances();
              App.refresh();
            } catch (error) {
              UI.toast(error.message, 'error', 8000);
            } finally {
              button.disabled = false;
            }
          },
        }, UI.icon('refresh'), 'Синхрон')
      : UI.el('button', {
          class: 'btn sm primary',
          onclick: async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            try {
              const result = await UI.req(window.api.friends.addPack(pack.id));
              await App.reloadInstances();
              App.setInstance(result.instance.id);
              UI.toast(`Сборка «${result.instance.name}» добавлена`, 'success');
              App.refresh();
            } catch (error) {
              UI.toast(error.message, 'error', 8000);
            } finally {
              button.disabled = false;
            }
          },
        }, UI.icon('plus'), 'Себе');

    return UI.el('div', { class: 'friend-pack' },
      UI.el('div', { class: 'friend-text' },
        UI.el('div', { class: 'friend-name', text: pack.name }),
        UI.el('div', { class: 'friend-pack-meta', text: `${pack.mcVersion || ''} • модов: ${(pack.mods || []).length} • ${pack.creatorName || ''}` }),
      ),
      action,
      UI.el('button', {
        class: 'btn sm ghost icon-only',
        title: (pack.creator === (state.data.me && state.data.me.id) ? 'Удалить общую сборку у всех' : 'Выйти из общей сборки'),
        onclick: async () => {
          const mine = pack.creator === (state.data.me && state.data.me.id);
          const ok = await UI.confirm(
            mine ? 'Удалить общую сборку?' : 'Выйти из общей сборки?',
            mine
              ? 'Сборка и её список модов удалятся из облака у всех участников. Локальная сборка тоже удалится.'
              : 'Сборка пропадёт из вашего списка и не будет восстанавливаться автоматически.',
          );
          if (!ok) return;
          try {
            if (linked) {
              await UI.req(window.api.friends.deleteShared(linked.id));
            } else {
              await UI.req(window.api.friends.leavePack(pack.id));
            }
            await App.reloadInstances();
            App.refresh();
            await refresh();
            UI.toast(mine ? 'Общая сборка удалена' : 'Вы вышли из общей сборки', 'success');
          } catch (error) {
            UI.toast(error.message, 'error', 8000);
          }
        },
      }, UI.icon('trash')),
    );
  }

  function renderPacks() {
    const host = state.refs.packs;
    if (!host || !state.data) return;
    UI.clear(host);
    const packs = state.data.packs || [];
    if (!packs.length) {
      host.append(UI.el('div', { class: 'friends-empty' },
        UI.el('p', { class: 'tiny muted' }, 'Общих сборок пока нет.'),
        UI.el('p', { class: 'tiny muted' }, 'Кнопка «Сборка» в чате отправит вашу сборку другу.')));
      return;
    }
    for (const pack of packs) host.append(packRow(pack));
  }

  function chatBubble(message, friend) {
    const mine = message.from !== friend.id;
    const bubble = UI.el('div', { class: `chat-bubble${mine ? ' mine' : ''}` });
    if (message.kind === 'pack' && message.payload) {
      bubble.append(
        UI.el('div', { class: 'chat-card' },
          UI.el('strong', { text: message.payload.name || 'Сборка' }),
          UI.el('div', { class: 'tiny muted', text: `${message.payload.mcVersion || ''} • модов: ${message.payload.mods || 0}` }),
          UI.el('button', {
            class: 'btn sm primary',
            onclick: async (event) => {
              event.stopPropagation();
              try {
                UI.toast('Создаю сборку…', 'info');
                const result = await UI.req(window.api.friends.addPack(message.payload.packId));
                await App.reloadInstances();
                App.setInstance(result.instance.id);
                const failed = (result.failures || []).length;
                UI.toast(failed ? `Сборка добавлена, ${failed} модов не скачались` : `Сборка «${result.instance.name}» добавлена`, failed ? 'info' : 'success', 7000);
                App.refresh();
              } catch (error) {
                UI.toast(error.message, 'error', 8000);
              }
            },
          }, UI.icon('download'), 'Добавить себе'),
        ),
      );
    } else if (message.kind === 'invite' && message.payload) {
      bubble.append(
        UI.el('div', { class: 'chat-card' },
          UI.el('strong', {}, 'Приглашение в игру'),
          UI.el('div', { class: 'tiny muted', text: `${message.payload.instanceName || 'Сборка'} • ${message.payload.server || 'без сервера'}` }),
          UI.el('div', { class: 'row', style: { marginTop: '6px', gap: '6px', flexWrap: 'wrap' } },
            message.payload.server
              ? UI.el('button', {
                  class: 'btn sm',
                  onclick: () => copy(message.payload.server, 'Адрес сервера скопирован'),
                }, UI.icon('server'), 'Скопировать IP')
              : null,
            UI.el('button', { class: 'btn sm ghost', onclick: () => App.go('servers') }, 'Мои серверы'),
          ),
        ),
      );
    } else if (message.kind === 'server' && message.payload) {
      bubble.append(
        UI.el('div', { class: 'chat-card' },
          UI.el('strong', { text: `Сервер: ${message.payload.name || message.payload.address || ''}` }),
          UI.el('div', { class: 'tiny muted', text: message.payload.address || '' }),
          UI.el('div', { class: 'row', style: { marginTop: '6px', gap: '6px', flexWrap: 'wrap' } },
            UI.el('button', {
              class: 'btn sm primary',
              onclick: async (event) => {
                event.stopPropagation();
                try {
                  const list = await UI.req(window.api.servers.list());
                  const servers = Array.isArray(list) ? list : [];
                  if (servers.some((server) => server.address === message.payload.address)) {
                    UI.toast('Этот сервер уже есть в списке', 'info');
                    return;
                  }
                  servers.push({ name: message.payload.name || message.payload.address, address: message.payload.address });
                  await UI.req(window.api.servers.save(servers));
                  UI.toast('Сервер добавлен в «Серверы»', 'success');
                } catch (error) {
                  UI.toast(error.message, 'error');
                }
              },
            }, UI.icon('plus'), 'В мои серверы'),
            message.payload.address
              ? UI.el('button', { class: 'btn sm ghost', onclick: () => copy(message.payload.address, 'Адрес скопирован') }, UI.icon('file'), 'Копировать IP')
              : null,
          ),
        ),
      );
    } else {
      bubble.append(UI.el('div', { class: 'chat-text', text: message.text }));
    }
    bubble.append(UI.el('div', { class: 'chat-time', text: new Date(message.at || Date.now()).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) }));
    return bubble;
  }

  function renderChat(force) {
    const refs = state.refs;
    if (!refs.messages) return;
    const friend = selectedFriend();
    if (refs.title) refs.title.textContent = friend ? friend.name : 'Выберите друга';
    if (refs.status) {
      refs.status.textContent = friend ? statusText(friend) : '';
      refs.status.className = `friend-status${friend && friend.online ? ' online' : ''}`;
    }
    if (!force && refs.chatFriend === state.selected) return;
    refs.chatFriend = state.selected;
    UI.clear(refs.messages);
    if (!friend) {
      refs.messages.append(UI.el('div', { class: 'friends-empty' },
        UI.el('p', { class: 'tiny muted' }, 'Выберите друга слева или добавьте нового по коду.')));
      return;
    }
    if (!state.messages.length) {
      refs.messages.append(UI.el('div', { class: 'friends-empty' }, UI.el('p', { class: 'tiny muted' }, 'Сообщений пока нет — напишите первым.')));
    } else {
      for (const message of state.messages) refs.messages.append(chatBubble(message, friend));
    }
    requestAnimationFrame(() => {
      if (refs.messages) refs.messages.scrollTop = refs.messages.scrollHeight;
    });
  }

  async function sendMessage() {
    const refs = state.refs;
    const friend = selectedFriend();
    if (!refs.input || !friend) return;
    const text = refs.input.value.trim();
    if (!text || state.busy) return;
    state.busy = true;
    refs.input.value = '';
    try {
      await UI.req(window.api.friends.send(friend.id, text));
      state.messages = await UI.req(window.api.friends.messages(friend.id));
      renderChat(true);
      refs.input.focus();
    } catch (error) {
      UI.toast(error.message, 'error');
      refs.input.value = text;
    } finally {
      state.busy = false;
    }
  }

  function chatCard() {
    const list = UI.el('div', { class: 'friends-list' });
    const packs = UI.el('div', { class: 'friends-packs' });
    const messages = UI.el('div', { class: 'chat-messages' });
    const title = UI.el('div', { class: 'card-title', text: 'Выберите друга' });
    const status = UI.el('div', { class: 'friend-status', text: '' });
    const input = UI.el('input', { class: 'input', placeholder: 'Сообщение…' });
    const sendBtn = UI.el('button', { class: 'btn primary icon-only', title: 'Отправить', onclick: () => sendMessage() }, UI.icon('send'));

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') sendMessage();
    });

    state.refs = { list, packs, messages, title, status, input };

    const chat = UI.el('div', { class: 'card friends-chat' },
      UI.el('div', { class: 'friends-chat-head' },
        UI.el('div', { class: 'friends-chat-who' }, title, status),
        UI.el('div', { class: 'row friends-head-actions' },
          UI.el('button', { class: 'btn sm ghost', onclick: () => friendProfileDialog(state.selected) }, UI.icon('user'), 'Профиль'),
          UI.el('button', { class: 'btn sm ghost', onclick: () => sharePackDialog(state.selected) }, UI.icon('package'), 'Сборка'),
          UI.el('button', { class: 'btn sm ghost', onclick: () => inviteDialog(state.selected) }, UI.icon('server'), 'В игру'),
          UI.el('button', { class: 'btn sm ghost icon-only', title: 'Очистить чат', onclick: () => clearChatDialog(state.selected) }, UI.icon('trash')),
        ),
      ),
      messages,
      UI.el('div', { class: 'chat-composer' }, input, sendBtn),
    );

    const side = UI.el('div', { class: 'card friends-side' },
      UI.el('div', { class: 'card-head' },
        UI.el('div', { class: 'card-title' }, UI.icon('users'), 'Друзья'),
        UI.el('button', { class: 'btn sm ghost icon-only', title: 'Обновить', onclick: () => refresh() }, UI.icon('refresh')),
      ),
      meCard(),
      addFriendForm(),
      list,
    );

    const packsCard = UI.el('div', { class: 'card friends-packs-card' },
      UI.el('div', { class: 'card-head' },
        UI.el('div', { class: 'card-title' }, UI.icon('package'), 'Общие сборки'),
        UI.el('button', { class: 'btn sm ghost icon-only', title: 'Создать общую сборку', onclick: () => createSharedDialog() }, UI.icon('plus')),
      ),
      packs,
      UI.el('div', { class: 'notice compact' }, UI.icon('info'),
        UI.el('span', {}, 'Общая сборка одна у вас и у друга: кто добавит мод — он появится у обоих.')),
    );

    return UI.el('div', { class: 'friends-layout' }, side, chat, packsCard);
  }

  function setupCard() {
    const nameInput = UI.el('input', {
      class: 'input',
      placeholder: 'Ваше имя для друзей',
      value: (state.data.me && state.data.me.name) || '',
    });
    const enable = UI.el('button', { class: 'btn primary' }, UI.icon('users'), 'Включить друзей');
    enable.addEventListener('click', async () => {
      if (!nameInput.value.trim()) {
        UI.toast('Введите имя', 'error');
        return;
      }
      enable.disabled = true;
      try {
        await UI.req(window.api.friends.setup(nameInput.value.trim()));
        await refresh();
      } catch (error) {
        UI.toast(error.message, 'error', 9000);
      } finally {
        enable.disabled = false;
      }
    });

    return UI.el('div', { class: 'card pad friends-setup' },
      UI.el('div', { class: 'card-title', style: { marginBottom: '10px' } }, UI.icon('users'), 'Друзья через облако'),
      UI.el('p', { class: 'muted', style: { marginBottom: '14px' } },
        'Друзья работают через облако Firebase: без серверов, VPN и облачных дисков. Вы получаете код, друг вводит его у себя — и вы видите друг друга в списке.'),
      UI.el('div', { class: 'field' }, UI.el('label', {}, 'Ваше имя для друзей'), nameInput),
      UI.el('div', { class: 'field' }, enable),
    );
  }

  function profileDialog() {
    const me = (state.data && state.data.me) || {};
    let avatar = me.avatar || '';
    let banner = me.banner || '';
    let busy = false;

    const bannerBox = UI.el('div', {
      class: 'profile-banner-preview',
      style: banner ? { backgroundImage: `url("${banner}")` } : {},
    }, banner ? null : UI.el('span', { class: 'profile-banner-hint', text: 'Баннер профиля' }));

    const avatarBox = UI.el('div', { class: 'profile-avatar-preview' },
      avatar ? UI.el('img', { src: avatar, alt: '' }) : UI.el('span', { text: initials(me.name) }));

    const paint = () => {
      UI.clear(bannerBox);
      if (banner) bannerBox.style.backgroundImage = `url("${banner}")`;
      else bannerBox.append(UI.el('span', { class: 'profile-banner-hint', text: 'Баннер профиля' }));
      UI.clear(avatarBox);
      if (avatar) avatarBox.append(UI.el('img', { src: avatar, alt: '' }));
      else avatarBox.append(UI.el('span', { text: initials(nameInput.value || me.name) }));
    };

    const nameInput = UI.el('input', { class: 'input', value: me.name || '', placeholder: 'Имя для друзей' });
    const about = UI.el('input', { class: 'input', value: me.about || '', placeholder: 'О себе, например: играю вечером' });

    const bannerInput = UI.el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    const avatarInput = UI.el('input', { type: 'file', accept: 'image/*', style: { display: 'none' } });
    bannerInput.addEventListener('change', async () => {
      const file = bannerInput.files && bannerInput.files[0];
      if (!file) return;
      banner = await readImageFile(file, 900, 300, 'jpeg');
      paint();
    });
    avatarInput.addEventListener('change', async () => {
      const file = avatarInput.files && avatarInput.files[0];
      if (!file) return;
      avatar = await readImageFile(file, 256, 256, 'png');
      paint();
    });

    return UI.modal({
      title: 'Мой профиль',
      subtitle: `Ваш код: ${me.code || ''}`,
      wide: true,
      body: UI.el('div', { class: 'stack', style: { gap: '12px' } },
        UI.el('div', { class: 'profile-banner-wrap' }, bannerBox,
          UI.el('div', { class: 'row', style: { gap: '8px', marginTop: '8px', flexWrap: 'wrap' } },
            UI.el('button', { class: 'btn sm', onclick: () => bannerInput.click() }, UI.icon('image'), 'Загрузить баннер'),
            banner ? UI.el('button', { class: 'btn sm ghost', onclick: () => { banner = ''; paint(); } }, 'Убрать') : null,
          ),
        ),
        UI.el('div', { class: 'row', style: { gap: '12px', alignItems: 'center' } },
          avatarBox,
          UI.el('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap' } },
            UI.el('button', { class: 'btn sm', onclick: () => avatarInput.click() }, UI.icon('image'), 'Загрузить аватар'),
            avatar ? UI.el('button', { class: 'btn sm ghost', onclick: () => { avatar = ''; paint(); } }, 'Убрать') : null,
          ),
        ),
        UI.el('div', { class: 'field' }, UI.el('label', {}, 'Как вас видят друзья'), nameInput),
        UI.el('div', { class: 'field' }, UI.el('label', {}, 'О себе'), about),
        UI.el('div', { class: 'notice' }, UI.icon('info'), UI.el('span', {}, 'Аватар и баннер видят друзья в профиле. Код не меняется.')),
        bannerInput,
        avatarInput,
      ),
      actions: [
        { label: 'Отмена', kind: 'ghost' },
        {
          label: 'Сохранить',
          kind: 'primary',
          onClick: async () => {
            if (busy) return false;
            busy = true;
            try {
              await UI.req(window.api.friends.saveProfile({
                name: nameInput.value.trim(),
                about: about.value.trim(),
                avatar,
                banner,
              }));
              await refresh();
              UI.toast('Профиль сохранён', 'success');
            } catch (error) {
              UI.toast(error.message, 'error', 8000);
              return false;
            } finally {
              busy = false;
            }
          },
        },
      ],
    });
  }

  function friendProfileDialog(friendId) {
    if (!friendId) {
      UI.toast('Выберите друга', 'info');
      return null;
    }
    const body = UI.el('div', { class: 'stack', style: { gap: '12px' } }, UI.el('div', { class: 'skeleton', style: { minHeight: '90px' } }));
    const modal = UI.modal({
      title: 'Профиль друга',
      subtitle: 'Данные из облака',
      body,
      actions: [{ label: 'Закрыть', kind: 'ghost' }],
    });

    window.api.friends.profile(friendId).then((res) => {
      UI.clear(body);
      if (!res || !res.ok) {
        body.append(UI.el('div', { class: 'notice' }, UI.icon('alert'), UI.el('span', { text: (res && res.error) || 'Не удалось загрузить профиль' })));
        return;
      }
      const data = res.data;
      const status =
        data.status && data.status.state === 'game'
          ? `в игре: ${data.status.instanceName || 'Minecraft'}${data.status.server ? ` • ${data.status.server}` : ''}`
          : data.online
            ? 'в лаунчере'
            : 'офлайн';
      body.append(
        ...[
          data.banner ? UI.el('div', { class: 'friend-banner', style: { backgroundImage: `url("${data.banner}")` } }) : null,
          UI.el('div', { class: 'friend-profile-head' },
            data.avatar
              ? UI.el('span', { class: `friend-avatar big image${data.online ? ' online' : ''}` }, UI.el('img', { src: data.avatar, alt: '' }))
              : UI.el('span', { class: `friend-avatar big${data.online ? ' online' : ''}`, text: initials(data.name) }),
            UI.el('div', { class: 'friend-text' },
              UI.el('div', { class: 'friend-profile-name', text: data.name || data.code }),
              UI.el('div', { class: 'friend-status-line', text: status }),
            ),
          ),
          data.about ? UI.el('div', { class: 'friend-about', text: data.about }) : null,
          UI.el('div', { class: 'kv' }, UI.el('span', {}, 'Код'), UI.el('span', {}, data.code || '—')),
          UI.el('div', { class: 'kv' }, UI.el('span', {}, 'Сообщений в чате'), UI.el('span', {}, String(data.messages || 0))),
          UI.el('div', { class: 'kv' }, UI.el('span', {}, 'Последняя активность'), UI.el('span', {}, data.updated ? new Date(data.updated).toLocaleString('ru-RU') : '—')),
          UI.el('div', { class: 'row', style: { gap: '8px', marginTop: '6px', flexWrap: 'wrap' } },
            UI.el('button', { class: 'btn sm ghost', onclick: () => clearChatDialog(friendId) }, UI.icon('trash'), 'Очистить чат'),
            UI.el('button', {
              class: 'btn sm ghost',
              onclick: async () => {
                const ok = await UI.confirm('Удалить друга?', 'Переписка останется в облаке, пока вы не очистите чат.');
                if (!ok) return;
                try {
                  await UI.req(window.api.friends.remove(friendId));
                  modal.close();
                  await refresh();
                } catch (error) {
                  UI.toast(error.message, 'error');
                }
              },
            }, UI.icon('user'), 'Удалить друга'),
          ),
        ].filter(Boolean),
      );
    }).catch((error) => {
      UI.clear(body);
      body.append(UI.el('div', { class: 'notice' }, UI.icon('alert'), UI.el('span', { text: error.message })));
    });
    return modal;
  }

  function clearChatDialog(friendId) {
    if (!friendId) {
      UI.toast('Выберите друга', 'info');
      return null;
    }
    return UI.modal({
      title: 'Очистить чат',
      subtitle: 'Сообщения удалятся у обоих участников',
      body: UI.el('div', { class: 'notice' }, UI.icon('alert'),
        UI.el('span', {}, 'Действие необратимо: история переписки удалится из облака полностью.')),
      actions: [
        { label: 'Отмена', kind: 'ghost' },
        {
          label: 'Очистить',
          kind: 'danger',
          onClick: async () => {
            try {
              const res = await UI.req(window.api.friends.clear(friendId));
              state.messages = [];
              state.refs.chatFriend = null;
              renderChat(true);
              UI.toast(`Чат очищен: ${res.removed} сообщений`, 'success');
              await refresh();
            } catch (error) {
              UI.toast(error.message, 'error');
              return false;
            }
          },
        },
      ],
    });
  }

  async function refresh() {
    const ok = await load();
    if (!ok) return;
    if (state.selected && !state.data.friends.some((friend) => friend.id === state.selected)) {
      state.selected = null;
    }
    if (!state.selected && state.data.friends.length) state.selected = state.data.friends[0].id;
    renderPage();
    if (state.selected) {
      await loadMessages();
      renderChat(true);
    }
  }

  async function tick() {
    if (!state.data) {
      await refresh();
      return;
    }
    const previous = signature(state.messages);
    const previousCount = (state.data.friends || []).length;
    if (!(await load())) return;
    if (!state.data.friends.some((friend) => friend.id === state.selected)) {
      state.selected = state.data.friends.length ? state.data.friends[0].id : null;
      state.messages = [];
    }
    renderList();
    renderPacks();
    if (state.selected) {
      try {
        const fresh = await UI.req(window.api.friends.messages(state.selected));
        if (signature(fresh) !== previous) {
          state.messages = fresh;
          renderChat(true);
          await window.api.friends.read(state.selected);
        }
      } catch {
        /* не мешаем интерфейсу */
      }
    }
    if (previousCount !== state.data.friends.length) renderChat(true);
    renderChat(false);
  }

  function renderPage() {
    const host = document.getElementById('friends-view');
    if (!host) return;
    UI.clear(host);
    state.refs = {};
    if (!state.data) return;
    if (!state.data.me || !state.data.me.name) {
      host.append(setupCard());
      return;
    }
    if (!state.selected && state.data.friends.length) state.selected = state.data.friends[0].id;
    host.append(chatCard());
    renderList();
    renderPacks();
    renderChat(true);
  }

  function createSharedDialog() {
    const instances = App.state.instances || [];
    const friends = (state.data && state.data.friends) || [];
    if (!instances.length) {
      UI.toast('Сначала создайте сборку на вкладке «Сборки»', 'info', 6000);
      return null;
    }
    if (!friends.length) {
      UI.toast('Сначала добавьте друга по коду', 'info', 6000);
      return null;
    }
    const select = UI.el('select', { class: 'select' });
    for (const instance of instances) select.append(UI.el('option', { value: instance.id, text: `${instance.name} • ${instance.mcVersion}` }));
    const checks = UI.el('div', { class: 'stack', style: { gap: '6px' } });
    const boxes = [];
    for (const friend of friends) {
      const box = UI.el('input', { type: 'checkbox', checked: true, value: friend.id });
      boxes.push(box);
      checks.append(UI.el('label', { class: 'row', style: { gap: '8px', alignItems: 'center' } }, box, UI.el('span', { text: friend.name })));
    }
    return UI.modal({
      title: 'Создать общую сборку',
      subtitle: 'Она появится у выбранных друзей и будет синхронизироваться',
      body: UI.el('div', { class: 'stack', style: { gap: '12px' } },
        UI.el('div', { class: 'field' }, UI.el('label', {}, 'Моя сборка'), select),
        UI.el('div', { class: 'field' }, UI.el('label', {}, 'С кем поделиться'), checks),
        UI.el('div', { class: 'notice' }, UI.icon('info'), UI.el('span', {}, 'Сборка создастся у друга сама. Дальше любой добавленный мод подтянется к обоим.')),
      ),
      actions: [
        { label: 'Отмена', kind: 'ghost' },
        {
          label: 'Создать общую',
          kind: 'primary',
          icon: 'users',
          onClick: async () => {
            const ids = boxes.filter((box) => box.checked).map((box) => box.value);
            if (!ids.length) {
              UI.toast('Выберите хотя бы одного друга', 'info');
              return false;
            }
            try {
              await UI.req(window.api.friends.sharePack(select.value, ids));
              UI.toast('Общая сборка создана', 'success');
              await App.reloadInstances();
              await refresh();
            } catch (error) {
              UI.toast(error.message, 'error', 8000);
              return false;
            }
          },
        },
      ],
    });
  }

  function sharePackDialog(friendId) {
    if (!friendId) {
      UI.toast('Выберите друга', 'info');
      return null;
    }
    if (!App.state.instances.length) {
      UI.toast('Сначала создайте сборку', 'info');
      return null;
    }
    const select = UI.el('select', { class: 'select' });
    for (const instance of App.state.instances) select.append(UI.el('option', { value: instance.id, text: `${instance.name} • ${instance.mcVersion}` }));
    return UI.modal({
      title: 'Поделиться сборкой',
      subtitle: 'Друг сможет добавить её себе одной кнопкой',
      body: UI.el('div', { class: 'stack', style: { gap: '12px' } },
        UI.el('div', { class: 'field' }, UI.el('label', {}, 'Сборка'), select),
        UI.el('div', { class: 'notice' }, UI.icon('info'), UI.el('span', {}, 'В общую сборку попадут моды, установленные через каталог. Ручные jar-файлы не передаются.')),
      ),
      actions: [
        { label: 'Отмена', kind: 'ghost' },
        {
          label: 'Поделиться',
          kind: 'primary',
          icon: 'upload',
          onClick: async () => {
            try {
              const pack = await UI.req(window.api.friends.sharePack(select.value, [friendId]));
              UI.toast(`Сборка «${pack.name}» отправлена`, 'success');
              await refresh();
            } catch (error) {
              UI.toast(error.message, 'error');
              return false;
            }
          },
        },
      ],
    });
  }

  function inviteDialog(friendId) {
    if (!friendId) {
      UI.toast('Выберите друга', 'info');
      return null;
    }
    const instances = App.state.instances || [];
    const select = UI.el('select', { class: 'select' });
    if (!instances.length) select.append(UI.el('option', { value: '', text: 'Сборок нет' }));
    for (const instance of instances) select.append(UI.el('option', { value: instance.id, text: `${instance.name} • ${instance.mcVersion}` }));
    const serverInput = UI.el('input', { class: 'input', placeholder: 'play.example.ru:25565' });
    const textInput = UI.el('input', { class: 'input', placeholder: 'Текст приглашения (необязательно)', value: 'Поиграем?' });

    return UI.modal({
      title: 'Пригласить в игру',
      subtitle: 'Друг получит адрес сервера и название сборки',
      body: UI.el('div', { class: 'stack', style: { gap: '12px' } },
        UI.el('div', { class: 'field' }, UI.el('label', {}, 'Сборка'), select),
        UI.el('div', { class: 'field' }, UI.el('label', {}, 'Адрес сервера'), serverInput),
        UI.el('div', { class: 'field' }, UI.el('label', {}, 'Сообщение'), textInput),
      ),
      actions: [
        { label: 'Отмена', kind: 'ghost' },
        {
          label: 'Отправить',
          kind: 'primary',
          icon: 'send',
          onClick: async () => {
            const instance = instances.find((item) => item.id === select.value);
            try {
              await UI.req(window.api.friends.send(friendId, textInput.value.trim() || 'Поиграем?', 'invite', {
                server: serverInput.value.trim(),
                instanceName: instance ? instance.name : '',
                instanceId: instance ? instance.id : '',
              }));
              state.messages = await UI.req(window.api.friends.messages(friendId));
              renderChat(true);
            } catch (error) {
              UI.toast(error.message, 'error');
              return false;
            }
          },
        },
      ],
    });
  }

  return {
    title: 'Друзья',
    kicker: 'Чат, статусы и общие сборки через облако',
    render(container, actions) {
      const host = UI.el('div', { id: 'friends-view' });
      container.append(host);
      if (actions) {
        UI.clear(actions);
        actions.append(
          UI.el('button', { class: 'btn sm ghost', onclick: () => refresh() }, UI.icon('refresh'), 'Обновить'),
        );
      }
      state.data = null;
      state.selected = null;
      state.messages = [];
      refresh();
      clearInterval(state.timer);
      state.timer = setInterval(() => tick(), 6000);
      clearInterval(state.heartbeat);
      state.heartbeat = setInterval(() => {
        if (state.data && state.data.me && state.data.me.name) {
          window.api.friends.heartbeat({ state: Object.values(App.state.running).some(Boolean) ? 'game' : 'launcher' });
        }
      }, 25000);
    },
    destroy() {
      clearInterval(state.timer);
      clearInterval(state.heartbeat);
      state.refs = {};
    },
  };
})();
