(function () {
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const path = window.location.pathname.split('/').pop() || 'index.html';
  let me = null;

  const api = async (url, options = {}) => {
    const response = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Ошибка сервера');
    return data;
  };

  const escapeHtml = (value) => String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

  const timeLabel = (value) => {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return '';
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(date);
  };

  const readImages = (files) => Promise.all(files.map((file) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  })));

  async function loadMe({ required = true } = {}) {
    const data = await api('/api/social/bootstrap');
    me = data.user;
    if (required && !me) window.location.replace('/register.html');
    return me;
  }

  function bindLogout() {
    $$('[data-logout]').forEach((button) => {
      button.addEventListener('click', async () => {
        await fetch('/api/logout', { method: 'POST' });
        window.location.href = '/';
      });
    });
  }

  function normalizeShell(active) {
    const sidebar = $('.feed-sidebar');
    if (!sidebar) return;
    $('.brand', sidebar).textContent = 'СОЗВЕЗДИЕ';
    const items = [
      ['feed', '/feed.html', '/images/лента.png', 'Лента'],
      ['create', '/create.html', '/images/создавай.png', 'Создавай'],
      ['notifications', '/notifications.html', '/images/уведомления.png', 'Уведомления'],
      ['profile', '/profile_new.html', '/images/профиль.png', 'Профиль'],
      ['chats', '/chats.html', '/images/чаты.png', 'Чаты']
    ];
    const nav = $('.menu', sidebar);
    if (nav) {
      nav.innerHTML = items.map(([key, href, icon, label]) => (
        `<a class="menu-item ${active === key ? 'is-active' : ''}" href="${href}"><img class="menu-icon" src="${icon}" alt="" />${label}</a>`
      )).join('');
    }
    const logout = $('[data-logout]', sidebar);
    if (logout) logout.innerHTML = '<img class="menu-icon" src="/images/выход.png" alt="" />Выйти';
  }

  function profileUrl(user) {
    if (!user) return '/profile_new.html';
    return me && user.id === me.id ? '/profile_new.html' : `/profile-other.html?id=${user.id}`;
  }

  function renderImages(images, className = 'post-image') {
    if (!images?.length) return '';
    return `<div class="post-gallery"><div class="post-gallery-track">${images.map((image) => (
      `<img class="${className}" src="${image}" alt="Фото" />`
    )).join('')}</div></div>`;
  }

  function renderPost(post) {
    const author = post.author || {};
    const isWallPost = post.wallOwner && post.wallOwner.id !== author.id;
    return `
      <article class="post" data-post-id="${post.id}">
        <div class="post-header">
          <a class="post-profile-link" href="${profileUrl(author)}">
            <img class="avatar" src="${author.avatar}" alt="${escapeHtml(author.name)}" />
          </a>
          <div class="post-meta">
            <p class="post-author"><a class="post-profile-link" href="${profileUrl(author)}">${escapeHtml(author.name)}</a></p>
            <span class="post-time">${isWallPost ? `для ${escapeHtml(post.wallOwner.name)} · ` : ''}${timeLabel(post.createdAt)}</span>
          </div>
        </div>
        ${post.text ? `<p class="post-text">${escapeHtml(post.text)}</p>` : ''}
        ${renderImages(post.images)}
        <div class="post-stats">
          <button class="like-btn ${post.liked ? 'is-liked' : ''}" type="button" data-like-id="${post.id}">
            <span class="stat"><img class="stat-icon" src="${post.liked ? '/images/лайк при нажатии.png' : '/images/лайк.png'}" alt="" />${post.likes}</span>
          </button>
          <span class="stat"><img class="stat-icon" src="/images/просмотры.png" alt="" />${post.views || 1}</span>
        </div>
      </article>
    `;
  }

  function renderFeedMessage(message) {
    const author = message.author || {};
    return `
      <article class="post" data-message-id="${message.id}">
        <div class="post-header">
          <a class="post-profile-link" href="${profileUrl(author)}">
            <img class="avatar" src="${author.avatar}" alt="${escapeHtml(author.name)}" />
          </a>
          <div class="post-meta">
            <p class="post-author"><a class="post-profile-link" href="${profileUrl(author)}">${escapeHtml(author.name)}</a></p>
            <span class="post-time">${timeLabel(message.createdAt)}</span>
          </div>
        </div>
        ${message.text ? `<p class="post-text">${escapeHtml(message.text)}</p>` : ''}
        ${renderImages(message.images)}
      </article>
    `;
  }

  async function initAuthPages() {
    if (path === 'login_new.html') {
      const form = $('#login-form');
      const error = $('#login-error');
      $('.eye')?.addEventListener('click', () => {
        const input = $('#login-password');
        input.type = input.type === 'password' ? 'text' : 'password';
      });
      form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          const emailOrPhone = $('#login-email').value.trim();
          const password = $('#login-password').value;
          await api('/api/login', { method: 'POST', body: JSON.stringify({ emailOrPhone, password }) });
          window.location.href = '/feed.html';
        } catch (err) {
          if (error) error.textContent = err.message;
        }
      });
    }

    if (path === 'register_new.html' || path === 'register.html') {
      const form = $('#register-form');
      $('.eye')?.addEventListener('click', () => {
        const input = $('#password');
        input.type = input.type === 'password' ? 'text' : 'password';
      });
      form?.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
          const result = await api('/api/register', {
            method: 'POST',
            body: JSON.stringify({
              email: $('#email').value.trim(),
              password: $('#password').value
            })
          });
          const params = new URLSearchParams({ email: result.email });
          window.location.href = `/verify.html?${params.toString()}`;
        } catch (err) {
          alert(err.message);
        }
      });
    }
  }

  async function initVerify() {
    if (path !== 'verify.html') return;
    const params = new URLSearchParams(location.search);
    const email = params.get('email') || '';
    const emailNode = $('#confirm-email');
    const errorNode = $('#confirm-error');
    const resend = $('#resend-timer');
    const inputs = $$('.otp input');
    if (emailNode) emailNode.textContent = email || 'вашу почту';
    let resendSeconds = 60;
    let resendTimer = null;
    const startResendTimer = () => {
      if (!resend) return;
      resend.disabled = true;
      resendSeconds = 60;
      resend.textContent = `Получить новый код через ${resendSeconds}с`;
      clearInterval(resendTimer);
      resendTimer = setInterval(() => {
        resendSeconds -= 1;
        resend.textContent = resendSeconds > 0 ? `Получить новый код через ${resendSeconds}с` : 'Получить новый код';
        if (resendSeconds <= 0) {
          clearInterval(resendTimer);
          resend.disabled = false;
        }
      }, 1000);
    };
    startResendTimer();
    inputs.forEach((input, index) => {
      input.addEventListener('input', () => {
        input.value = input.value.replace(/\D/g, '').slice(0, 1);
        if (input.value && inputs[index + 1]) inputs[index + 1].focus();
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Backspace' && !input.value && inputs[index - 1]) inputs[index - 1].focus();
      });
    });
    $('#verify-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      try {
        const code = inputs.map((input) => input.value).join('');
        await api('/api/verify-registration', {
          method: 'POST',
          body: JSON.stringify({ email, code })
        });
        window.location.href = '/feed.html';
      } catch (err) {
        if (errorNode) errorNode.textContent = err.message;
      }
    });
    resend?.addEventListener('click', async () => {
      try {
        await api('/api/resend-registration-code', {
          method: 'POST',
          body: JSON.stringify({ email })
        });
        if (errorNode) errorNode.textContent = 'Новый код отправлен на почту.';
        startResendTimer();
      } catch (err) {
        if (errorNode) errorNode.textContent = err.message;
      }
    });
  }

  async function initFeed() {
    if (path !== 'feed.html') return;
    await loadMe();
    normalizeShell('feed');
    bindLogout();
    const list = $('#post-list');
    const avatar = $('.composer .avatar');
    const text = $('#new-post-text');
    const input = $('#attach-input');
    let pendingImages = [];
    if (avatar) avatar.src = me.avatar;

    async function loadFeed() {
      const data = await api('/api/social/feed');
      list.innerHTML = data.messages.map(renderFeedMessage).reverse().join('') || '<p class="empty-state">В ленте пока нет сообщений</p>';
    }

    $('#attach-btn')?.addEventListener('click', () => input?.click());
    input?.addEventListener('change', async () => {
      pendingImages = await readImages(Array.from(input.files || []).slice(0, 4));
      $('#composer-preview').innerHTML = renderImages(pendingImages);
    });
    $('#publish-btn')?.addEventListener('click', async () => {
      await api('/api/social/feed', {
        method: 'POST',
        body: JSON.stringify({ text: text.value, images: pendingImages })
      });
      text.value = '';
      pendingImages = [];
      $('#composer-preview').innerHTML = '';
      await loadFeed();
    });
    await loadFeed();
  }

  async function initProfile() {
    if (!['profile_new.html', 'profile-other.html'].includes(path)) return;
    await loadMe();
    normalizeShell('profile');
    bindLogout();

    const isOwn = path === 'profile_new.html';
    const viewedId = isOwn ? me.id : Number(new URLSearchParams(location.search).get('id'));
    const viewed = isOwn ? me : (await api(`/api/social/users/${viewedId}`)).user;
    const list = isOwn ? $('#profile-post-list') : $('#other-post-list');
    const text = isOwn ? $('#profile-new-post-text') : $('#other-post-text');
    const attachInput = isOwn ? $('#profile-attach-input') : $('#other-attach-input');
    let pendingImages = [];

    $('.profile-name').textContent = viewed.name;
    $('.profile-handle').textContent = `@${viewed.handle}`;
    $('.profile-avatar').src = viewed.avatar;
    if ($('.profile-cover') && viewed.cover) $('.profile-cover').style.backgroundImage = `url("${viewed.cover}")`;
    if (isOwn && $('#profile-points-value')) $('#profile-points-value').innerHTML = `${viewed.points}<img class="profile-points-star" src="/images/звезда.png" alt="" />`;
    if (!isOwn && text) text.placeholder = `Написать на стене ${viewed.name}`;

    async function loadWall() {
      const data = await api(`/api/social/posts?wallOwnerId=${viewed.id}`);
      list.innerHTML = data.posts.map(renderPost).join('') || '<p class="empty-state">Постов пока нет</p>';
    }

    const attachButton = isOwn ? $('#profile-attach-btn') : $('#other-attach-btn');
    const preview = isOwn ? $('#profile-composer-preview') : $('#other-composer-preview');
    attachButton?.addEventListener('click', () => attachInput?.click());
    attachInput?.addEventListener('change', async () => {
      pendingImages = await readImages(Array.from(attachInput.files || []).slice(0, 4));
      preview.innerHTML = renderImages(pendingImages);
    });

    const publishButton = isOwn ? $('#profile-publish-btn') : $('#other-publish-btn');
    publishButton?.addEventListener('click', async () => {
      await api('/api/social/posts', {
        method: 'POST',
        body: JSON.stringify({ text: text.value, images: pendingImages, wallOwnerId: viewed.id })
      });
      text.value = '';
      pendingImages = [];
      preview.innerHTML = '';
      if (isOwn) await loadWall();
      else alert('Пост отправлен владельцу профиля на подтверждение.');
    });

    list?.addEventListener('click', async (event) => {
      const like = event.target.closest('[data-like-id]');
      if (!like) return;
      await api(`/api/social/posts/${like.dataset.likeId}/like`, { method: 'POST', body: '{}' });
      await loadWall();
    });

    if (isOwn) {
      $('#profile-avatar-trigger')?.addEventListener('click', () => $('#profile-avatar-input')?.click());
      $('#profile-cover-trigger')?.addEventListener('click', () => $('#profile-cover-input')?.click());
      $('#profile-avatar-input')?.addEventListener('change', async () => {
        const [image] = await readImages(Array.from($('#profile-avatar-input').files || []).slice(0, 1));
        if (!image) return;
        $('.profile-avatar').src = image;
        const data = await api('/api/social/profile', {
          method: 'PUT',
          body: JSON.stringify({ name: me.name, username: me.handle, bio: me.bio, avatar: image, cover: me.cover })
        });
        me = data.user;
      });
      $('#profile-cover-input')?.addEventListener('change', async () => {
        const [image] = await readImages(Array.from($('#profile-cover-input').files || []).slice(0, 1));
        if (!image) return;
        $('.profile-cover').style.backgroundImage = `url("${image}")`;
        const data = await api('/api/social/profile', {
          method: 'PUT',
          body: JSON.stringify({ name: me.name, username: me.handle, bio: me.bio, avatar: me.avatar, cover: image })
        });
        me = data.user;
      });
    }

    $('#profile-message-btn')?.addEventListener('click', async () => {
      const data = await api('/api/social/chats/direct', { method: 'POST', body: JSON.stringify({ userId: viewed.id }) });
      window.location.href = `/chats.html?chat=${data.chat.id}`;
    });

    $('#profile-tab-points')?.addEventListener('click', () => {
      $('#profile-posts-panel').hidden = true;
      $('#profile-points-panel').hidden = false;
      $('#profile-tab-posts').classList.remove('is-active');
      $('#profile-tab-points').classList.add('is-active');
    });
    $('#profile-tab-posts')?.addEventListener('click', () => {
      $('#profile-posts-panel').hidden = false;
      $('#profile-points-panel').hidden = true;
      $('#profile-tab-posts').classList.add('is-active');
      $('#profile-tab-points').classList.remove('is-active');
    });

    $('#profile-edit-btn')?.addEventListener('click', () => {
      $('#settings-name-input').value = me.name;
      $('#settings-username-input').value = me.handle;
      $('#settings-about-input').value = me.bio || '';
      $('#profile-settings-modal').classList.add('is-open');
    });
    $('#profile-settings-close')?.addEventListener('click', () => $('#profile-settings-modal').classList.remove('is-open'));
    $('#settings-account-tab')?.addEventListener('click', () => {
      $('#settings-account-pane').hidden = false;
      $('#settings-security-pane').hidden = true;
      $('#settings-account-tab').classList.add('is-active');
      $('#settings-security-tab').classList.remove('is-active');
    });
    $('#settings-security-tab')?.addEventListener('click', () => {
      $('#settings-account-pane').hidden = true;
      $('#settings-security-pane').hidden = false;
      $('#settings-security-tab').classList.add('is-active');
      $('#settings-account-tab').classList.remove('is-active');
    });
    $('#settings-save-btn')?.addEventListener('click', async () => {
      const data = await api('/api/social/profile', {
        method: 'PUT',
        body: JSON.stringify({
          name: $('#settings-name-input').value,
          username: $('#settings-username-input').value,
          bio: $('#settings-about-input').value,
          avatar: $('.profile-avatar').src,
          cover: me.cover
        })
      });
      me = data.user;
      window.location.reload();
    });

    let pendingSecurityAction = null;
    $('#settings-email-code')?.addEventListener('click', async () => {
      const message = $('#settings-security-message');
      try {
        const result = await api('/api/security/request-code', {
          method: 'POST',
          body: JSON.stringify({
            action: 'change_email',
            email: $('#settings-email-input').value.trim(),
            currentPassword: $('#settings-email-password').value
          })
        });
        pendingSecurityAction = { action: 'change_email', email: result.email };
        message.textContent = 'Код отправлен на новую почту.';
      } catch (err) {
        message.textContent = err.message;
      }
    });
    $('#settings-password-code')?.addEventListener('click', async () => {
      const message = $('#settings-security-message');
      try {
        const result = await api('/api/security/request-code', {
          method: 'POST',
          body: JSON.stringify({
            action: 'change_password',
            currentPassword: $('#settings-current-password').value,
            newPassword: $('#settings-new-password').value
          })
        });
        pendingSecurityAction = { action: 'change_password', email: result.email };
        message.textContent = 'Код отправлен на текущую почту.';
      } catch (err) {
        message.textContent = err.message;
      }
    });
    $('#settings-security-confirm')?.addEventListener('click', async () => {
      const message = $('#settings-security-message');
      if (!pendingSecurityAction) {
        message.textContent = 'Сначала запросите код.';
        return;
      }
      try {
        const result = await api('/api/security/confirm-code', {
          method: 'POST',
          body: JSON.stringify({
            action: pendingSecurityAction.action,
            email: pendingSecurityAction.email,
            code: $('#settings-security-code').value.trim()
          })
        });
        if (result.user) me = result.user;
        message.textContent = 'Изменения сохранены.';
      } catch (err) {
        message.textContent = err.message;
      }
    });

    await loadWall();
  }

  async function initNotifications() {
    if (path !== 'notifications.html') return;
    await loadMe();
    normalizeShell('notifications');
    bindLogout();
    $('.notifications-title') && ($('.notifications-title').textContent = 'Уведомления');
    $('.notifications-section-title') && ($('.notifications-section-title').textContent = 'НОВЫЕ');
    const list = $('#notifications-list');

    async function render() {
      const data = await api('/api/social/notifications');
      if (!data.notifications.length) {
        list.innerHTML = '<div class="notification-empty"><p>Пока уведомлений нет</p></div>';
        return;
      }
      list.innerHTML = data.notifications.map((item) => `
        <article class="notification-row">
          <img class="notification-avatar" src="${item.actor.avatar}" alt="" />
          <div class="notification-copy">
            <p class="notification-text"><span class="notification-name">${escapeHtml(item.actor.name)}</span> ${escapeHtml(item.body)}</p>
            ${item.postText ? `<p class="notification-post-preview">${escapeHtml(item.postText)}</p>` : ''}
            ${item.type === 'wall_post_request' && item.actionState === 'pending' ? `
              <div class="notification-actions">
                <button class="btn btn--small" data-wall-decision="accept" data-id="${item.id}" type="button">Выложить</button>
                <button class="btn btn--small" data-wall-decision="reject" data-id="${item.id}" type="button">Отклонить</button>
              </div>
            ` : ''}
          </div>
          <span class="notification-time">${timeLabel(item.createdAt)}</span>
        </article>
      `).join('');
    }

    list?.addEventListener('click', async (event) => {
      const button = event.target.closest('[data-wall-decision]');
      if (!button) return;
      await api(`/api/social/notifications/${button.dataset.id}/wall-post-decision`, {
        method: 'POST',
        body: JSON.stringify({ decision: button.dataset.wallDecision })
      });
      await render();
    });
    await render();
  }

  async function initCreate() {
    if (path !== 'create.html') return;
    await loadMe();
    normalizeShell('create');
    bindLogout();
    const shell = $('#quiz-shell');
    let data = await api('/api/social/create-data');
    let activeTest = null;
    let answers = [];
    let current = 0;

    function renderTests() {
      shell.innerHTML = `<div class="quiz-list"><h2 class="quiz-title">Выбери тест</h2>${data.tests.map((test) => {
        const done = data.completedTests.some((item) => item.test_id === test.id);
        return `<button class="quiz-item" type="button" data-test-id="${test.id}" ${done ? 'disabled' : ''}>
          <span class="quiz-item-name">${escapeHtml(test.title)}${done ? ' · пройден' : ''}</span>
          <span class="quiz-item-reward">+${test.reward}<img class="reward-star-icon" src="/images/звезда.png" alt="" /></span>
        </button>`;
      }).join('')}</div>`;
    }

    function renderMerch() {
      shell.innerHTML = `<div class="merch-grid">${data.merch.map((item) => `
        <article class="merch-card">
          <div class="merch-image-wrap"><img class="merch-image" src="${item.image}" alt="${escapeHtml(item.name)}" /><button class="merch-buy" type="button" data-merch-id="${item.id}">Купить</button></div>
          <div class="merch-bottom"><span class="merch-name">${escapeHtml(item.name)}</span><span class="merch-price">${item.price}<img class="reward-star-icon" src="/images/звезда.png" alt="" /></span></div>
        </article>`).join('')}</div>`;
    }

    function renderQuestion() {
      const question = activeTest.questions[current];
      shell.innerHTML = `<div class="quiz-flow"><div class="quiz-topline"><span>${escapeHtml(activeTest.title)}</span><span>${current + 1} / ${activeTest.questions.length}</span></div>
        <h3 class="quiz-question">${escapeHtml(question.text)}</h3>
        <div class="quiz-options">${question.options.map((option, index) => `<button class="quiz-option" data-answer="${index}" type="button">${escapeHtml(option)}</button>`).join('')}</div></div>`;
    }

    shell.addEventListener('click', async (event) => {
      const testButton = event.target.closest('[data-test-id]');
      if (testButton) {
        activeTest = data.tests.find((test) => test.id === testButton.dataset.testId);
        answers = [];
        current = 0;
        renderQuestion();
        return;
      }
      const answer = event.target.closest('[data-answer]');
      if (answer) {
        answers[current] = Number(answer.dataset.answer);
        current += 1;
        if (current < activeTest.questions.length) {
          renderQuestion();
        } else {
          const result = await api(`/api/social/tests/${activeTest.id}/complete`, { method: 'POST', body: JSON.stringify({ answers }) });
          data = await api('/api/social/create-data');
        }
        return;
      }
      if (event.target.closest('#quiz-again')) renderTests();
      const merchButton = event.target.closest('[data-merch-id]');
      if (merchButton) {
        try {
          const result = await api(`/api/social/merch/${merchButton.dataset.merchId}/buy`, { method: 'POST', body: JSON.stringify({}) });
          alert(`Покупка оформлена. Осталось баллов: ${result.points}`);
          data = await api('/api/social/create-data');
        } catch (err) {
          alert(err.message);
        }
      }
    });
    $('#tab-tasks')?.addEventListener('click', renderTests);
    $('#tab-merch')?.addEventListener('click', renderMerch);
    renderTests();
  }

  async function initChats() {
    if (path !== 'chats.html') return;
    await loadMe();
    normalizeShell('chats');
    bindLogout();
    $('.chats-title-bar') && ($('.chats-title-bar').textContent = 'Чаты');
    $('#chat-search-input') && ($('#chat-search-input').placeholder = 'Поиск');
    $('#chat-dialog-input') && ($('#chat-dialog-input').placeholder = 'Сообщение');
    const list = $('#chats-list');
    const search = $('#chat-search-input');
    const dialog = $('#chat-dialog-view');
    const listView = $('#chats-list-view');
    const messagesNode = $('#chat-dialog-messages');
    let activeChatId = Number(new URLSearchParams(location.search).get('chat')) || null;

    async function loadChats() {
      const data = await api('/api/social/chats');
      list.innerHTML = data.chats.map((chat) => `
        <article class="chat-row" data-chat-id="${chat.id}">
          <div class="chat-avatar">${chat.avatar?.startsWith('http') || chat.avatar?.startsWith('/') ? `<img class="chat-avatar-image" src="${chat.avatar}" alt="" />` : `<span class="chat-avatar-emoji">${escapeHtml(chat.avatar || '★')}</span>`}</div>
          <div class="chat-copy"><p class="chat-name">${escapeHtml(chat.title)}</p><p class="chat-preview">${escapeHtml(chat.type === 'group' ? 'Группа' : 'Личный чат')} · ${escapeHtml(chat.preview)}</p></div>
        </article>`).join('');
    }

    async function openChat(chatId) {
      activeChatId = Number(chatId);
      const data = await api(`/api/social/chats/${activeChatId}/messages`);
      $('#chat-dialog-name').textContent = data.chat.title;
      $('#chat-dialog-status').textContent = data.chat.type === 'group' ? 'групповой чат' : 'личный чат';
      $('#chat-dialog-avatar').innerHTML = data.chat.avatar?.startsWith('http') || data.chat.avatar?.startsWith('/')
        ? `<img class="chat-avatar-image" src="${data.chat.avatar}" alt="" />`
        : `<span class="chat-avatar-emoji">${escapeHtml(data.chat.avatar || '★')}</span>`;
      messagesNode.innerHTML = data.messages.map((message) => `
        <div class="chat-bubble-row ${message.isMine ? 'is-me' : 'is-them'}">
          ${!message.isMine ? `<img class="chat-message-avatar" src="${message.author.avatar}" alt="${escapeHtml(message.author.name)}" />` : ''}
          <div class="chat-bubble chat-bubble--text">
            ${!message.isMine ? `<span class="chat-message-author">${escapeHtml(message.author.name)}</span>` : ''}
            ${message.text ? `<span class="chat-message-text">${escapeHtml(message.text)}</span>` : ''}
            ${renderImages(message.images, 'chat-bubble-image')}
          </div>
        </div>`).join('');
      messagesNode.scrollTop = messagesNode.scrollHeight;
      listView.hidden = true;
      dialog.hidden = false;
    }

    list?.addEventListener('click', (event) => {
      const row = event.target.closest('[data-chat-id]');
      if (row) openChat(row.dataset.chatId);
    });
    $('#chat-back-btn')?.addEventListener('click', () => {
      dialog.hidden = true;
      listView.hidden = false;
    });
    $('#chat-dialog-form')?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = $('#chat-dialog-input');
      if (!activeChatId || !input.value.trim()) return;
      await api(`/api/social/chats/${activeChatId}/messages`, { method: 'POST', body: JSON.stringify({ text: input.value }) });
      input.value = '';
      await openChat(activeChatId);
      await loadChats();
    });
    search?.addEventListener('input', async () => {
      const q = search.value.trim();
      if (!q) return loadChats();
      const data = await api(`/api/social/chats/search?q=${encodeURIComponent(q)}`);
      list.innerHTML = [
        ...data.groups.map((group) => `<article class="chat-row" data-chat-id="${group.id}"><div class="chat-avatar"><span class="chat-avatar-emoji">${escapeHtml(group.avatar || '★')}</span></div><div class="chat-copy"><p class="chat-name">${escapeHtml(group.title)}</p><p class="chat-preview">Группа</p></div></article>`),
        ...data.users.map((user) => `<article class="chat-row" data-user-id="${user.id}"><div class="chat-avatar"><img class="chat-avatar-image" src="${user.avatar}" alt="" /></div><div class="chat-copy"><p class="chat-name">${escapeHtml(user.name)}</p><p class="chat-preview">Личный чат</p></div></article>`)
      ].join('');
    });
    list?.addEventListener('click', async (event) => {
      const userRow = event.target.closest('[data-user-id]');
      if (!userRow) return;
      const data = await api('/api/social/chats/direct', { method: 'POST', body: JSON.stringify({ userId: userRow.dataset.userId }) });
      await loadChats();
      await openChat(data.chat.id);
    });

    await loadChats();
    if (activeChatId) await openChat(activeChatId);
  }

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      await initAuthPages();
      await initVerify();
      await initFeed();
      await initProfile();
      await initNotifications();
      await initCreate();
      await initChats();
    } catch (err) {
      console.error(err);
    }
  });
})();
