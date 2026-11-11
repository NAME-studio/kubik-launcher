'use strict';

window.Views = window.Views || {};

window.Views.logs = (() => {
  let currentFile = null;
  let unsubscribe = null;

  async function loadFiles(listHost, consoleHost) {
    try {
      const files = await UI.req(window.api.logs.list());
      UI.clear(listHost);
      if (!files.length) {
        listHost.append(UI.el('div', { class: 'muted small', text: 'Логов пока нет — запустите игру.' }));
        return;
      }
      if (!currentFile || !files.some((f) => f.file === currentFile)) currentFile = files[0].file;
      for (const file of files) {
        const row = UI.el(
          'button',
          { class: `log-file${file.file === currentFile ? ' active' : ''}` },
          UI.el('div', { class: 'name', text: file.file }),
          UI.el('div', { class: 'tiny muted', text: `${UI.date(file.mtime)} • ${file.sizeLabel}` }),
        );
        row.addEventListener('click', () => {
          currentFile = file.file;
          [...listHost.children].forEach((node) => node.classList.remove('active'));
          row.classList.add('active');
          loadContent(consoleHost);
        });
        listHost.append(row);
      }
    } catch (error) {
      UI.clear(listHost);
      listHost.append(UI.el('div', { class: 'muted small', text: error.message }));
    }
  }

  async function loadContent(consoleHost) {
    if (!currentFile) return;
    consoleHost.textContent = 'Загрузка…';
    try {
      const text = await UI.req(window.api.logs.read(currentFile, 800));
      consoleHost.textContent = text || 'Файл пуст';
      consoleHost.scrollTop = consoleHost.scrollHeight;
    } catch (error) {
      consoleHost.textContent = `Ошибка чтения: ${error.message}`;
    }
  }

  return {
    title: 'Логи',
    kicker: 'Диагностика запуска',
    render(container) {
      const listHost = UI.el('div', { class: 'log-files' });
      const consoleHost = UI.el('div', { class: 'console' });
      const filesCard = UI.el(
        'div',
        { class: 'card pad' },
        UI.el('div', { class: 'card-head' }, UI.el('div', { class: 'card-title' }, UI.icon('terminal'), 'Файлы логов')),
        listHost,
      );
      const consoleCard = UI.el(
        'div',
        { class: 'card pad' },
        UI.el(
          'div',
          { class: 'card-head' },
          UI.el('div', { class: 'card-title' }, UI.icon('terminal'), currentFile || 'Лог'),
          UI.el(
            'div',
            { class: 'row', style: { gap: '6px' } },
            UI.el('button', {
              class: 'btn sm ghost icon-only',
              title: 'Обновить',
              onclick: () => {
                loadFiles(listHost, consoleHost);
                loadContent(consoleHost);
              },
            }, UI.icon('refresh')),
            UI.el('button', {
              class: 'btn sm ghost icon-only',
              title: 'Открыть папку логов',
              onclick: () => window.api.openPath(`${App.state.info.root}\\logs`),
            }, UI.icon('folder')),
          ),
        ),
        consoleHost,
      );

      container.append(UI.el('div', { class: 'logs-layout' }, filesCard, consoleCard));
      loadFiles(listHost, consoleHost).then(() => loadContent(consoleHost));

      unsubscribe = App.on('log', (payload) => {
        if (payload.instanceId && payload.text) {
          consoleHost.append(document.createTextNode(payload.text));
          consoleHost.scrollTop = consoleHost.scrollHeight;
        }
      });
    },
    destroy() {
      if (unsubscribe) unsubscribe();
      unsubscribe = null;
    },
  };
})();
