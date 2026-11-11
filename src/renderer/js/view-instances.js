'use strict';

window.Views = window.Views || {};

window.Views.instances = (() => {
  const LOADERS = [
    { id: 'vanilla', name: 'Vanilla', icon: 'cube' },
    { id: 'fabric', name: 'Fabric', icon: 'layers' },
    { id: 'quilt', name: 'Quilt', icon: 'layers' },
    { id: 'forge', name: 'Forge', icon: 'settings' },
    { id: 'neoforge', name: 'NeoForge', icon: 'settings' },
  ];

  async function loadManifest() {
    if (App.state.manifest) return App.state.manifest;
    App.state.manifest = await UI.req(window.api.versions.manifest());
    return App.state.manifest;
  }

  async function createDialog(prefill = {}) {
    const manifest = await loadManifest().catch((error) => {
      UI.toast(error.message, 'error');
      return null;
    });
    if (!manifest) return;

    const versions = manifest.versions;
    const data = {
      name: prefill.name || '',
      mcVersion: prefill.mcVersion || manifest.latest.release,
      loader: prefill.loader || 'vanilla',
      loaderVersion: '',
      loaderVersions: [],
      cover: prefill.cover || 'autumn',
      memory: App.state.settings.memoryMB || 4096,
      install: true,
    };

    const body = UI.el('div', { class: 'stack', style: { gap: '16px' } });

    const nameInput = UI.el('input', {
      class: 'input',
      placeholder: 'Например: Выживание 1.21',
      value: data.name,
      oninput: (event) => {
        data.name = event.target.value;
      },
    });

    const selected = UI.el('div', { class: 'row', style: { gap: '8px' } });
    const searchInput = UI.el('input', { class: 'input', placeholder: 'Поиск версии, например 1.20' });
    const list = UI.el('div', { class: 'version-picker' });
    const loaderRow = UI.el('div', { class: 'chips' });
    const loaderSelect = UI.el('select', { class: 'select' });
    const loaderWrap = UI.el('div', { class: 'field hidden' }, UI.el('label', {}, 'Версия загрузчика'), loaderSelect);
    const coverRow = UI.el('div', { class: 'chips' });
    const memValue = UI.el('span', { class: 'badge accent', text: `${data.memory} МБ` });
    const memSlider = UI.el('input', {
      class: 'slider',
      type: 'range',
      min: '1024',
      max: String(Math.max(8192, Math.round((App.state.info.totalMemory || 8e9) / 1048576))),
      step: '512',
      value: String(data.memory),
    });
    memSlider.style.setProperty('--fill', '35%');
    memSlider.addEventListener('input', () => {
      data.memory = Number(memSlider.value);
      memValue.textContent = `${data.memory} МБ`;
      memSlider.style.setProperty('--fill', `${((data.memory - 1024) / (Number(memSlider.max) - 1024)) * 100}%`);
    });

    const installSwitch = UI.el('div', { class: 'switch on' });
    installSwitch.addEventListener('click', () => {
      data.install = !data.install;
      installSwitch.classList.toggle('on', data.install);
    });

    function renderSelected() {
      UI.clear(selected);
      selected.append(UI.el('span', { class: 'badge accent', text: `Minecraft ${data.mcVersion}` }));
    }

    function renderVersions() {
      const query = searchInput.value.trim().toLowerCase();
      const filtered = versions
        .filter((v) => !query || v.id.toLowerCase().includes(query) || v.type.includes(query))
        .slice(0, 120);
      UI.clear(list);
      for (const version of filtered) {
        const row = UI.el(
          'div',
          { class: `vp-row${version.id === data.mcVersion ? ' active' : ''}` },
          UI.el('span', { class: 'vname', text: version.id }),
          UI.el('span', { class: `badge ${version.type === 'release' ? 'accent' : version.type === 'snapshot' ? 'blue' : ''}`, text: typeLabel(version.type) }),
          UI.el('span', { class: 'vdate', style: { marginLeft: 'auto' }, text: UI.date(version.releaseTime) }),
        );
        row.addEventListener('click', () => {
          data.mcVersion = version.id;
          data.loaderVersion = '';
          renderVersions();
          renderSelected();
          loadLoaderVersions();
        });
        list.append(row);
      }
      if (!filtered.length) list.append(UI.el('div', { class: 'vp-row muted', text: 'Ничего не найдено' }));
    }

    function typeLabel(type) {
      if (type === 'release') return 'релиз';
      if (type === 'snapshot') return 'снапшот';
      if (type === 'old_beta') return 'бета';
      if (type === 'old_alpha') return 'альфа';
      return type;
    }

    function renderLoaders() {
      UI.clear(loaderRow);
      for (const loader of LOADERS) {
        const chip = UI.el(
          'button',
          { class: `chip${data.loader === loader.id ? ' active' : ''}` },
          UI.icon(loader.icon),
          loader.name,
        );
        chip.addEventListener('click', () => {
          data.loader = loader.id;
          data.loaderVersion = '';
          renderLoaders();
          loadLoaderVersions();
        });
        loaderRow.append(chip);
      }
    }

    async function loadLoaderVersions() {
      if (data.loader === 'vanilla') {
        loaderWrap.classList.add('hidden');
        return;
      }
      loaderWrap.classList.remove('hidden');
      UI.clear(loaderSelect);
      loaderSelect.append(UI.el('option', { value: '', text: 'Последняя стабильная' }));
      try {
        const listVersions = await UI.req(window.api.versions.loaders(data.loader, data.mcVersion));
        data.loaderVersions = listVersions || [];
        for (const item of data.loaderVersions.slice(0, 40)) {
          loaderSelect.append(
            UI.el('option', { value: item.version, text: `${item.version}${item.channel ? ` (${item.channel})` : ''}` }),
          );
        }
        if (!data.loaderVersions.length) {
          loaderSelect.append(UI.el('option', { value: '', text: 'Нет версий для этой сборки' }));
        }
      } catch {
        loaderSelect.append(UI.el('option', { value: '', text: 'Не удалось получить список' }));
      }
    }

    loaderSelect.addEventListener('change', () => {
      data.loaderVersion = loaderSelect.value;
    });

    function renderCovers() {
      UI.clear(coverRow);
      for (const cover of ['autumn', 'village', 'winter', 'snow', 'caves', 'desert']) {
        const button = UI.el('button', {
          class: `chip${data.cover === cover ? ' active' : ''}`,
          style: { padding: '3px 10px 3px 3px' },
        });
        button.append(UI.el('img', { src: UI.coverFor(cover), style: { width: '26px', height: '20px', objectFit: 'cover', borderRadius: '6px' } }));
        button.append(coverName(cover));
        button.addEventListener('click', () => {
          data.cover = cover;
          renderCovers();
        });
        coverRow.append(button);
      }
    }

    function coverName(cover) {
      return { autumn: 'Осень', village: 'Деревня', winter: 'Зима', snow: 'Снежный край', caves: 'Пещеры', desert: 'Пустыня' }[cover] || cover;
    }

    body.append(
      UI.el('div', { class: 'field' }, UI.el('label', {}, 'Название сборки'), nameInput),
      UI.el('div', { class: 'field' }, UI.el('label', {}, 'Версия Minecraft'), selected, searchInput, list),
      UI.el('div', { class: 'field' }, UI.el('label', {}, 'Загрузчик модов'), loaderRow, loaderWrap),
      UI.el('div', { class: 'field' }, UI.el('label', {}, 'Обложка'), coverRow),
      UI.el(
        'div',
        { class: 'field' },
        UI.el('div', { class: 'row between' }, UI.el('label', {}, 'Оперативная память'), memValue),
        memSlider,
      ),
      UI.el(
        'div',
        { class: 'switch-row', style: { border: '0', padding: '0' } },
        UI.el('div', { class: 'switch-text' }, UI.el('strong', {}, 'Скачать файлы сразу'), UI.el('small', {}, 'Библиотеки и ресурсы займут 300–900 МБ')),
        installSwitch,
      ),
    );

    renderVersions();
    renderSelected();
    renderLoaders();
    renderCovers();
    searchInput.addEventListener('input', UI.debounce(renderVersions, 160));
    loadLoaderVersions();

    const modal = UI.modal({
      title: 'Новая сборка',
      subtitle: 'Отдельная папка: моды, ресурспаки, миры',
      wide: true,
      body,
      actions: [
        { label: 'Отмена', kind: 'ghost' },
        {
          label: 'Создать',
          kind: 'primary',
          icon: 'plus',
          onClick: async () => {
            try {
              const instance = await UI.req(
                window.api.instances.create({
                  name: nameInput.value.trim() || `Minecraft ${data.mcVersion}`,
                  mcVersion: data.mcVersion,
                  loader: { type: data.loader, version: data.loaderVersion || null },
                  cover: data.cover,
                  memoryMB: data.memory,
                  icon: prefill.icon || null,
                  modpack: prefill.modpack || null,
                }),
              );
              await App.reloadInstances();
              App.setInstance(instance.id);
              UI.toast('Сборка создана', 'success');
              if (data.install) App.installInstance(instance.id);
              return true;
            } catch (error) {
              UI.toast(error.message, 'error');
              return false;
            }
          },
        },
      ],
    });

    setTimeout(() => nameInput.focus(), 60);
    return modal;
  }

  function gameOptionsBlock(instance) {
    const save = (patch) => window.api.instances.saveOptions(instance.id, patch).catch(() => {});
    const badge = (text) => UI.el('span', { class: 'badge accent', text });

    const lang = UI.el('select', { class: 'select' });
    for (const [code, name] of [
      ['ru_ru', 'Русский'],
      ['en_us', 'English'],
      ['uk_ua', 'Українська'],
      ['be_by', 'Беларуская'],
      ['kk_kz', 'Қазақша'],
      ['de_de', 'Deutsch'],
      ['fr_fr', 'Français'],
      ['es_es', 'Español'],
      ['pt_br', 'Português'],
      ['zh_cn', '中文'],
      ['ja_jp', '日本語'],
    ]) {
      lang.append(UI.el('option', { value: code, text: name }));
    }
    lang.addEventListener('change', () => save({ lang: lang.value }));

    const graphics = UI.el('select', { class: 'select' },
      UI.el('option', { value: 'fast', text: 'Быстрая' }),
      UI.el('option', { value: 'fancy', text: 'Красивая' }),
      UI.el('option', { value: 'fabulous', text: 'Превосходная' }),
    );
    graphics.addEventListener('change', () => save({ graphicsMode: graphics.value }));

    const particles = UI.el('select', { class: 'select' },
      UI.el('option', { value: 'all', text: 'Все' }),
      UI.el('option', { value: 'decreased', text: 'Меньше' }),
      UI.el('option', { value: 'minimal', text: 'Минимум' }),
    );
    particles.addEventListener('change', () => save({ particles: particles.value }));

    const guiScale = UI.el('select', { class: 'select' },
      UI.el('option', { value: '0', text: 'Авто' }),
      UI.el('option', { value: '1', text: '1×' }),
      UI.el('option', { value: '2', text: '2×' }),
      UI.el('option', { value: '3', text: '3×' }),
      UI.el('option', { value: '4', text: '4×' }),
    );
    guiScale.addEventListener('change', () => save({ guiScale: guiScale.value }));

    function sliderRow(label, slider, suffix) {
      const value = badge(`${slider.value}${suffix || ''}`);
      slider.addEventListener('input', () => {
        value.textContent = `${slider.value}${suffix || ''}`;
        slider.style.setProperty('--fill', `${((Number(slider.value) - Number(slider.min)) / (Number(slider.max) - Number(slider.min))) * 100}%`);
      });
      return UI.el('div', { class: 'field' }, UI.el('div', { class: 'row between' }, UI.el('label', {}, label), value), slider);
    }

    const renderDist = UI.el('input', { class: 'slider', type: 'range', min: '2', max: '32', step: '1', value: '8' });
    renderDist.style.setProperty('--fill', '20%');
    renderDist.addEventListener('change', () => save({ renderDistance: renderDist.value }));

    const simDist = UI.el('input', { class: 'slider', type: 'range', min: '5', max: '32', step: '1', value: '8' });
    simDist.style.setProperty('--fill', '11%');
    simDist.addEventListener('change', () => save({ simulationDistance: simDist.value }));

    const fov = UI.el('input', { class: 'slider', type: 'range', min: '30', max: '110', step: '1', value: '70' });
    fov.style.setProperty('--fill', '50%');
    fov.addEventListener('change', () => save({ fov: fov.value }));

    const volume = UI.el('input', { class: 'slider', type: 'range', min: '0', max: '100', step: '5', value: '80' });
    volume.style.setProperty('--fill', '80%');
    volume.addEventListener('change', () => save({ soundCategory_master: (Number(volume.value) / 100).toFixed(1) }));

    const maxFps = UI.el('input', { class: 'input', type: 'number', min: '30', max: '260', step: '10', value: '120' });
    maxFps.addEventListener('change', () => save({ maxFps: maxFps.value }));

    const vsync = UI.el('div', { class: 'switch' });
    vsync.addEventListener('click', () => {
      const on = !vsync.classList.contains('on');
      vsync.classList.toggle('on', on);
      save({ enableVsync: on ? 'true' : 'false' });
    });

    const host = UI.el(
      'div',
      { class: 'setting-block' },
      UI.el('div', { class: 'divider' }),
      UI.el('div', { class: 'card-title', style: { marginBottom: '10px' } }, UI.icon('settings'), 'Настройки игры (options.txt)'),
      UI.el('div', { class: 'field-row' },
        UI.el('div', { class: 'field' }, UI.el('label', {}, 'Язык'), lang),
        UI.el('div', { class: 'field' }, UI.el('label', {}, 'Графика'), graphics),
      ),
      UI.el('div', { class: 'field-row' },
        UI.el('div', { class: 'field' }, UI.el('label', {}, 'Частицы'), particles),
        UI.el('div', { class: 'field' }, UI.el('label', {}, 'Масштаб интерфейса'), guiScale),
      ),
      sliderRow('Дальность прорисовки (чанков)', renderDist),
      sliderRow('Дальность симуляции (чанков)', simDist),
      sliderRow('Обзор (FOV)', fov, '°'),
      sliderRow('Громкость', volume, '%'),
      UI.el('div', { class: 'field-row' },
        UI.el('div', { class: 'field' }, UI.el('label', {}, 'Лимит FPS'), maxFps),
        UI.el('div', { class: 'switch-row', style: { border: '0', paddingTop: '18px' } },
          UI.el('div', { class: 'switch-text' }, UI.el('strong', {}, 'V-Sync'), UI.el('small', {}, 'Вертикальная синхронизация')),
          vsync,
        ),
      ),
      UI.el('p', { class: 'tiny muted' }, 'Сохраняется сразу в options.txt сборки и применяется при следующем запуске игры.'),
    );

    (async () => {
      try {
        const o = await UI.req(window.api.instances.options(instance.id));
        lang.value = o.lang || 'ru_ru';
        graphics.value = o.graphicsMode || 'fancy';
        particles.value = o.particles || 'all';
        guiScale.value = String(o.guiScale || '0');
        renderDist.value = String(o.renderDistance || '8');
        simDist.value = String(o.simulationDistance || '8');
        fov.value = String(o.fov || '70');
        volume.value = String(Math.round((Number(o.soundCategory_master) || 0.8) * 100));
        maxFps.value = String(o.maxFps || '120');
        vsync.classList.toggle('on', String(o.enableVsync) !== 'false');
        for (const slider of [renderDist, simDist, fov, volume]) {
          slider.dispatchEvent(new Event('input'));
        }
      } catch {
        /* останутся значения по умолчанию */
      }
    })();

    return host;
  }

  function settingsDialog(instance) {
    const body = UI.el('div', { class: 'stack', style: { gap: '14px' } });
    const data = {
      name: instance.name,
      memoryMB: instance.memoryMB,
      resolution: { ...(instance.resolution || { width: 1280, height: 720, custom: false }) },
      fullscreen: Boolean(instance.fullscreen),
      jvmArgs: instance.jvmArgs || '',
      gameArgs: instance.gameArgs || '',
      javaPath: instance.javaPath || '',
      cover: instance.cover,
    };

    const nameInput = UI.el('input', { class: 'input', value: data.name, oninput: (e) => (data.name = e.target.value) });
    const memValue = UI.el('span', { class: 'badge accent', text: `${data.memoryMB} МБ` });
    const memSlider = UI.el('input', {
      class: 'slider',
      type: 'range',
      min: '1024',
      max: String(Math.max(8192, Math.round((App.state.info.totalMemory || 8e9) / 1048576))),
      step: '512',
      value: String(data.memoryMB),
    });
    memSlider.addEventListener('input', () => {
      data.memoryMB = Number(memSlider.value);
      memValue.textContent = `${data.memoryMB} МБ`;
      memSlider.style.setProperty('--fill', `${((data.memoryMB - 1024) / (Number(memSlider.max) - 1024)) * 100}%`);
    });
    memSlider.style.setProperty('--fill', `${((data.memoryMB - 1024) / (Number(memSlider.max) - 1024)) * 100}%`);

    const widthInput = UI.el('input', { class: 'input', type: 'number', value: String(data.resolution.width), min: '640', oninput: (e) => (data.resolution.width = Number(e.target.value)) });
    const heightInput = UI.el('input', { class: 'input', type: 'number', value: String(data.resolution.height), min: '480', oninput: (e) => (data.resolution.height = Number(e.target.value)) });
    const resSwitch = UI.el('div', { class: `switch${data.resolution.custom ? ' on' : ''}` });
    resSwitch.addEventListener('click', () => {
      data.resolution.custom = !data.resolution.custom;
      resSwitch.classList.toggle('on', data.resolution.custom);
    });
    const fullSwitch = UI.el('div', { class: `switch${data.fullscreen ? ' on' : ''}` });
    fullSwitch.addEventListener('click', () => {
      data.fullscreen = !data.fullscreen;
      fullSwitch.classList.toggle('on', data.fullscreen);
    });

    const javaSelect = UI.el('select', { class: 'select' });
    javaSelect.append(UI.el('option', { value: '', text: 'Автоматически (по версии игры)' }));
    for (const item of App.state.javaList || []) {
      javaSelect.append(UI.el('option', { value: item.path, text: `Java ${item.major} — ${item.path}` }));
    }
    javaSelect.value = data.javaPath;
    javaSelect.addEventListener('change', () => (data.javaPath = javaSelect.value));

    const jvmArea = UI.el('textarea', { class: 'textarea', placeholder: 'Дополнительные аргументы JVM', value: data.jvmArgs, oninput: (e) => (data.jvmArgs = e.target.value) });
    const gameArea = UI.el('textarea', { class: 'textarea', placeholder: 'Дополнительные аргументы игры', value: data.gameArgs, oninput: (e) => (data.gameArgs = e.target.value) });

    const coverRow = UI.el('div', { class: 'chips' });
    for (const cover of ['autumn', 'village', 'winter', 'snow', 'caves', 'desert']) {
      const chip = UI.el('button', { class: `chip${data.cover === cover ? ' active' : ''}` });
      chip.append(UI.el('img', { src: UI.coverFor(cover), style: { width: '26px', height: '20px', objectFit: 'cover', borderRadius: '6px' } }));
      chip.addEventListener('click', () => {
        data.cover = cover;
        [...coverRow.children].forEach((node) => node.classList.remove('active'));
        chip.classList.add('active');
      });
      coverRow.append(chip);
    }

    const gameDir = `${App.state.info.root}\\versions\\${instance.id}`;

    body.append(
      UI.el('div', { class: 'field' }, UI.el('label', {}, 'Название'), nameInput),
      UI.el(
        'div',
        { class: 'field' },
        UI.el('div', { class: 'row between' }, UI.el('label', {}, 'Оперативная память'), memValue),
        memSlider,
      ),
      UI.el(
        'div',
        { class: 'field-row' },
        UI.el('div', { class: 'field' }, UI.el('label', {}, 'Ширина окна'), widthInput),
        UI.el('div', { class: 'field' }, UI.el('label', {}, 'Высота окна'), heightInput),
      ),
      UI.el(
        'div',
        {},
        UI.el('div', { class: 'switch-row' }, UI.el('div', { class: 'switch-text' }, UI.el('strong', {}, 'Своё разрешение окна'), UI.el('small', {}, 'Иначе — значение по умолчанию')), resSwitch),
        UI.el('div', { class: 'switch-row' }, UI.el('div', { class: 'switch-text' }, UI.el('strong', {}, 'Полноэкранный режим')), fullSwitch),
      ),
      UI.el('div', { class: 'field' }, UI.el('label', {}, 'Java'), javaSelect),
      gameOptionsBlock(instance),
      UI.el('div', { class: 'field-row' }, UI.el('div', { class: 'field' }, UI.el('label', {}, 'Аргументы JVM'), jvmArea), UI.el('div', { class: 'field' }, UI.el('label', {}, 'Аргументы игры'), gameArea)),
      UI.el('div', { class: 'field' }, UI.el('label', {}, 'Обложка'), coverRow),
      UI.el(
        'div',
        { class: 'row', style: { justifyContent: 'space-between' } },
        UI.el('div', { class: 'small muted', text: `${instance.mcVersion} • ${App.loaderLabel(instance.loader) || 'Vanilla'}` }),
        UI.el('button', { class: 'btn sm ghost', onclick: () => window.api.instances.openFolder(instance.id) }, UI.icon('folder'), 'Папка сборки'),
      ),
    );

    const modal = UI.modal({
      title: instance.name,
      subtitle: 'Настройки сборки',
      wide: true,
      body,
      actions: [
        {
          label: 'Удалить',
          kind: 'danger',
          icon: 'trash',
          onClick: async () => {
            const confirmed = await UI.confirm('Удалить сборку?', `Папка «${instance.name}» со всеми модами и мирами будет удалена.`, {
              okText: 'Удалить',
              danger: true,
            });
            if (!confirmed) return false;
            await UI.req(window.api.instances.remove(instance.id));
            await App.reloadInstances();
            UI.toast('Сборка удалена', 'success');
            App.refresh();
            return true;
          },
        },
        {
          label: 'Сохранить',
          kind: 'primary',
          icon: 'save',
          onClick: async () => {
            try {
              await UI.req(
                window.api.instances.update(instance.id, {
                  name: data.name.trim() || instance.name,
                  memoryMB: data.memoryMB,
                  resolution: data.resolution,
                  fullscreen: data.fullscreen,
                  jvmArgs: data.jvmArgs,
                  gameArgs: data.gameArgs,
                  javaPath: data.javaPath,
                  cover: data.cover,
                }),
              );
              await App.reloadInstances();
              UI.toast('Настройки сохранены', 'success');
              App.refresh();
              return true;
            } catch (error) {
              UI.toast(error.message, 'error');
              return false;
            }
          },
        },
      ],
    });
    return modal;
  }

  let selecting = false;
  const picked = new Set();

  function togglePick(id) {
    if (picked.has(id)) picked.delete(id);
    else picked.add(id);
    App.refresh();
  }

  async function deletePicked() {
    if (!picked.size) return;
    const confirmed = await UI.confirm(
      `Удалить ${picked.size} ${picked.size === 1 ? 'сборку' : 'сборок'}?`,
      'Папки с модами и мирами переместятся в корзину лаунчера (trash) — их можно вернуть вручную.',
      { okText: 'Удалить', danger: true },
    );
    if (!confirmed) return;
    try {
      const removed = await UI.req(window.api.instances.removeMany([...picked]));
      selecting = false;
      picked.clear();
      await App.reloadInstances();
      UI.toast(`Удалено сборок: ${removed.length}`, 'success');
      App.refresh();
    } catch (error) {
      UI.toast(error.message, 'error');
    }
  }

  function card(instance) {
    const running = App.state.running[instance.id];
    const cover = UI.coverFor(instance.cover);
    const badges = UI.el('div', { class: 'badges' });
    badges.append(UI.el('span', { class: 'badge', text: instance.mcVersion }));
    const loader = App.loaderLabel(instance.loader);
    if (loader) badges.append(UI.el('span', { class: 'badge accent', text: loader }));
    if (instance.sharedPack) badges.append(UI.el('span', { class: 'badge', text: 'общая' }));

    const playBtn = UI.el(
      'button',
      {
        class: `btn sm ${running ? 'danger' : 'primary'}`,
        onclick: (event) => {
          event.stopPropagation();
          App.launchInstance(instance);
        },
      },
      UI.icon(running ? 'stop' : 'play'),
      running ? 'Стоп' : 'Играть',
    );

    const check = UI.el(
      'span',
      { class: `pick-check${picked.has(instance.id) ? ' on' : ''}`, title: 'Выбрать сборку' },
      UI.icon('check'),
    );

    const cardEl = UI.el(
      'div',
      {
        class: `inst-card${selecting ? ' selectable' : ''}${picked.has(instance.id) ? ' picked' : ''}`,
        onclick: () => (selecting ? togglePick(instance.id) : settingsDialog(instance)),
      },
      selecting ? check : null,
      UI.el('div', { class: 'inst-cover', style: { backgroundImage: `url("${cover}")` } }, badges),
      UI.el(
        'div',
        { class: 'inst-body' },
        UI.el(
          'div',
          { class: 'inst-name' },
          instance.icon ? UI.el('img', { src: instance.icon }) : null,
          instance.name,
        ),
        UI.el(
          'div',
          { class: 'inst-sub' },
          App.loaderLabel(instance.loader) || 'Vanilla',
          '•',
          instance.lastPlayed ? `запуск ${UI.ago(instance.lastPlayed)}` : 'не запускался',
        ),
        UI.el(
          'div',
          { class: 'inst-actions' },
          playBtn,
          UI.el('button', { class: 'btn sm ghost icon-only', title: 'Настройки', onclick: (e) => { e.stopPropagation(); settingsDialog(instance); } }, UI.icon('settings')),
          UI.el('button', { class: 'btn sm ghost icon-only', title: 'Папка сборки', onclick: (e) => { e.stopPropagation(); window.api.instances.openFolder(instance.id); } }, UI.icon('folder')),
          UI.el('button', { class: 'btn sm ghost icon-only', title: 'Дублировать', onclick: async (e) => { e.stopPropagation(); try { await UI.req(window.api.instances.duplicate(instance.id)); await App.reloadInstances(); App.refresh(); UI.toast('Сборка скопирована', 'success'); } catch (error) { UI.toast(error.message, 'error'); } } }, UI.icon('layers')),
          instance.sharedPack
            ? UI.el('button', {
                class: 'btn sm ghost icon-only',
                title: 'Удалить общую сборку (у обоих пропадёт)',
                onclick: async (e) => {
                  e.stopPropagation();
                  const ok = await UI.confirm('Удалить общую сборку?', `«${instance.name}» пропадёт из общих и удалится на этом ПК. Моды у друга останутся.`);
                  if (!ok) return;
                  try {
                    const res = await UI.req(window.api.friends.deleteShared(instance.id));
                    await App.reloadInstances();
                    App.refresh();
                    UI.toast(res.deleted ? 'Общая сборка удалена у всех' : 'Вы вышли из общей сборки', 'success');
                  } catch (error) {
                    UI.toast(error.message, 'error', 8000);
                  }
                },
              }, UI.icon('trash'))
            : null,
        ),
      ),
    );
    return cardEl;
  }

  return {
    title: 'Сборки',
    kicker: 'Моды, миры и настройки',
    render(container) {
      const state = App.state;
      const actions = document.getElementById('page-actions');
      UI.clear(actions);

      if (state.instances.length) {
        const bar = UI.el('div', { class: 'row', style: { gap: '8px' } },
          UI.el('button', {
            class: 'btn sm',
            onclick: () => {
              selecting = !selecting;
              picked.clear();
              App.refresh();
            },
          }, UI.icon(selecting ? 'x' : 'check'), selecting ? 'Отмена' : 'Выбрать'),
        );
        if (selecting) {
          bar.append(UI.el('button', {
            class: 'btn sm danger',
            disabled: !picked.size,
            onclick: deletePicked,
          }, UI.icon('trash'), `Удалить (${picked.size})`));
          if (picked.size) {
            bar.append(UI.el('button', {
              class: 'btn sm ghost',
              onclick: () => {
                picked.clear();
                App.refresh();
              },
            }, 'Снять выбор'));
          }
        }
        actions.append(bar);
      }

      if (selecting) {
        container.append(UI.el('div', { class: 'page-notice' }, UI.icon('info'),
          UI.el('span', {}, 'Отметьте сборки кликом и нажмите «Удалить». Папки переместятся в trash — данные можно вернуть.')));
      }

      const grid = UI.el('div', { class: 'grid auto' });
      for (const instance of state.instances) grid.append(card(instance));
      if (!selecting) {
        grid.append(
          UI.el(
            'button',
            { class: 'new-instance', onclick: () => createDialog() },
            UI.el('div', { class: 'plus' }, UI.icon('plus')),
            'Новая сборка',
          ),
        );
      }
      container.append(grid);

      if (!state.instances.length) {
        container.append(
          UI.el(
            'div',
            { class: 'card empty', style: { marginTop: '16px' } },
            UI.el('img', { src: 'assets/empty-chest.jpg' }),
            UI.el('h3', {}, 'Здесь появятся сборки'),
            UI.el('p', {}, 'Каждая сборка — своя папка в versions: моды, ресурспаки, миры и настройки не пересекаются.'),
          ),
        );
      }
    },
    createDialog,
    settingsDialog,
    card,
  };
})();

