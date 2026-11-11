'use strict';

(() => {
  const UI = {};

  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value === null || value === undefined || value === false) continue;
      if (key === 'class') node.className = value;
      else if (key === 'html') node.innerHTML = value;
      else if (key === 'text') node.textContent = value;
      else if (key === 'dataset') Object.assign(node.dataset, value);
      else if (key === 'style' && typeof value === 'object') Object.assign(node.style, value);
      else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
      else if (key === 'value') node.value = value;
      else if (key === 'checked') node.checked = Boolean(value);
      else node.setAttribute(key, value);
    }
    for (const child of children.flat(4)) {
      if (child === null || child === undefined || child === false) continue;
      node.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  function icon(name, className = 'icon') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', className);
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', `#i-${name}`);
    svg.append(use);
    return svg;
  }

  function clear(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
    return node;
  }

  const nf = new Intl.NumberFormat('ru-RU');

  UI.num = (value) => nf.format(Number(value) || 0);

  UI.bytes = (bytes) => {
    const value = Number(bytes) || 0;
    if (value < 1024) return `${value} Б`;
    const units = ['КБ', 'МБ', 'ГБ', 'ТБ'];
    let size = value / 1024;
    let unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    return `${size >= 10 ? Math.round(size) : size.toFixed(1)} ${units[unit]}`;
  };

  UI.date = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
  };

  UI.ago = (value) => {
    if (!value) return 'не запускался';
    const diff = Date.now() - Number(value);
    const minutes = Math.round(diff / 60000);
    if (minutes < 1) return 'только что';
    if (minutes < 60) return `${minutes} мин назад`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} ч назад`;
    const days = Math.round(hours / 24);
    if (days < 30) return `${days} дн назад`;
    return UI.date(value);
  };

  UI.esc = (text) =>
    String(text === null || text === undefined ? '' : text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  UI.coverFor = (cover) => {
    const legacy = {
      meadow: 'autumn',
      nether: 'caves',
      end: 'desert',
      mountains: 'winter',
      ocean: 'snow',
    };
    const name = legacy[cover] || cover || 'autumn';
    return `assets/cover-${name}.jpg`;
  };

  UI.debounce = (fn, delay = 350) => {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  };

  UI.req = async (promise) => {
    const result = await promise;
    if (!result || result.ok !== true) {
      const message = result && result.error ? result.error : 'Неизвестная ошибка';
      throw new Error(message);
    }
    return result.data;
  };

  UI.toast = (message, type = 'info', timeout = 4200) => {
    const root = document.getElementById('toast-root');
    if (window.Effects) window.Effects.sound(type === 'success' ? 'success' : type === 'error' ? 'error' : 'open');
    const iconName = type === 'success' ? 'check' : type === 'error' ? 'alert' : 'info';
    const node = el('div', { class: `toast ${type}` }, icon(iconName), el('span', { text: message }));
    root.append(node);
    setTimeout(() => {
      node.style.opacity = '0';
      node.style.transform = 'translateY(6px)';
      node.style.transition = 'opacity .2s, transform .2s';
      setTimeout(() => node.remove(), 220);
    }, timeout);
    return node;
  };

  UI.modal = (options = {}) => {
    const root = document.getElementById('modal-root');
    root.innerHTML = '';
    const box = el('div', { class: `modal${options.wide ? ' wide' : ''}` });
    const head = el(
      'div',
      { class: 'modal-head' },
      el('div', { class: 'grow' }, el('h3', { text: options.title || '' }), options.subtitle ? el('p', { text: options.subtitle }) : null),
      el('button', { class: 'btn ghost icon-only sm', onclick: () => close() }, icon('x')),
    );
    const body = el('div', { class: 'modal-body' });
    if (options.body) body.append(options.body);
    if (options.html) body.insertAdjacentHTML('beforeend', options.html);
    box.append(head, body);

    let foot = null;
    if (options.actions && options.actions.length) {
      foot = el('div', { class: 'modal-foot' });
      for (const action of options.actions) {
        const btn = el(
          'button',
          { class: `btn ${action.kind || ''}`.trim(), onclick: async () => {
            if (!action.onClick) return close();
            const result = await action.onClick();
            if (result !== false) close();
          } },
          action.icon ? icon(action.icon) : null,
          action.label,
        );
        if (action.disabled) btn.disabled = true;
        foot.append(btn);
        action.node = btn;
      }
      box.append(foot);
    }

    root.append(box);
    root.classList.add('open');

    function close() {
      root.classList.remove('open');
      root.innerHTML = '';
      if (options.onClose) options.onClose();
    }

    if (options.closable !== false) {
      root.addEventListener(
        'mousedown',
        (event) => {
          if (event.target === root) close();
        },
        { once: true },
      );
    }

    return { close, body, box, actions: options.actions || [] };
  };

  UI.confirm = (title, message, options = {}) =>
    new Promise((resolve) => {
      let settled = false;
      const modal = UI.modal({
        title,
        subtitle: message,
        actions: [
          { label: 'Отмена', kind: 'ghost', onClick: () => { settled = true; resolve(false); } },
          {
            label: options.okText || 'Подтвердить',
            kind: options.danger ? 'danger' : 'primary',
            onClick: () => { settled = true; resolve(true); },
          },
        ],
        onClose: () => {
          if (!settled) resolve(false);
        },
      });
      return modal;
    });

  UI.md = (text) => {
    if (!text) return '';
    let source = String(text)
      .replace(/\r\n/g, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\n{3,}/g, '\n\n');
    if (source.length > 12000) source = `${source.slice(0, 12000)}…`;
    let html = UI.esc(source);
    html = html.replace(/!\[[^\]]*\]\(([^)]+)\)/g, '');
    html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
    html = html.replace(/^###\s+(.+)$/gm, '<h4>$1</h4>');
    html = html.replace(/^##\s+(.+)$/gm, '<h3>$1</h3>');
    html = html.replace(/^#\s+(.+)$/gm, '<h2>$1</h2>');
    html = html.replace(/^\s*[-*]\s+(.+)$/gm, '<li>$1</li>');
    html = html.replace(/(<li>[\s\S]*?<\/li>)(?![\s\S]*?<li>)/g, '<ul>$1</ul>');
    html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
    html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
    html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    html = html
      .split(/\n{2,}/)
      .map((block) => (/^\s*<(h\d|ul|pre|li|p)/.test(block) ? block : `<p>${block.replace(/\n/g, '<br>')}</p>`))
      .join('');
    return html;
  };

  UI.skeletonCards = (count, className = 'skeleton') => {
    const wrap = el('div', { class: 'grid auto' });
    for (let i = 0; i < count; i += 1) wrap.append(el('div', { class: className }));
    return wrap;
  };

  UI.tooltip = (node, text) => {
    node.title = text;
    return node;
  };

  Object.assign(UI, { el, icon, clear });
  window.UI = UI;
})();
