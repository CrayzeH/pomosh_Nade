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
                <span data-page="contacts">Контакты</span>
            </div>
        </div>
    </div>
</header>
<div class="mobile-search-panel" id="mobileSearchPanel" aria-hidden="true">
    <div class="mobile-search-inner">
        <input type="text" class="mobile-search-input" id="mobileGlobalSearchInput" placeholder="Найти отряд" autocomplete="off">
        <button class="mobile-search-close" id="mobileSearchClose" type="button" aria-label="Закрыть поиск">&times;</button>
    </div>
    <div id="mobileSearchResultsDropdown" class="mobile-search-dropdown" style="display: none;"></div>
</div>
<div class="mobile-menu-drop" id="mobileMenuDrop">
    <span data-mobile-pick>Подобрать отряд</span>
    <span data-page="about">О нас</span>
    <span data-page="squads">Отряды</span>
    <span data-page="create">Создавай</span>
    <span data-page="contacts">Контакты</span>
</div>`;
    const footerHtml = `
<footer class="site-footer">
    <button class="footer-pick-btn" id="footerPickBtn" type="button">Подобрать отряд</button>
    <div class="footer-inner">
        <div class="footer-main">
            <div class="footer-brand">
                <h4>СОЗВЕЗДИЕ</h4>
                <a href="#footer" data-page="about">О нас</a>
                <a href="#footer" data-page="contacts">Контакты</a>
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
            .mobile-search-panel {
                display: none !important;
                position: fixed;
                top: 66px;
                left: 0;
                right: 0;
                z-index: 10000;
                background: #fff;
                border-bottom: 1px solid #ececf2;
                box-shadow: 0 10px 24px rgba(15, 10, 35, 0.12);
                padding: 10px 14px 12px;
                opacity: 0;
                visibility: hidden;
                pointer-events: none;
                box-sizing: border-box;
            }
            .mobile-search-panel.open,
            body.mobile-search-open .mobile-search-panel {
                display: block !important;
                opacity: 1 !important;
                visibility: visible !important;
                pointer-events: auto !important;
            }
            .mobile-search-inner {
                display: flex;
                align-items: center;
                gap: 8px;
                width: 100%;
            }
            .mobile-search-input {
                flex: 1;
                min-width: 0;
                width: 100%;
                height: 42px;
                padding: 0 16px;
                border: 1.5px solid #e0d9f0;
                border-radius: 999px;
                background: #fff;
                color: #1f1a2e;
                font-family: Inter, sans-serif;
                font-size: 16px;
                outline: none;
                box-sizing: border-box;
            }
            .mobile-search-close {
                width: 42px;
                height: 42px;
                border: 0;
                border-radius: 50%;
                background: #1f1a2e;
                color: #fff;
                font-size: 26px;
                line-height: 1;
                cursor: pointer;
            }
            .mobile-search-dropdown {
                position: static;
                margin-top: 8px;
                background: #fff;
                border: 1px solid #e0d9f0;
                border-radius: 12px;
                box-shadow: none;
                max-height: min(52vh, 320px);
                overflow-y: auto;
            }
            @media (max-width: 420px) {
                .mobile-search-panel {
                    top: 64px;
                    padding: 10px 12px 12px;
                }
                .header .header-search-icon.is-search-open {
                    background: #1f1a2e !important;
                    border-radius: 999px !important;
                    color: #fff !important;
                }
                .header .header-search-icon.is-search-open img {
                    display: none !important;
                }
                .header .header-search-icon.is-search-open::before {
                    content: "×";
                    display: block;
                    color: #fff;
                    font-size: 28px;
                    line-height: 1;
                    font-weight: 500;
                }
            }
            @media (min-width: 901px) {
                .mobile-search-panel { display: none !important; }
            }
        `;
        document.head.appendChild(styles);
    }

    function addHeaderStyles() {
        if (document.getElementById('commonHeaderFinalStyles')) return;

        const styles = document.createElement('style');
        styles.id = 'commonHeaderFinalStyles';
        styles.textContent = `
            @media (max-width: 900px) {
                body { padding-top: 66px !important; }
                .header .header-container {
                    width: 100% !important;
                    max-width: none !important;
                    padding: 0 14px !important;
                    box-sizing: border-box !important;
                }
                .header .header-top {
                    min-height: 64px !important;
                    padding: 8px 0 !important;
                    gap: 8px !important;
                    display: flex !important;
                    flex-wrap: nowrap !important;
                    align-items: center !important;
                    justify-content: space-between !important;
                }
                .header .logo-area { display: contents !important; }
                .header .logo {
                    order: 1 !important;
                    flex: 1 1 auto !important;
                    min-width: 0 !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    transform: none !important;
                    font-size: clamp(20px, 5.7vw, 28px) !important;
                    line-height: 1 !important;
                    white-space: nowrap !important;
                    overflow: visible !important;
                    text-overflow: clip !important;
                }
                .header .search-wrapper,
                .header .pick-header-btn,
                .header .header-bottom { display: none !important; }
                .header .header-actions {
                    order: 2 !important;
                    gap: 7px !important;
                    flex: 0 0 auto !important;
                    min-width: 0 !important;
                }
                .header .header-search-icon {
                    display: inline-flex !important;
                    width: 36px !important;
                    height: 36px !important;
                    flex: 0 0 36px !important;
                }
                .header .header-search-icon img {
                    width: 26px !important;
                    height: 26px !important;
                }
                .header .menu-btn-black {
                    order: 3 !important;
                    width: 52px !important;
                    height: 40px !important;
                    min-width: 52px !important;
                    min-height: 40px !important;
                    padding: 0 !important;
                    border-radius: 999px !important;
                    gap: 0 !important;
                    flex: 0 0 52px !important;
                }
                .header .menu-btn-black img {
                    width: 26px !important;
                    height: 26px !important;
                }
                .header .menu-btn-label,
                .header .login-header-btn span { display: none !important; }
                .mobile-menu-drop { top: 66px !important; }
            }
            @media (max-width: 420px) {
                body { padding-top: 64px !important; }
                .header .header-container {
                    width: 100% !important;
                    max-width: none !important;
                    padding: 0 12px !important;
                    margin: 0 !important;
                    box-sizing: border-box !important;
                }
                .header {
                    left: 0 !important;
                    right: 0 !important;
                    width: 100% !important;
                    max-width: 100vw !important;
                    transform: none !important;
                }
                .header .header-top {
                    min-height: 64px !important;
                    padding: 8px 0 !important;
                    display: flex !important;
                    align-items: center !important;
                    justify-content: flex-start !important;
                    gap: 8px !important;
                    flex-wrap: nowrap !important;
                }
                .header .logo-area { display: contents !important; }
                .header .logo {
                    order: 1 !important;
                    flex: 0 1 auto !important;
                    width: auto !important;
                    min-width: 0 !important;
                    max-width: calc(100vw - 174px) !important;
                    margin: 0 !important;
                    padding: 0 !important;
                    position: static !important;
                    left: auto !important;
                    right: auto !important;
                    transform: none !important;
                    translate: none !important;
                    font-size: clamp(18px, 5.4vw, 23px) !important;
                    line-height: 1 !important;
                    white-space: nowrap !important;
                    overflow: hidden !important;
                    text-overflow: clip !important;
                }
                .header .search-wrapper,
                .header .pick-header-btn,
                .header .header-bottom { display: none !important; }
                .header .header-actions {
                    order: 2 !important;
                    flex: 0 0 auto !important;
                    margin-left: auto !important;
                    gap: 6px !important;
                    min-width: 0 !important;
                }
                .header .header-search-icon {
                    display: inline-flex !important;
                    width: 34px !important;
                    height: 34px !important;
                    padding: 0 !important;
                    flex: 0 0 34px !important;
                }
                .header .header-search-icon img {
                    width: 25px !important;
                    height: 25px !important;
                }
                .header .login-header-btn {
                    width: 30px !important;
                    min-width: 30px !important;
                    min-height: 0 !important;
                    padding: 0 !important;
                    border: 0 !important;
                    background: transparent !important;
                }
                .header .login-header-btn img {
                    width: 30px !important;
                    height: 30px !important;
                }
                .header .menu-btn-black {
                    order: 3 !important;
                    width: 48px !important;
                    height: 40px !important;
                    min-width: 48px !important;
                    max-width: 48px !important;
                    min-height: 40px !important;
                    padding: 0 !important;
                    border-radius: 999px !important;
                    gap: 0 !important;
                    flex-basis: 48px !important;
                }
                .header .menu-btn-black img {
                    width: 26px !important;
                    height: 26px !important;
                }
                .header .menu-btn-label,
                .header .login-header-btn span { display: none !important; }
                .mobile-menu-drop { top: 64px !important; }
            }
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

    function initMobileSearch() {
        const searchButton = document.querySelector('.header-search-icon');
        const panel = document.getElementById('mobileSearchPanel');
        const input = document.getElementById('mobileGlobalSearchInput');
        const dropdown = document.getElementById('mobileSearchResultsDropdown');
        const closeButton = document.getElementById('mobileSearchClose');
        if (!searchButton || !panel || !input || !dropdown) return;

        function filterSquads(query) {
            const lowerQuery = query.toLowerCase().trim();
            if (!lowerQuery) return [];
            return squadsList.filter(squad =>
                squad.name.toLowerCase().includes(lowerQuery) ||
                squad.slug.toLowerCase().includes(lowerQuery)
            );
        }

        function renderResults(results, query) {
            if (!query.trim()) {
                dropdown.style.display = 'none';
                return;
            }
            if (!results.length) {
                dropdown.innerHTML = '<div class="search-no-results">Ничего не найдено</div>';
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
            dropdown.querySelectorAll('.search-dropdown-item').forEach(item => {
                item.addEventListener('click', () => {
                    window.location.href = `/squad/${item.dataset.slug}`;
                });
            });
        }

        function closeSearch() {
            panel.classList.remove('open');
            document.body.classList.remove('mobile-search-open');
            searchButton.classList.remove('is-search-open');
            searchButton.setAttribute('aria-expanded', 'false');
            panel.setAttribute('aria-hidden', 'true');
            dropdown.style.display = 'none';
        }

        function openSearch() {
            document.getElementById('mobileMenuDrop')?.classList.remove('open');
            document.body.classList.remove('menu-open');
            panel.classList.add('open');
            document.body.classList.add('mobile-search-open');
            searchButton.classList.add('is-search-open');
            searchButton.setAttribute('aria-expanded', 'true');
            panel.setAttribute('aria-hidden', 'false');
            setTimeout(() => input.focus(), 0);
            renderResults(filterSquads(input.value), input.value);
        }

        let debounceTimer;
        input.addEventListener('input', () => {
            clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
                renderResults(filterSquads(input.value), input.value);
            }, 180);
        });

        input.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            const firstResult = filterSquads(input.value)[0];
            if (firstResult) window.location.href = `/squad/${firstResult.slug}`;
        });

        searchButton.addEventListener('click', (event) => {
            if (!window.matchMedia('(max-width: 900px)').matches) return;
            event.preventDefault();
            event.stopPropagation();
            if (panel.classList.contains('open')) {
                closeSearch();
            } else {
                openSearch();
            }
        });

        closeButton?.addEventListener('click', closeSearch);

        window.matchMedia('(min-width: 901px)').addEventListener('change', (event) => {
            if (event.matches) closeSearch();
        });

        document.addEventListener('click', (event) => {
            if (!panel.classList.contains('open')) return;
            if (panel.contains(event.target) || searchButton.contains(event.target)) return;
            closeSearch();
        });
    }

    function initLayout() {
        if (document.body.dataset.commonLayoutApplied === 'true') return;
        document.body.dataset.commonLayoutApplied = 'true';

        addSearchStyles();
        addHeaderStyles();

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
        initMobileSearch();
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
            window.location.href = '/login_new.html';
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
        const scrollToHomeAbout = () => {
            const aboutSection = document.getElementById('home-about-section');
            if (aboutSection) {
                aboutSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                return;
            }
            window.location.href = '/#home-about-section';
        };
        const scrollToFooter = () => {
            const footer = document.querySelector('.site-footer') || document.querySelector('footer');
            if (footer) footer.scrollIntoView({ behavior: 'smooth' });
        };
        const pageRoutes = {
            create: '/create.html'
        };
        document.querySelectorAll('[data-page]').forEach((item) => {
            item.addEventListener('click', (event) => {
                document.getElementById('mobileMenuDrop')?.classList.remove('open');
                document.body.classList.remove('menu-open');
                if (item.dataset.page === 'about') {
                    event.preventDefault();
                    scrollToHomeAbout();
                    return;
                }
                if (item.dataset.page === 'contacts' || item.dataset.page === 'squads') {
                    event.preventDefault();
                    scrollToFooter();
                    return;
                }
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




