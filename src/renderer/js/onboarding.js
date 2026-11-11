'use strict';

window.Views = window.Views || {};

window.Views.onboarding = (() => {
  const STEP_TITLES = {
    welcome: 'Первый запуск',
    progress: 'Подготовка файлов',
    done: 'Всё готово',
  };

  function open(onDone) {
    const host = document.getElementById('modal-root');
    host.innerHTML = '';
    host.classList.add('open');

    const card = UI.el('div', { class: 'modal wide onboard' });
    const head = UI.el('div', { class: 'modal-head onboard-head' },
      UI.el('div', { class: 'grow' },
        UI.el('div', { class: 'page-kicker', text: 'Kubik Launcher' }),
        UI.el('h3', { id: 'onboard-title', text: STEP_TITLES.welcome }),
      ),
      UI.el('span', { class: 'badge accent', text: 'v' + App.state.info.version }),
    );
    const body = UI.el('div', { class: 'modal-body' });
    const foot = UI.el('div', { class: 'modal-foot' });
    card.append(head, body, foot);
    host.append(card);
    host.addEventListener('mousedown', (event) => event.stopPropagation());

    let finished = false;
    const cleanup = async () => {
      if (finished) return;
      finished = true;
      try {
        await UI.req(window.api.settings.save({ firstRun: false }));
        App.state.settings.firstRun = false;
      } catch {
        /* ignore */
      }
      host.classList.remove('open');
      host.innerHTML = '';
      host.replaceWith(host.cloneNode(false));
      if (onDone) onDone();
    };

    function stepTitle(text) {
      head.querySelector('h3').textContent = text;
    }

    function showWelcome() {
      stepTitle(STEP_TITLES.welcome);
      UI.clear(body);
      UI.clear(foot);

      const instances = App.state.instances || [];
      const account = App.state.currentAccount;

      body.append(
        UI.el('div', { class: 'onboard-hero' },
          UI.el('div', { class: 'onboard-logo' }, UI.icon('cube')),
          UI.el('div', {},
            UI.el('h2', { text: 'Добро пожаловать в Kubik Launcher' }),
            UI.el('p', { class: 'muted', text: 'Чистая установка не тронет ваши сборки, миры, скины и аккаунт. Лаунчер только проверит файлы и докачает недостающие библиотеки.' }),
          ),
        ),
        UI.el('div', { class: 'onboard-facts' },
          UI.el('div', { class: 'onboard-fact' }, UI.icon('folder'),
            UI.el('div', {}, UI.el('strong', {}, 'Папка данных'), UI.el('div', { class: 'tiny muted', text: App.state.info.root }))),
          UI.el('div', { class: 'onboard-fact' }, UI.icon('layers'),
            UI.el('div', {}, UI.el('strong', {}, 'Сборок найдено'), UI.el('div', { class: 'tiny muted', text: String(instances.length) }))),
          UI.el('div', { class: 'onboard-fact' }, UI.icon('user'),
            UI.el('div', {}, UI.el('strong', {}, 'Аккаунт'), UI.el('div', { class: 'tiny muted', text: account ? `${account.username} (${account.type === 'local' ? 'офлайн' : account.type})` : 'не выбран — можно позже' }))),
        ),
        UI.el('div', { class: 'notice' }, UI.icon('info'),
          UI.el('span', {}, instances.length
            ? 'Проверка файлов безопасна: уже скачанное сверяется по SHA1 и пропускается, докачиваются только отсутствующие или повреждённые файлы.'
            : 'Сейчас сборок нет. Можно сразу создать первую — или пропустить и настроить лаунчер позже.')),
      );

      foot.append(
        UI.el('button', { class: 'btn ghost', onclick: cleanup }, 'Пропустить'),
        UI.el('button', { class: 'btn', onclick: () => window.api.openPath(App.state.info.root) }, UI.icon('folder'), 'Открыть папку'),
        UI.el('button', {
          class: 'btn primary',
          onclick: () => (instances.length ? startPrepare() : cleanup()),
        }, UI.icon(instances.length ? 'download' : 'play'), instances.length ? 'Проверить и докачать' : 'Начать'),
      );
    }

    async function startPrepare() {
      stepTitle(STEP_TITLES.progress);
      UI.clear(body);
      UI.clear(foot);

      const instances = App.state.instances || [];
      const rows = new Map();
      const listHost = UI.el('div', { class: 'onboard-list' });
      const overallBar = UI.el('div', { class: 'progress' }, UI.el('i', { style: { width: '0%' } }));
      const overallLabel = UI.el('div', { class: 'progress-label' }, UI.el('span', { text: 'Проверяю файлы…' }), UI.el('span', { text: '0%' }));

      for (const instance of instances) {
        const status = UI.el('span', { class: 'badge', text: 'ожидает' });
        const row = UI.el('div', { class: 'onboard-row' },
          UI.el('div', { class: 'grow' },
            UI.el('div', { class: 'onboard-row-name', text: instance.name }),
            UI.el('div', { class: 'tiny muted', text: `${instance.mcVersion} • ${App.loaderLabel(instance.loader) || 'Vanilla'}` }),
          ),
          status,
        );
        rows.set(instance.id, status);
        listHost.append(row);
      }

      body.append(
        UI.el('p', { class: 'muted', text: 'Скачиваются только отсутствующие файлы. Уже проверенные библиотеки и ресурсы пропускаются — процесс можно прервать и продолжить позже.' }),
        overallBar, overallLabel, listHost,
      );
      foot.append(UI.el('button', { class: 'btn ghost', onclick: cleanup }, 'Закрыть'), UI.el('span', { class: 'tiny muted', text: 'Можно свернуть окно — загрузка идёт в лаунчере' }));

      const total = instances.length;
      let done = 0;
      let current = null;

      const offPrepare = window.api.on('prepare:progress', (payload) => {
        const status = rows.get(payload.instanceId);
        if (!status) return;
        if (payload.phase === 'start') {
          status.textContent = 'проверяю';
          status.className = 'badge accent';
          current = payload.instanceId;
        } else {
          const ok = payload.result && payload.result.ok;
          status.textContent = ok ? 'готово' : 'ошибка';
          status.className = `badge ${ok ? 'accent' : 'red'}`;
          done = payload.index;
          const percent = Math.round((done / Math.max(1, total)) * 100);
          overallBar.querySelector('i').style.width = `${percent}%`;
          overallLabel.lastChild.textContent = `${percent}%`;
          overallLabel.firstChild.textContent = ok ? `Готово: ${payload.name}` : `Не удалось: ${payload.name}`;
        }
      });

      const offInstall = window.api.on('install:progress', (payload) => {
        if (payload.instanceId !== current) return;
        if (payload.percent != null) {
          const base = (done / Math.max(1, total)) * 100;
          const slice = 100 / Math.max(1, total);
          const percent = Math.min(100, Math.round(base + (payload.percent / 100) * slice));
          overallBar.querySelector('i').style.width = `${percent}%`;
        }
        if (payload.detail) overallLabel.firstChild.textContent = payload.detail;
      });

      let result = { results: [] };
      try {
        result = await UI.req(window.api.game.prepareAll());
      } catch (error) {
        UI.toast(`Подготовка: ${error.message}`, 'error', 8000);
      } finally {
        offPrepare();
        offInstall();
      }

      showDone(result.results || []);
    }

    function showDone(results) {
      stepTitle(STEP_TITLES.done);
      UI.clear(body);
      UI.clear(foot);

      const failed = results.filter((item) => !item.ok);
      const okCount = results.length - failed.length;

      body.append(
        UI.el('div', { class: 'onboard-hero' },
          UI.el('div', { class: `onboard-logo ${failed.length ? 'warn' : ''}` }, UI.icon(failed.length ? 'alert' : 'check')),
          UI.el('div', {},
            UI.el('h2', { text: failed.length ? 'Почти всё готово' : 'Всё готово к игре' }),
            UI.el('p', { class: 'muted', text: results.length
              ? `Проверено сборок: ${okCount} из ${results.length}. ${failed.length ? 'Часть файлов не скачалась — можно повторить позже.' : 'Недостающие библиотеки и ресурсы докачаны, существующие пропущены.'}`
              : 'Сборок пока нет — создайте первую на вкладке «Сборки».' }),
          ),
        ),
        failed.length
          ? UI.el('div', { class: 'onboard-list' }, ...failed.map((item) =>
              UI.el('div', { class: 'onboard-row' },
                UI.el('div', { class: 'grow' }, UI.el('div', { class: 'onboard-row-name', text: item.name }), UI.el('div', { class: 'tiny muted', text: item.error || 'неизвестная ошибка' })),
                UI.el('span', { class: 'badge red', text: 'ошибка' }),
              )))
          : null,
      );

      foot.append(
        UI.el('button', { class: 'btn', onclick: () => window.api.openPath(App.state.info.root) }, UI.icon('folder'), 'Папка лаунчера'),
        UI.el('button', { class: 'btn primary', onclick: cleanup }, UI.icon('play'), 'Перейти в лаунчер'),
      );
    }

    showWelcome();
  }

  return { open };
})();
