'use strict';

window.Views = window.Views || {};

window.Views.skins = (() => {
  const PALETTE = [
    ['#ffffff', '#d9d9d9', '#b3b3b3', '#8c8c8c', '#666666', '#404040', '#262626', '#0f0f0f'],
    ['#f8d8b0', '#e8bd91', '#cf9f71', '#b07f52', '#8c6039', '#6a4526', '#4a2e18', '#2c1a0d'],
    ['#ffd8a8', '#ffbf7a', '#ff9f52', '#f07b3a', '#c9562a', '#9c3a1c', '#6f2611', '#45160a'],
    ['#ffe066', '#ffc93c', '#f5a623', '#d98618', '#a86412', '#7a460d', '#4d2b08', '#261403'],
    ['#d8f5a2', '#b2e061', '#8cc63f', '#6aa329', '#4d7c1a', '#34540f', '#203609', '#101d04'],
    ['#8ce86a', '#54cc57', '#2faf58', '#1d8f52', '#146b44', '#0d4a32', '#082e21', '#04150f'],
    ['#a8e6ff', '#6fd0f5', '#3ab1e0', '#2489b8', '#1a668c', '#124763', '#0a2e42', '#041720'],
    ['#8fa8ff', '#667df0', '#4a58d6', '#363fae', '#252b82', '#181c59', '#0e1038', '#050618'],
    ['#d0b3ff', '#ab8bf0', '#8a63d6', '#6845ab', '#4a2f80', '#301e56', '#1c1033', '#0a0515'],
    ['#ffb3d1', '#ff8ab6', '#f5639a', '#d1417a', '#a32a5c', '#751a40', '#4a0f27', '#210612'],
  ];

  let editor = null;
  let refs = {};
  let state = {};

  function account() {
    return App.state.currentAccount;
  }

  function renderPreview() {
    if (!refs.preview || !editor) return;
    window.SkinRender.drawCharacter(refs.preview, editor.tex, {
      model: state.model,
      view: state.view,
      scale: 9,
    });
  }

  function setDirty(dirty) {
    if (!refs.dirtyBadge) return;
    refs.dirtyBadge.textContent = dirty ? 'изменён' : 'сохранён';
    refs.dirtyBadge.className = `badge ${dirty ? 'orange' : ''}`;
  }

  function updateModelButtons() {
    if (!refs.modelButtons) return;
    for (const button of refs.modelButtons.children) {
      button.classList.toggle('active', button.dataset.model === state.model);
    }
    if (editor) editor.setModel(state.model);
    if (refs.modelBadge) refs.modelBadge.textContent = state.model === 'slim' ? 'тонкие руки (slim)' : 'обычные руки (classic)';
  }

  function buildPalette(host, colorInput, colorPreview, colorCode) {
    host.innerHTML = '';
    for (const row of PALETTE) {
      for (const color of row) {
        const swatch = UI.el('button', { class: 'swatch', style: { background: color }, title: color });
        swatch.addEventListener('click', () => {
          editor.setColor(color);
          colorInput.value = color;
          colorPreview.style.background = color;
          colorCode.textContent = color;
          [...host.children].forEach((node) => node.classList.remove('active'));
          swatch.classList.add('active');
        });
        host.append(swatch);
      }
    }
  }

  async function loadAccountSkin() {
    if (!editor) return;
    const acc = account();
    let source = App.defaultSkin('classic');
    if (acc) {
      const skin = await App.accountSkin(acc);
      state.model = skin.model || 'classic';
      source = skin.dataUrl || App.defaultSkin(state.model);
    }
    try {
      const image = await window.SkinRender.loadImage(source);
      editor.loadImageElement(image, true);
    } catch {
      /* остаётся шаблон */
    }
    updateModelButtons();
    renderPreview();
    setDirty(false);
  }

  async function saveSkin() {
    const acc = account();
    if (!acc) {
      App.openAccount({ tab: 'local' });
      return;
    }
    if (acc.type === 'local') {
      try {
        const result = await UI.req(window.api.accounts.setSkin(editor.exportDataUrl(), state.model));
        App.state.accountSkinCache[acc.id] = { dataUrl: result.dataUrl, model: result.model };
        App.state.avatarCache = {};
        App.state.skinCache = {};
        await App.refreshAccount();
        setDirty(false);
        UI.toast('Скин сохранён — он виден в лаунчере', 'success');
        return;
      } catch (error) {
        UI.toast(error.message, 'error');
        return;
      }
    }
    if (acc.type === 'microsoft') {
      window.api.openExternal('https://www.minecraft.net/ru-ru/msaprofile/mygames/editskin');
      UI.toast('Загрузите скин в профиле Minecraft — он появится здесь и в игре', 'info', 8000);
      return;
    }
    window.api.skins.openSite();
    UI.toast('Загрузите скин на сайте Ely.by и нажмите «Обновить» — он появится здесь и в игре', 'info', 9000);
  }

  function buildEditorCard() {
    const canvas = UI.el('canvas', { id: 'skin-canvas' });
    const colorInput = UI.el('input', { type: 'color', value: window.accentColor ? window.accentColor() : '#8ce86a' });
    const colorPreview = UI.el('div', { class: 'color-preview', style: { background: window.accentColor ? window.accentColor() : '#8ce86a' } });
    const colorCode = UI.el('code', { text: window.accentColor ? window.accentColor() : '#8ce86a' });

    const palette = UI.el('div', { class: 'palette' });

    colorInput.addEventListener('input', () => {
      editor.setColor(colorInput.value);
      colorPreview.style.background = colorInput.value;
      colorCode.textContent = colorInput.value;
    });

    const tools = [
      { id: 'pencil', icon: 'edit', title: 'Карандаш' },
      { id: 'eraser', icon: 'eraser', title: 'Ластик' },
      { id: 'fill', icon: 'fill', title: 'Заливка' },
      { id: 'picker', icon: 'picker', title: 'Пипетка' },
    ];
    const toolGrid = UI.el('div', { class: 'tools' });
    for (const tool of tools) {
      const button = UI.el('button', { class: `tool${tool.id === 'pencil' ? ' active' : ''}`, title: tool.title }, UI.icon(tool.icon));
      button.addEventListener('click', () => {
        editor.setTool(tool.id);
        [...toolGrid.children].forEach((node) => node.classList.remove('active'));
        button.classList.add('active');
      });
      toolGrid.append(button);
    }

    const undoBtn = UI.el('button', { class: 'tool', title: 'Отменить' }, UI.icon('undo'));
    undoBtn.addEventListener('click', () => editor.undo());
    const redoBtn = UI.el('button', { class: 'tool', title: 'Повторить' }, UI.icon('redo'));
    redoBtn.addEventListener('click', () => editor.redo());
    const mirrorBtn = UI.el('button', { class: 'tool', title: 'Симметрия' }, UI.icon('mirror'));
    mirrorBtn.addEventListener('click', () => {
      editor.setMirror(!editor.mirror);
      mirrorBtn.classList.toggle('active', editor.mirror);
    });
    const gridBtn = UI.el('button', { class: 'tool active', title: 'Сетка' }, UI.icon('grid'));
    gridBtn.addEventListener('click', () => {
      editor.setGrid(!editor.grid);
      gridBtn.classList.toggle('active', editor.grid);
    });
    const outlineBtn = UI.el('button', { class: 'tool', title: 'Разметка частей тела' }, UI.icon('user'));
    outlineBtn.addEventListener('click', () => {
      editor.setOutlines(!editor.outlines);
      outlineBtn.classList.toggle('active', editor.outlines);
    });
    toolGrid.append(undoBtn, redoBtn, mirrorBtn, gridBtn, outlineBtn);

    const zoom = UI.el('input', { class: 'slider', type: 'range', min: '3', max: '12', step: '1', value: '6' });
    zoom.style.width = '110px';
    zoom.addEventListener('input', () => editor.setZoom(Number(zoom.value)));

    const resetBtn = UI.el('button', {
      class: 'btn sm ghost',
      title: 'Вернуть стандартный скин Стива',
      onclick: async () => {
        try {
          const image = await window.SkinRender.loadImage('assets/skin-steve.png');
          editor.loadImageElement(image);
          state.model = 'classic';
          updateModelButtons();
          renderPreview();
          setDirty(true);
        } catch {
          UI.toast('Не удалось загрузить шаблон', 'error');
        }
      },
    }, UI.icon('refresh'), 'Скин Стива');

    const clearBtn = UI.el('button', {
      class: 'btn sm ghost',
      onclick: () => {
        editor.clearAll();
        renderPreview();
        setDirty(true);
      },
    }, UI.icon('eraser'), 'Очистить');

    const fileInput = UI.el('input', { type: 'file', accept: 'image/png', class: 'hidden' });
    fileInput.addEventListener('change', async () => {
      try {
        await editor.importFile(fileInput.files[0]);
        renderPreview();
        setDirty(true);
        UI.toast('Скин загружен в редактор', 'success');
      } catch (error) {
        UI.toast(error.message, 'error');
      } finally {
        fileInput.value = '';
      }
    });

    const side = UI.el(
      'div',
      { class: 'editor-side' },
      UI.el('div', { class: 'field' }, UI.el('label', {}, 'Инструменты'), toolGrid),
      UI.el(
        'div',
        { class: 'row', style: { gap: '6px' } },
        UI.el('div', { class: 'grow' }, UI.el('span', { class: 'tiny muted', text: 'масштаб' })),
        UI.el('div', { class: 'zoom-row' }, '×', zoom),
      ),
      UI.el(
        'div',
        { class: 'color-current' },
        colorPreview,
        UI.el('div', { class: 'grow' }, UI.el('div', { class: 'tiny muted', text: 'текущий цвет' }), colorCode),
        colorInput,
      ),
      UI.el('div', { class: 'palette-label' }, 'Палитра'),
      palette,
      UI.el('div', { class: 'divider' }),
      UI.el(
        'div',
        { class: 'row', style: { gap: '6px', flexWrap: 'wrap' } },
        UI.el('button', { class: 'btn sm', onclick: () => fileInput.click() }, UI.icon('upload'), 'Импорт PNG'),
        resetBtn,
        clearBtn,
      ),
      fileInput,
      UI.el('p', { class: 'tiny', style: { color: 'var(--muted-2)', lineHeight: '1.45' } },
        'ПКМ по холсту — взять цвет. Симметрия повторяет пиксели зеркально.'),
    );

    buildPalette(palette, colorInput, colorPreview, colorCode);
    palette.firstChild && palette.firstChild.classList.add('active');

    const body = UI.el('div', { class: 'editor-body' }, UI.el('div', { class: 'canvas-wrap' }, canvas), side);
    return { body, canvas, colorInput, colorPreview, colorCode };
  }

  async function applySkinData(dataUrl) {
    if (!editor) return;
    try {
      const image = await window.SkinRender.loadImage(dataUrl);
      editor.loadImageElement(image, true);
      updateModelButtons();
      renderPreview();
      setDirty(true);
      UI.toast('Скин загружен в редактор — нажмите «Сохранить»', 'success', 6000);
    } catch (error) {
      UI.toast(error.message, 'error');
    }
  }

  function catalogCard() {
    const nick = UI.el('input', { class: 'input', placeholder: 'Ник игрока, например Notch' });
    const findBtn = UI.el('button', { class: 'btn primary' }, UI.icon('search'), 'Найти');
    const status = UI.el('div', { class: 'tiny muted', text: 'Скин подтягивается по нику игрока. Найденный скин можно сохранить в галерею и применить.' });
    const found = UI.el('div', { class: 'skin-gallery' });
    const saved = UI.el('div', { class: 'skin-gallery' });

    const tile = (dataUrl, title, buttons) =>
      UI.el(
        'div',
        { class: 'skin-tile' },
        UI.el('img', { src: dataUrl, alt: '' }),
        UI.el('div', { class: 'skin-tile-name', text: title }),
        UI.el('div', { class: 'skin-tile-actions' }, buttons),
      );

    const paintGallery = async () => {
      UI.clear(saved);
      let items = [];
      try {
        items = await UI.req(window.api.skins.gallery());
      } catch (error) {
        saved.append(UI.el('div', { class: 'tiny muted', text: `Галерея недоступна: ${error.message}` }));
        return;
      }
      if (!items.length) {
        saved.append(UI.el('div', { class: 'tiny muted', text: 'Галерея пуста.' }));
        return;
      }
      for (const item of items) {
        saved.append(
          tile(
            item.dataUrl,
            item.name,
            [
              UI.el('button', { class: 'btn sm', onclick: () => applySkinData(item.dataUrl) }, 'Применить'),
              UI.el('button', {
                class: 'btn sm ghost icon-only',
                title: 'Удалить',
                onclick: async () => {
                  try {
                    await UI.req(window.api.skins.galleryRemove(item.name));
                    paintGallery();
                    UI.toast('Удалено из галереи', 'info');
                  } catch (error) {
                    UI.toast(error.message, 'error');
                  }
                },
              }, UI.icon('trash')),
            ],
          ),
        );
      }
    };

    const search = async () => {
      const query = nick.value.trim();
      if (!query) {
        UI.toast('Введите ник игрока', 'info');
        return;
      }
      findBtn.disabled = true;
      status.textContent = `Ищу скин игрока ${query}…`;
      try {
        const result = await UI.req(window.api.skins.fetchByNick(query));
        UI.clear(found);
        found.append(
          tile(result.dataUrl, result.nick, [
            UI.el('button', { class: 'btn sm primary', onclick: () => applySkinData(result.dataUrl) }, 'Применить'),
            UI.el('button', {
              class: 'btn sm',
              onclick: async () => {
                try {
                  await UI.req(window.api.skins.gallerySave(result.dataUrl, result.nick));
                  await paintGallery();
                  UI.toast('Скин сохранён в галерею', 'success');
                } catch (error) {
                  UI.toast(error.message, 'error');
                }
              },
            }, 'В галерею'),
          ]),
        );
        status.textContent = `Найден скин ${result.nick}.`;
      } catch (error) {
        status.textContent = error.message;
      } finally {
        findBtn.disabled = false;
      }
    };

    findBtn.addEventListener('click', search);
    nick.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') search();
    });

    paintGallery();

    return UI.el(
      'div',
      { class: 'card pad', style: { marginTop: '16px' } },
      UI.el('div', { class: 'card-head' },
        UI.el('div', { class: 'card-title' }, UI.icon('grid'), 'Каталог скинов'),
        UI.el('span', { class: 'badge', text: 'по нику' }),
      ),
      UI.el('div', { class: 'vanilla-row' }, nick, findBtn),
      status,
      found,
      UI.el('div', { class: 'skin-sub', text: 'Моя галерея' }),
      saved,
    );
  }

  function catalogGrid() {
    const grid = UI.el('div', { class: 'skin-gallery' });
    const status = UI.el('div', { class: 'tiny muted', text: 'Загружаю каталог скинов…' });
    const moreBtn = UI.el('button', { class: 'btn sm', disabled: true }, 'Показать ещё');
    const refreshBtn = UI.el('button', { class: 'btn sm ghost icon-only', title: 'Обновить каталог', onclick: () => { page = 0; load(false); } }, UI.icon('refresh'));
    const galleryHost = UI.el('div', { class: 'skin-gallery' });
    let page = 0;
    let loading = false;

    const tile = (dataUrl, title, buttons) =>
      UI.el(
        'div',
        { class: 'skin-tile' },
        UI.el('img', { src: dataUrl, alt: '' }),
        title ? UI.el('div', { class: 'skin-tile-name', text: title }) : null,
        UI.el('div', { class: 'skin-tile-actions' }, buttons),
      );

    const paintGallery = async () => {
      UI.clear(galleryHost);
      let items = [];
      try {
        items = await UI.req(window.api.skins.gallery());
      } catch (error) {
        galleryHost.append(UI.el('div', { class: 'tiny muted', text: `Галерея недоступна: ${error.message}` }));
        return;
      }
      if (!items.length) {
        galleryHost.append(UI.el('div', { class: 'tiny muted', text: 'Галерея пуста.' }));
        return;
      }
      for (const item of items) {
        galleryHost.append(
          tile(item.dataUrl, item.name, [
            UI.el('button', { class: 'btn sm', onclick: () => applySkinData(item.dataUrl) }, 'Применить'),
            UI.el('button', {
              class: 'btn sm ghost icon-only',
              title: 'Удалить',
              onclick: async () => {
                try {
                  await UI.req(window.api.skins.galleryRemove(item.name));
                  paintGallery();
                } catch (error) {
                  UI.toast(error.message, 'error');
                }
              },
            }, UI.icon('trash')),
          ]),
        );
      }
    };

    const load = async (next) => {
      if (loading) return;
      loading = true;
      moreBtn.disabled = true;
      status.textContent = next ? `Загружаю страницу ${page + 1}…` : 'Загружаю каталог скинов…';
      try {
        const result = await UI.req(window.api.skins.catalog({ page: next ? page + 1 : 1, size: 30 }));
        if (!next) UI.clear(grid);
        page = result.page || (next ? page + 1 : 1);
        for (const item of result.items) {
          grid.append(
            tile(item.dataUrl, '', [
              UI.el('button', { class: 'btn sm primary', onclick: () => applySkinData(item.dataUrl) }, 'Применить'),
              UI.el('button', {
                class: 'btn sm',
                onclick: async () => {
                  try {
                    await UI.req(window.api.skins.gallerySave(item.dataUrl, `skin-${item.id}`));
                    await paintGallery();
                    UI.toast('Скин сохранён в галерею', 'success');
                  } catch (error) {
                    UI.toast(error.message, 'error');
                  }
                },
              }, 'В галерею'),
            ]),
          );
        }
        status.textContent = result.items.length
          ? `В каталоге ${UI.num(result.total || 0)} скинов, показано ${grid.children.length}.`
          : 'Каталог пуст — нажмите «Обновить».';
      } catch (error) {
        status.textContent = `Каталог недоступен: ${error.message}`;
      } finally {
        loading = false;
        moreBtn.disabled = false;
      }
    };

    moreBtn.addEventListener('click', () => load(true));
    paintGallery();
    load(false);

    return UI.el(
      'div',
      { class: 'card pad', style: { marginTop: '16px' } },
      UI.el('div', { class: 'card-head' },
        UI.el('div', { class: 'card-title' }, UI.icon('grid'), 'Каталог скинов'),
        UI.el('div', { class: 'row', style: { gap: '8px' } }, refreshBtn, moreBtn),
      ),
      status,
      grid,
      UI.el('div', { class: 'skin-sub', text: 'Моя галерея' }),
      galleryHost,
    );
  }

  return {
    title: 'Скины',
    kicker: 'Персонаж и скин',
    render(container) {
      const acc = account();
      state = { model: acc?.skinModel || 'classic', view: 'front' };

      const preview = UI.el('canvas');
      refs = { preview };

      const nickLabel = UI.el('div', { class: 'skin-nick', text: acc ? acc.username : 'Стив' });
      const modelBadge = UI.el('div', { class: 'skin-sub', text: 'обычные руки (classic)' });
      const dirtyBadge = UI.el('span', { class: 'badge', text: 'сохранён' });
      refs.dirtyBadge = dirtyBadge;
      refs.modelBadge = modelBadge;

      const modelButtons = UI.el('div', { class: 'tabs' });
      for (const [id, label] of [['classic', 'Classic'], ['slim', 'Slim']]) {
        const button = UI.el('button', { class: `tab${state.model === id ? ' active' : ''}`, dataset: { model: id }, text: label });
        button.addEventListener('click', () => {
          state.model = id;
          updateModelButtons();
          renderPreview();
          setDirty(true);
        });
        modelButtons.append(button);
      }
      refs.modelButtons = modelButtons;

      const viewToggle = UI.el('div', { class: 'tabs' });
      for (const [id, label] of [['front', 'Спереди'], ['back', 'Сзади']]) {
        const button = UI.el('button', { class: `tab${state.view === id ? ' active' : ''}`, text: label });
        button.addEventListener('click', () => {
          state.view = id;
          [...viewToggle.children].forEach((node) => node.classList.remove('active'));
          button.classList.add('active');
          renderPreview();
        });
        viewToggle.append(button);
      }

      const nickInput = UI.el('input', { class: 'input', placeholder: 'Ник игрока, например Notch' });

      const showSkin = async (rawNick) => {
        const nick = String(rawNick || '').trim();
        if (!nick) return;
        try {
          const profile = await UI.req(window.api.skins.profile(nick));
          const data = await UI.req(window.api.skins.data(nick));
          const source = data.skin || App.defaultSkin(profile.model);
          const image = await window.SkinRender.loadImage(source);
          window.SkinRender.drawCharacter(preview, image, { model: profile.model, view: state.view, scale: 9 });
          nickLabel.textContent = profile.name || nick;
          modelBadge.textContent = profile.model === 'slim' ? 'тонкие руки (slim)' : 'обычные руки (classic)';
          state.model = profile.model;
          updateModelButtons();
          UI.toast(profile.skin ? 'Скин найден' : 'У игрока стандартный скин', 'info');
        } catch (error) {
          UI.toast(error.message, 'error');
        }
      };

      const friendsStrip = UI.el('div', { class: 'skin-friends' });
      let friendsTimer = null;

      const loadFriendSkins = async () => {
        friendsStrip.innerHTML = '';
        try {
          const data = await UI.req(window.api.friends.state());
          const list = (data.friends || []).filter((friend) => friend.name).slice(0, 10);
          if (!list.length) {
            friendsStrip.append(UI.el('div', { class: 'skin-sub', text: 'Настройте друзей на вкладке «Друзья» — их скины появятся здесь.' }));
            return;
          }
          for (const friend of list) {
            friendsStrip.append(UI.el('button', {
              class: 'btn sm ghost',
              text: friend.name,
              onclick: () => {
                nickInput.value = friend.name;
                showSkin(friend.name);
              },
            }));
          }
        } catch (error) {
          friendsStrip.append(UI.el('div', { class: 'skin-sub', text: 'Список друзей недоступен' }));
        }
      };

      friendsTimer = setInterval(() => {
        if (!friendsStrip.isConnected) {
          clearInterval(friendsTimer);
          return;
        }
        loadFriendSkins();
      }, 60000);
      loadFriendSkins();

      const primaryLabel = !acc
        ? 'Создать аккаунт'
        : acc.type === 'local'
          ? 'Сохранить скин'
          : acc.type === 'microsoft'
            ? 'Загрузить на minecraft.net'
            : 'Открыть сайт скинов Ely.by';

      const primaryBtn = UI.el('button', {
        class: 'btn sm primary block',
        onclick: () => saveSkin(),
      }, UI.icon(acc && acc.type === 'local' ? 'save' : 'upload'), primaryLabel);

      const refreshBtn = UI.el('button', {
        class: 'btn sm block',
        onclick: async () => {
          App.state.accountSkinCache = {};
          App.state.skinCache = {};
          await loadAccountSkin();
          UI.toast('Скин обновлён', 'success');
        },
      }, UI.icon('refresh'), 'Обновить скин');

      const downloadBtn = UI.el('button', {
        class: 'btn sm ghost',
        onclick: async () => {
          try {
            const file = await UI.req(window.api.skins.save(editor.exportDataUrl(), `${acc?.username || 'skin'}.png`));
            if (file) UI.toast('PNG сохранён', 'success');
          } catch (error) {
            UI.toast(error.message, 'error');
          }
        },
      }, UI.icon('download'), 'Скачать PNG');

      const left = UI.el(
        'div',
        { class: 'card skin-card' },
        UI.el('div', { class: 'skin-stage' }, preview),
        nickLabel,
        modelBadge,
        dirtyBadge,
        viewToggle,
        modelButtons,
        UI.el('div', { class: 'skin-actions' }, primaryBtn, refreshBtn, downloadBtn),
        UI.el('div', { class: 'divider' }),
        UI.el('div', { class: 'field', style: { width: '100%' } }, UI.el('label', {}, 'Посмотреть скин другого игрока'), nickInput),
        UI.el('button', {
          class: 'btn sm block',
          onclick: () => showSkin(nickInput.value.trim()),
        }, UI.icon('search'), 'Показать'),
        UI.el('div', { class: 'skin-sub', text: 'Скины друзей' }),
        friendsStrip,
      );

      const { body, canvas } = buildEditorCard();
      const editorCard = UI.el(
        'div',
        { class: 'card' },
        UI.el(
          'div',
          { class: 'card-head', style: { padding: '16px 16px 0' } },
          UI.el('div', { class: 'card-title' }, UI.icon('edit'), 'Редактор скина 64×64'),
          UI.el('div', { class: 'row', style: { gap: '8px' } }, UI.el('span', { class: 'badge', text: 'PNG' }), dirtyBadge),
        ),
        UI.el('div', { class: 'editor' }, body),
      );

      container.append(UI.el('div', { class: 'skins-layout' }, left, editorCard));
      container.append(catalogGrid());

      editor = new window.SkinEditor({
        canvas,
        onChange: () => {
          renderPreview();
          setDirty(true);
        },
      });
      editor.onPick = (color) => {
        const input = editorCard.querySelector('input[type="color"]');
        if (input) input.value = color;
        const box = editorCard.querySelector('.color-preview');
        if (box) box.style.background = color;
        const code = editorCard.querySelector('.color-current code');
        if (code) code.textContent = color;
      };

      renderPreview();
      loadAccountSkin();

      container.append(
        UI.el(
          'div',
          { class: 'card pad', style: { marginTop: '16px' } },
          UI.el(
            'div',
            { class: 'row', style: { gap: '12px', alignItems: 'flex-start' } },
            UI.el('div', { class: 'stat-icon blue' }, UI.icon('info')),
            UI.el(
              'div',
              {},
              UI.el('div', { style: { fontWeight: '600', marginBottom: '4px' } }, 'Как скин попадает в игру'),
              UI.el('p', { class: 'small muted' },
                acc && acc.type === 'local'
                  ? 'Офлайн-аккаунт: скин сохраняется в лаунчере и показывается в профиле. В одиночной игре без мода на скины персонаж останется стандартным.'
                  : 'Ely.by и Microsoft: загрузите скин на сайте аккаунта, нажмите «Обновить» — лаунчер подхватит его, а в игре он применится автоматически (для Ely.by через authlib-injector).'),
            ),
          ),
        ),
      );
    },
    destroy() {
      editor = null;
      refs = {};
      state = {};
    },
  };
})();
