'use strict';

window.Views = window.Views || {};

window.Views.skins = (() => {
  const PALETTE = [
    ['#ffffff', '#d9d9d9', '#a6a6a6', '#6e6e6e', '#3d3d3d', '#141414'],
    ['#f6d7b0', '#e3b98f', '#c99a6c', '#a97a4f', '#855c37', '#5e3f25'],
    ['#ffd166', '#e4572e', '#b3261e', '#8ce86a', '#2a9d8f', '#10423d'],
    ['#a5d8ff', '#2f6fed', '#14286b', '#e5c6ff', '#7b3fe4', '#2a175d'],
  ];

  let editor = null;
  let refs = {};
  let state = {};

  function account() {
    return App.state.currentAccount;
  }

  function renderPreview() {
    if (!editor) return;
    if (refs.viewer) {
      refs.viewer.setTexture(editor.tex);
      refs.viewer.setModel(state.model);
    }
    if (refs.preview2d) {
      window.SkinRender.drawCharacter(refs.preview2d, editor.tex, { model: state.model, view: 'front', scale: 5 });
    }
    if (refs.preview2dBack) {
      window.SkinRender.drawCharacter(refs.preview2dBack, editor.tex, { model: state.model, view: 'back', scale: 5 });
    }
  }

  async function downloadSkin() {
    const acc = account();
    try {
      const file = await UI.req(window.api.skins.save(editor.exportDataUrl(), `${acc?.username || 'skin'}.png`));
      if (file) UI.toast('PNG сохранён', 'success');
    } catch (error) {
      UI.toast(error.message, 'error');
    }
  }

  function detailsDialog() {
    if (!editor) return;
    const acc = account();
    const big = UI.el('canvas', { class: 'skin-3d skin-3d-lg' });
    const front = UI.el('canvas', { class: 'skin-2d' });
    const back = UI.el('canvas', { class: 'skin-2d' });
    window.SkinRender.drawCharacter(front, editor.tex, { model: state.model, view: 'front', scale: 5 });
    window.SkinRender.drawCharacter(back, editor.tex, { model: state.model, view: 'back', scale: 5 });

    let bytes = 0;
    try {
      bytes = Math.round(((editor.exportDataUrl().length - 22) * 3) / 4);
    } catch {
      bytes = 0;
    }
    const kb = bytes ? `${Math.max(1, Math.round(bytes / 1024))} КБ` : '—';

    const facts = [
      ['Игрок', acc ? acc.username : 'Гость'],
      ['Модель', state.model === 'slim' ? 'Slim, тонкие руки' : 'Classic, обычные руки'],
      ['Разрешение', '64 × 64 px'],
      ['Формат', 'PNG, 32 бита'],
      ['Вес', kb],
    ];

    const viewer = window.Skin3D.create(big, {
      texture: editor.tex,
      model: state.model,
      autoRotate: true,
    });

    const info = UI.el(
      'div',
      { class: 'skin-facts' },
      ...facts.map(([key, value]) =>
        UI.el('div', { class: 'skin-fact' }, UI.el('span', { class: 'skin-fact-key', text: key }), UI.el('span', { text: value })),
      ),
    );

    const body = UI.el(
      'div',
      { class: 'skin-details' },
      UI.el(
        'div',
        { class: 'skin-details-stage' },
        big,
        UI.el('div', { class: 'stage-hint', text: 'потяните, чтобы покрутить · колесо — масштаб · двойной клик — сброс' }),
      ),
      UI.el(
        'div',
        { class: 'skin-details-side' },
        UI.el('div', { class: 'palette-label' }, 'Спереди и сзади'),
        UI.el('div', { class: 'editor-preview-figures' }, front, back),
        info,
        UI.el('div', { class: 'divider' }),
        UI.el('button', { class: 'btn sm block', onclick: () => downloadSkin() }, UI.icon('download'), 'Скачать PNG'),
        UI.el('button', {
          class: 'btn sm block ghost',
          onclick: async () => {
            try {
              await UI.req(window.api.skins.gallerySave(editor.exportDataUrl(), `${acc?.username || 'skin'}-${Date.now()}`));
              UI.toast('Скин сохранён в галерею', 'success');
            } catch (error) {
              UI.toast(error.message, 'error');
            }
          },
        }, UI.icon('save'), 'В галерею'),
      ),
    );

    requestAnimationFrame(() => viewer.render());
    UI.modal({
      title: 'Скин подробнее',
      subtitle: 'Модель и текстура — можно крутить мышью',
      wide: true,
      body,
      actions: [{ label: 'Закрыть', kind: 'ghost' }],
      onClose: () => viewer.destroy(),
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
          colorCode.value = color;
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

  function buildEditorCard(previewBlock) {
    const canvas = UI.el('canvas', { id: 'skin-canvas' });
    const colorInput = UI.el('input', { type: 'color', value: window.accentColor ? window.accentColor() : '#8ce86a' });
    const colorPreview = UI.el('div', { class: 'color-preview', style: { background: window.accentColor ? window.accentColor() : '#8ce86a' } });
    const colorCode = UI.el('input', {
      class: 'input sm hex',
      value: window.accentColor ? window.accentColor() : '#8ce86a',
      maxlength: '7',
      spellcheck: 'false',
      title: 'Свой цвет: HEX',
    });

    const palette = UI.el('div', { class: 'palette' });

    colorInput.addEventListener('input', () => {
      editor.setColor(colorInput.value);
      colorPreview.style.background = colorInput.value;
      colorCode.value = colorInput.value;
    });

    colorCode.addEventListener('change', () => {
      const raw = String(colorCode.value || '').trim().replace(/^#/, '');
      if (!/^[0-9a-fA-F]{6}$/.test(raw)) {
        colorCode.value = colorInput.value;
        return;
      }
      const value = `#${raw.toLowerCase()}`;
      colorInput.value = value;
      colorCode.value = value;
      colorPreview.style.background = value;
      editor.setColor(value);
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
      previewBlock || null,
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
        UI.el('div', { class: 'grow' }, UI.el('div', { class: 'tiny muted', text: 'свой цвет (HEX)' }), colorCode),
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

  function skinFigure(dataUrl) {
    const canvas = UI.el('canvas', { class: 'skin-figure' });
    window.SkinRender.loadImage(dataUrl)
      .then((image) => {
        const texture = window.SkinRender.textureOf(image);
        let slim = true;
        try {
          const alpha = texture.getContext('2d').getImageData(47, 20, 1, 12).data;
          for (let i = 3; i < alpha.length; i += 4) {
            if (alpha[i] > 8) {
              slim = false;
              break;
            }
          }
        } catch {
          slim = false;
        }
        window.SkinRender.drawCharacter(canvas, texture, {
          model: slim ? 'slim' : 'classic',
          view: 'front',
          scale: 7,
        });
      })
      .catch(() => {});
    return canvas;
  }

  function skinTile(dataUrl, title, buttons) {
    return UI.el(
      'div',
      { class: 'skin-tile' },
      skinFigure(dataUrl),
      title ? UI.el('div', { class: 'skin-tile-name', text: title }) : null,
      UI.el('div', { class: 'skin-tile-actions' }, buttons),
    );
  }

  function catalogGrid() {
    const grid = UI.el('div', { class: 'skin-gallery' });
    const status = UI.el('div', { class: 'tiny muted', text: 'Загружаю каталог скинов…' });
    const sentinel = UI.el('div', { class: 'skin-sentinel' });
    const refreshBtn = UI.el('button', {
      class: 'btn sm ghost icon-only',
      title: 'Обновить каталог',
      onclick: () => {
        page = 0;
        done = false;
        UI.clear(grid);
        load(false);
      },
    }, UI.icon('refresh'));
    let page = 0;
    let loading = false;
    let done = false;
    let total = 0;

    const load = async (next) => {
      if (loading || (next && done)) return;
      loading = true;
      status.textContent = next ? 'Подгружаю ещё скины…' : 'Загружаю каталог скинов…';
      try {
        const result = await UI.req(window.api.skins.catalog({ page: next ? page + 1 : 1, size: 24 }));
        if (!next) UI.clear(grid);
        page = result.page || (next ? page + 1 : 1);
        total = result.total || total;
        for (const item of result.items) {
          grid.append(
            skinTile(item.dataUrl, '', [
              UI.el('button', { class: 'btn sm primary', onclick: () => applySkinData(item.dataUrl) }, 'Применить'),
              UI.el('button', {
                class: 'btn sm icon-only',
                title: 'В галерею',
                onclick: async () => {
                  try {
                    await UI.req(window.api.skins.gallerySave(item.dataUrl, `skin-${item.id}`));
                    UI.toast('Скин сохранён в галерею', 'success');
                  } catch (error) {
                    UI.toast(error.message, 'error');
                  }
                },
              }, UI.icon('save')),
            ]),
          );
        }
        done = !result.items.length || result.hasMore === false;
        status.textContent = done
          ? `Показано ${grid.children.length} скинов — это весь каталог.`
          : `Показано ${grid.children.length} скинов — прокрутите, чтобы подгрузить ещё.`;
      } catch (error) {
        done = false;
        status.textContent = `Каталог недоступен: ${error.message} — прокрутите, чтобы попробовать снова`;
      } finally {
        loading = false;
        requestAnimationFrame(() => followUp());
      }
    };

    function followUp() {
      if (done || loading) return;
      const rect = sentinel.getBoundingClientRect();
      const page = document.getElementById('page');
      const bottom = page ? page.getBoundingClientRect().bottom : window.innerHeight;
      if (rect.top < bottom + 200) load(true);
    }

    if (typeof IntersectionObserver === 'function') {
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer.disconnect();
            observer.observe(sentinel);
            load(true);
          }
        },
        { root: document.getElementById('page'), rootMargin: '500px 0px' },
      );
      observer.observe(sentinel);
      refs.catalogObserver = observer;
    }
    load(false);

    return UI.el(
      'div',
      { class: 'card pad skin-tab-card' },
      UI.el('div', { class: 'card-head' },
        UI.el('div', { class: 'card-title' }, UI.icon('grid'), 'Каталог скинов'),
        UI.el('div', { class: 'row', style: { gap: '8px' } }, UI.el('span', { class: 'badge', text: 'прокрутка = ещё' }), refreshBtn),
      ),
      status,
      grid,
      sentinel,
    );
  }

  function galleryCard() {
    const grid = UI.el('div', { class: 'skin-gallery' });
    const status = UI.el('div', { class: 'tiny muted', text: 'Загружаю галерею…' });

    const paint = async () => {
      UI.clear(grid);
      let items = [];
      try {
        items = await UI.req(window.api.skins.gallery());
      } catch (error) {
        status.textContent = `Галерея недоступна: ${error.message}`;
        return;
      }
      status.textContent = items.length ? `Сохранено скинов: ${items.length}` : 'Галерея пуста. Сохраняйте скины кнопкой «В галерею».';
      for (const item of items) {
        grid.append(
          skinTile(item.dataUrl, item.name, [
            UI.el('button', { class: 'btn sm primary', onclick: () => applySkinData(item.dataUrl) }, 'В редактор'),
            UI.el('button', {
              class: 'btn sm ghost icon-only',
              title: 'Удалить',
              onclick: async () => {
                try {
                  await UI.req(window.api.skins.galleryRemove(item.name));
                  await paint();
                  UI.toast('Удалено из галереи', 'info');
                } catch (error) {
                  UI.toast(error.message, 'error');
                }
              },
            }, UI.icon('trash')),
          ]),
        );
      }
    };

    const refreshBtn = UI.el('button', { class: 'btn sm ghost icon-only', title: 'Обновить галерею', onclick: () => paint() }, UI.icon('refresh'));
    paint();

    return UI.el(
      'div',
      { class: 'card pad skin-tab-card' },
      UI.el('div', { class: 'card-head' },
        UI.el('div', { class: 'card-title' }, UI.icon('layers'), 'Моя галерея'),
        UI.el('div', { class: 'row', style: { gap: '8px' } }, refreshBtn),
      ),
      status,
      grid,
    );
  }

  return {
    title: 'Скины',
    kicker: 'Персонаж и скин',
    render(container) {
      const acc = account();
      state = { model: acc?.skinModel || 'classic', view: '3d' };

      const preview = UI.el('canvas', { class: 'skin-3d' });
      const preview2d = UI.el('canvas', { class: 'skin-2d' });
      const preview2dBack = UI.el('canvas', { class: 'skin-2d' });
      refs = { preview, preview2d, preview2dBack };

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
      const viewButtons = {};
      for (const [id, label] of [['3d', '3D'], ['front', 'Спереди'], ['back', 'Сзади']]) {
        const button = UI.el('button', { class: `tab${state.view === id ? ' active' : ''}`, text: label });
        button.addEventListener('click', () => {
          setView(id);
        });
        viewButtons[id] = button;
        viewToggle.append(button);
      }

      function setView(id) {
        state.view = id;
        for (const [key, button] of Object.entries(viewButtons)) button.classList.toggle('active', key === id);
        if (!refs.viewer) return;
        if (id === '3d') {
          refs.viewer.setAngles(-0.55, 0.12);
          refs.viewer.setAutoRotate(true);
          return;
        }
        refs.viewer.setAutoRotate(false);
        refs.viewer.setAngles(id === 'back' ? Math.PI : 0, 0);
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
          refs.viewer?.setTexture(image);
          window.SkinRender.drawCharacter(preview2d, image, { model: profile.model, view: 'front', scale: 5 });
          window.SkinRender.drawCharacter(preview2dBack, image, { model: profile.model, view: 'back', scale: 5 });
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
        onclick: () => downloadSkin(),
      }, UI.icon('download'), 'Скачать PNG');

      const detailsBtn = UI.el('button', {
        class: 'btn sm block',
        onclick: () => detailsDialog(),
      }, UI.icon('info'), 'Подробнее');

      const stage = UI.el(
        'div',
        { class: 'skin-stage skin-stage-3d' },
        preview,
        UI.el('div', { class: 'stage-hint', text: 'потяните, чтобы покрутить · колесо — масштаб' }),
      );

      const left = UI.el(
        'div',
        { class: 'card skin-card' },
        stage,
        nickLabel,
        modelBadge,
        dirtyBadge,
        viewToggle,
        modelButtons,
        UI.el('div', { class: 'skin-actions' }, primaryBtn, refreshBtn, downloadBtn),
        detailsBtn,
        UI.el('div', { class: 'divider' }),
        UI.el('div', { class: 'field', style: { width: '100%' } }, UI.el('label', {}, 'Посмотреть скин другого игрока'), nickInput),
        UI.el('button', {
          class: 'btn sm block',
          onclick: () => showSkin(nickInput.value.trim()),
        }, UI.icon('search'), 'Показать'),
        UI.el('div', { class: 'skin-sub', text: 'Скины друзей' }),
        friendsStrip,
      );

      const previewBlock = UI.el(
        'div',
        { class: 'editor-preview' },
        UI.el('div', { class: 'palette-label' }, 'Вид 2D'),
        UI.el('div', { class: 'editor-preview-figures' }, preview2d, preview2dBack),
        UI.el('div', { class: 'tiny muted', text: 'Спереди · сзади' }),
      );

      const { body, canvas } = buildEditorCard(previewBlock);
      const editorCard = UI.el(
        'div',
        { class: 'card editor-card' },
        UI.el(
          'div',
          { class: 'card-head', style: { padding: '16px 16px 0' } },
          UI.el('div', { class: 'card-title' }, UI.icon('edit'), 'Редактор скина 64×64'),
          UI.el('div', { class: 'row', style: { gap: '8px' } },
            UI.el('span', { class: 'badge', text: 'PNG' }),
            dirtyBadge,
            UI.el('button', { class: 'btn sm ghost', onclick: () => detailsDialog() }, UI.icon('info'), 'Подробнее'),
          ),
        ),
        UI.el('div', { class: 'editor' }, body),
      );

      const tabsBar = UI.el('div', { class: 'tabs skin-tabs' });
      const tabHost = UI.el('div', { class: 'skin-tab-host' });
      const catalogNode = catalogGrid();
      const galleryNode = galleryCard();
      const tabNodes = { catalog: catalogNode, gallery: galleryNode };
      let activeTab = 'catalog';

      const setTab = (id) => {
        activeTab = id;
        for (const node of tabsBar.children) node.classList.toggle('active', node.dataset.tab === id);
        UI.clear(tabHost);
        tabHost.append(tabNodes[id]);
      };
      for (const [id, label] of [['catalog', 'Каталог'], ['gallery', 'Галерея']]) {
        const button = UI.el('button', { class: `tab${id === 'catalog' ? ' active' : ''}`, dataset: { tab: id }, text: label });
        button.addEventListener('click', () => setTab(id));
        tabsBar.append(button);
      }

      const rightColumn = UI.el('div', { class: 'skins-main' }, editorCard, tabsBar, tabHost);
      container.append(UI.el('div', { class: 'skins-layout' }, left, rightColumn));
      setTab(activeTab);

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
        const code = editorCard.querySelector('.color-current .hex');
        if (code) code.value = color;
      };

      refs.viewer = window.Skin3D.create(preview, {
        texture: editor.tex,
        model: state.model,
        autoRotate: true,
      });

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
      if (refs.catalogObserver) refs.catalogObserver.disconnect();
      if (refs.viewer) refs.viewer.destroy();
      editor = null;
      refs = {};
      state = {};
    },
  };
})();
