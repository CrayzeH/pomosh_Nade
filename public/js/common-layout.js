(function () {
    // Функция для обновления UI авторизации
    function updateAuthUI() {
        const loginBtn = document.getElementById('loginHeaderBtn');
        const authButtons = document.getElementById('authButtons');
        const userMenu = document.getElementById('userProfile');
        const userNameDisplay = document.getElementById('userNameDisplay');

        // Проверяем localStorage
        const user = localStorage.getItem('currentUser');

        if (user && user !== 'undefined') {
            try {
                const userData = JSON.parse(user);
                if (authButtons) authButtons.style.display = 'none';
                if (userMenu) userMenu.style.display = 'block';
                if (userNameDisplay) {
                    const name = userData.full_name?.split(' ')[0] || userData.name || 'Профиль';
                    const avatar = userData.avatar || '/images/профиль.png';
                    userNameDisplay.textContent = '';
                    userNameDisplay.title = name;
                    userNameDisplay.classList.add('has-avatar');
                    const image = document.createElement('img');
                    image.className = 'header-user-avatar';
                    image.src = avatar;
                    image.alt = name;
                    userNameDisplay.appendChild(image);
                }
            } catch(e) {
                console.error('Ошибка:', e);
                if (authButtons) authButtons.style.display = 'flex';
                if (userMenu) userMenu.style.display = 'none';
            }
        } else {
            if (authButtons) authButtons.style.display = 'flex';
            if (userMenu) userMenu.style.display = 'none';
            if (userNameDisplay) {
                userNameDisplay.textContent = '';
                userNameDisplay.removeAttribute('title');
                userNameDisplay.classList.remove('has-avatar');
            }
        }
    }

    // Загрузка пользователя с сервера
    async function loadCurrentUser() {
        try {
            const response = await fetch('/api/me');
            const data = await response.json();
            if (data.user) {
                localStorage.setItem('currentUser', JSON.stringify(data.user));
            } else {
                localStorage.removeItem('currentUser');
            }
            updateAuthUI();
        } catch (error) {
            console.error('Ошибка загрузки пользователя:', error);
            updateAuthUI();
        }
    }

    const headerHtml = `
<header class="header">
    <div class="header-container">
        <div class="header-top">
            <div class="logo-area">
                <div class="logo" onclick="window.location.href='/'">СОЗВЕЗДИЕ</div>
                <button class="menu-btn-black" id="menuToggleBtn" type="button"><img src="/images/icon-menu-crop.png?v=8" alt=""><span class="menu-btn-label">Меню</span></button>
            </div>
            <div class="search-wrapper">
                <input type="text" class="search-input" id="globalSearchInput" placeholder="Найти отряд" autocomplete="off">
                <div id="searchResultsDropdown" class="search-dropdown" style="display: none;"></div>
            </div>
            <div class="header-actions" id="headerActions">
                <button class="header-search-icon" type="button" aria-label="Поиск"><img src="/images/icon-search-crop.png?v=8" alt=""></button>
                <button class="pick-header-btn" id="pickHeaderBtn" type="button">Подобрать отряд</button>
                <div id="authButtons">
                    <button class="login-header-btn" id="loginHeaderBtn" type="button"><img src="/images/icon-login-crop.png?v=8" alt=""><span>войти</span></button>
                </div>
                <div id="userProfile" style="display: none;">
                    <span class="user-name" id="userNameDisplay"></span>
                </div>
            </div>
        </div>
        <div class="header-bottom">
            <div class="bottom-nav">
                <span data-page="about">О нас</span>
                <span data-page="squads">Отряды</span>
                <span data-page="create">Создавай</span>
                <span onclick="window.location.href='/about.html#contacts'">Контакты</span>
            </div>
        </div>
    </div>
</header>
<div class="mobile-menu-drop" id="mobileMenuDrop">
    <span data-mobile-pick>Подобрать отряд</span>
    <span data-page="about">О нас</span>
    <span data-page="squads">Отряды</span>
    <span data-page="create">Создавай</span>
    <span onclick="window.location.href='/about.html#contacts'">Контакты</span>
</div>`;
    const footerHtml = `
<footer class="site-footer">
    <button class="footer-pick-btn" id="footerPickBtn" type="button">Подобрать отряд</button>
    <div class="footer-inner">
        <div class="footer-main">
            <div class="footer-brand">
                <h4>СОЗВЕЗДИЕ</h4>
                <a href="/about.html">О нас</a>
                <a href="/about.html#contacts">Контакты</a>
            </div>
            <div class="footer-squads">
                <h4>Отряды</h4>
                <a href="/squad/apelsin">СПО "Апельсин"</a>
                <a href="/squad/yamaika">СПО "Ямайка"</a>
                <a href="/squad/prospekt">СПО "Проспект"</a>
                <a href="/squad/zhar-ptitsa">СПО "Жар-Птица"</a>
                <a href="/squad/shum">СПО "Шум"</a>
                <a href="/squad/krylya">СПО "Крылья"</a>
                <a href="/squad/vokrug-sveta">СОП "Вокруг Света"</a>
                <a href="/squad/femida">ТОП "Фемида"</a>
                <a href="/squad/klever">ТОП "Клевер"</a>
                <a href="/squad/everest">ТОП "Эверест"</a>
                <a href="/squad/kraski">ТОП "Краски"</a>
            </div>
            <div class="footer-social">
                <h4>Социальные сети</h4>
                <div class="footer-social-icons">
                    <a href="https://vk.com/shtab.sozvezdie" target="_blank" rel="noopener noreferrer" aria-label="VK"><i class="fab fa-vk"></i></a>
                    <a href="https://t.me/shtab_sozvezdie" target="_blank" rel="noopener noreferrer" aria-label="Telegram"><i class="fab fa-telegram-plane"></i></a>
                </div>
            </div>
            <div class="footer-cards">
                <div class="footer-card footer-survey-card">
                    <h4>Ответьте на несколько вопросов</h4>
                    <p>Предложим отряд по вашим интересам</p>
                    <button type="button" onclick="window.location.href='/test.html'">Начать опрос</button>
                </div>
                <div class="footer-card footer-contact-card">
                    <div class="footer-contact-images">
                        <img src="/images/footer-staff-logo.png" alt="Созвездие">
                        <img src="/images/footer-qr.png" alt="QR-код">
                    </div>
                    <p>По любым вопросам обращаться к командиру штаба - Пашкевичус Виктории</p>
                </div>
            </div>
        </div>
        <div class="footer-legal">
            <div>© Созвездие, 2009–2026</div>
            <a href="#">Политика обработки<br>персональных данных</a>
        </div>
    </div>
</footer>`;

    // Список отрядов для поиска
    const squadsList = [
        { name: "Апельсин", slug: "apelsin", type: "СПО" },
        { name: "Ямайка", slug: "yamaika", type: "СПО" },
        { name: "Проспект", slug: "prospekt", type: "СПО" },
        { name: "Жар-Птица", slug: "zhar-ptitsa", type: "СПО" },
        { name: "Шум", slug: "shum", type: "СПО" },
        { name: "Крылья", slug: "krylya", type: "СПО" },
        { name: "Вокруг Света", slug: "vokrug-sveta", type: "СОП" },
        { name: "Фемида", slug: "femida", type: "ТОП" },
        { name: "Клевер", slug: "klever", type: "ТОП" },
        { name: "Эверест", slug: "everest", type: "ТОП" },
        { name: "Краски", slug: "kraski", type: "ТОП" }
    ];

    function addSearchStyles() {
        if (document.getElementById('searchStyles')) return;

        const styles = document.createElement('style');
        styles.id = 'searchStyles';
        styles.textContent = `
            .search-wrapper { position: relative; }
            .search-dropdown {
                position: absolute;
                top: 100%;
                left: 0;
                right: 0;
                background: white;
                border: 1px solid #e0d9f0;
                border-radius: 12px;
                box-shadow: 0 8px 24px rgba(0,0,0,0.12);
                max-height: 320px;
                overflow-y: auto;
                z-index: 1001;
                margin-top: 4px;
            }
            .search-dropdown-item {
                padding: 12px 16px;
                cursor: pointer;
                border-bottom: 1px solid #f0f0f0;
            }
            .search-dropdown-item:last-child { border-bottom: none; }
            .search-dropdown-item:hover { background: #f5f5f5; }
            .search-dropdown-item .squad-name { font-weight: 700; color: #1f1a2e; }
            .search-dropdown-item .squad-type { font-size: 12px; color: #6b6b73; margin-left: 8px; }
            .search-dropdown-item .squad-slug { font-size: 11px; color: #999; display: block; margin-top: 4px; }
            .search-no-results { padding: 16px; text-align: center; color: #6b6b73; }
        `;
        document.head.appendChild(styles);
    }

    function initSearch() {
        const searchInput = document.getElementById('globalSearchInput');
        const dropdown = document.getElementById('searchResultsDropdown');
        if (!searchInput || !dropdown) return;

        function filterSquads(query) {
            const lowerQuery = query.toLowerCase().trim();
            if (!lowerQuery) return [];
            return squadsList.filter(squad =>
                squad.name.toLowerCase().includes(lowerQuery) ||
                squad.slug.toLowerCase().includes(lowerQuery)
            );
        }

        function renderDropdown(results, query) {
            if (!query.trim()) {
                dropdown.style.display = 'none';
                return;
            }
            if (results.length === 0) {
                dropdown.innerHTML = '<div class="search-no-results">Ничего не найдено 😔</div>';
                dropdown.style.display = 'block';
                return;
            }
            dropdown.innerHTML = results.map(squad => `
                <div class="search-dropdown-item" data-slug="${squad.slug}">
                    <span class="squad-name">${squad.name}</span>
                    <span class="squad-type">${squad.type}</span>
                    <span class="squad-slug">/${squad.slug}</span>
                </div>
            `).join('');
            dropdown.style.display = 'block';

            document.querySelectorAll('.search-dropdown-item').forEach(item => {
                item.addEventListener('click', () => {
                    window.location.href = `/squad/${item.dataset.slug}`;
                });
            });
        }

        let debounceTimer;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                renderDropdown(filterSquads(e.target.value), e.target.value);
            }, 200);
        });

        document.addEventListener('click', (e) => {
            if (!searchInput.contains(e.target) && !dropdown.contains(e.target)) {
                dropdown.style.display = 'none';
            }
        });
    }

    function initLayout() {
        if (document.body.dataset.commonLayoutApplied === 'true') return;
        document.body.dataset.commonLayoutApplied = 'true';

        addSearchStyles();

        // Удаляем старый хедер и футер
        const oldMobileMenu = document.getElementById('mobileMenuDrop');
        if (oldMobileMenu) oldMobileMenu.remove();

        const oldHeader = document.querySelector('header.header');
        if (oldHeader) {
            oldHeader.insertAdjacentHTML('beforebegin', headerHtml);
            oldHeader.remove();
        } else {
            document.body.insertAdjacentHTML('afterbegin', headerHtml);
        }

        const footers = Array.from(document.querySelectorAll('footer'));
        const visibleFooter = footers.find(f => !f.hidden) || footers[0];
        if (visibleFooter) {
            visibleFooter.insertAdjacentHTML('beforebegin', footerHtml);
            footers.forEach(f => f.remove());
        } else {
            document.body.insertAdjacentHTML('beforeend', footerHtml);
        }

        document.body.classList.add('common-layout-ready');

        // Инициализация
        initSearch();
        loadCurrentUser();

        // Кнопки
        document.getElementById('pickHeaderBtn')?.addEventListener('click', () => {
            window.location.href = '/test.html';
        });
        document.getElementById('footerPickBtn')?.addEventListener('click', () => {
            window.location.href = '/test.html';
        });
        document.querySelectorAll('[data-mobile-pick]').forEach((item) => {
            item.addEventListener('click', () => {
                window.location.href = '/test.html';
            });
        });
        document.getElementById('loginHeaderBtn')?.addEventListener('click', () => {
            window.location.href = '/register.html';
        });
        document.getElementById('userProfile')?.addEventListener('click', () => {
            window.location.href = '/profile_new.html';
        });

        // Мобильное меню
        const menuBtn = document.getElementById('menuToggleBtn');
        const mobileMenu = document.getElementById('mobileMenuDrop');
        menuBtn?.addEventListener('click', (e) => {
            e.stopPropagation();
            mobileMenu?.classList.toggle('open');
            document.body.classList.toggle('menu-open', mobileMenu?.classList.contains('open'));
        });

        document.addEventListener('click', (e) => {
            if (mobileMenu?.classList.contains('open') &&
                !mobileMenu.contains(e.target) &&
                !menuBtn?.contains(e.target)) {
                mobileMenu.classList.remove('open');
                document.body.classList.remove('menu-open');
            }
        });

        // Навигация
        const pageRoutes = {
            about: '/about.html',
            squads: '/#squadsGrid',
            create: '/create.html'
        };
        document.querySelectorAll('[data-page]').forEach((item) => {
            item.addEventListener('click', () => {
                document.getElementById('mobileMenuDrop')?.classList.remove('open');
                document.body.classList.remove('menu-open');
                const route = pageRoutes[item.dataset.page];
                if (route) window.location.href = route;
            });
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initLayout);
    } else {
        initLayout();
    }
})();




