const DataLoader = {
    packs: [],
    events: [],
    cache: {}, // Cache for level units: { "packId": ["word1", ...] }
    error: null,

    async init() {
        try {
            const [packsRes, eventsRes] = await Promise.all([
                fetch('data/allLevelDetails_v1.json'),
                fetch('data/event_allLevelDetails_v1.json')
            ]);

            if (!packsRes.ok || !eventsRes.ok) {
                throw new Error(`HTTP error! status: ${packsRes.status} / ${eventsRes.status}`);
            }

            this.packs = await packsRes.json();
            this.events = await eventsRes.json();

            // Normalize IDs for easier lookup
            this.packs.forEach((p, i) => {
                if (!p.id) p.id = p.name; // Fallback if ID missing, though name seems unique
                p.type = 'pack';
            });
            this.events.forEach((e, i) => {
                if (!e.id) e.id = e.name;
                e.type = 'event';
            });

            console.log("Data loaded:", this.packs, this.events);
        } catch (e) {
            console.error("Failed to load game data:", e);
            this.error = e.message;
        }
    },

    getPack(id) {
        return this.packs.find(p => p.name === id) || this.events.find(e => e.name === id);
    },

    async getLevelWords(packId) {
        if (this.cache[packId]) return this.cache[packId];

        const pack = this.getPack(packId);
        if (!pack) return [];

        let url = '';
        if (pack.type === 'event') {
            url = `data/Events/${pack.name}/units.json`;
        } else {
            url = `data/${pack.name}/units.json`;
        }

        try {
            const res = await fetch(url);
            const words = await res.json();
            this.cache[packId] = words;
            return words;
        } catch (e) {
            console.error(`Failed to load levels for ${packId}:`, e);
            return [];
        }
    }
};

// --- State Management ---
const State = {
    coins: 100,
    stars: 0,
    unlocked: {}, // { packId: maxLevelIndex }
    completed: {}, // { packId: { levelIndex: true } }

    async init() {
        // Load from LocalStorage
        const savedCoins = localStorage.getItem('bollywood_coins');
        if (savedCoins) this.coins = parseInt(savedCoins);

        const savedStars = localStorage.getItem('bollywood_stars');
        if (savedStars) this.stars = parseInt(savedStars);

        const savedUnlocked = localStorage.getItem('bollywood_unlocked');
        if (savedUnlocked) this.unlocked = JSON.parse(savedUnlocked);

        const savedCompleted = localStorage.getItem('bollywood_completed');
        if (savedCompleted) this.completed = JSON.parse(savedCompleted);

        // Ensure data is loaded
        await DataLoader.init();

        // Initialize defaults if new packs added
        [...DataLoader.packs, ...DataLoader.events].forEach(pack => {
            if (!this.unlocked[pack.id]) {
                this.unlocked[pack.id] = 0; // Start at level 0 (first level)
            }
            if (!this.completed[pack.id]) {
                this.completed[pack.id] = {};
            }
        });

        this.updateUI();
    },

    isLevelUnlocked(packId, levelIndex) {
        return this.unlocked[packId] >= levelIndex;
    },

    isPackUnlocked(packId) {
        const pack = DataLoader.getPack(packId);
        if (!pack) return false;
        // If pack has a star requirement, check if user has enough stars
        if (pack.star !== null && pack.star !== undefined && pack.star > 0) {
            return this.stars >= pack.star;
        }
        return true;
    },

    completeLevel(packId, levelIndex) {
        // Mark current level as completed
        if (!this.completed[packId]) this.completed[packId] = {};

        // Check if this is the first time completing this level to award stars
        const isFirstCompletion = !this.completed[packId][levelIndex];

        this.completed[packId][levelIndex] = true;

        // Unlock next level
        if (this.unlocked[packId] === levelIndex) {
            this.unlocked[packId] = levelIndex + 1;
        }

        // Award Star if applicable and first completion
        if (isFirstCompletion) {
            const pack = DataLoader.getPack(packId);
            if (pack && pack.is_star) {
                this.stars++;
                this.save();
                this.updateUI();
            }
        }

        this.save();
    },

    deductCoins(amount) {
        if (this.coins >= amount) {
            this.coins -= amount;
            this.save();
            this.updateUI();
            return true;
        }
        return false;
    },

    addCoins(amount) {
        this.coins += amount;
        this.save();
        this.updateUI();
    },

    save() {
        localStorage.setItem('bollywood_coins', this.coins);
        localStorage.setItem('bollywood_stars', this.stars);
        localStorage.setItem('bollywood_unlocked', JSON.stringify(this.unlocked));
        localStorage.setItem('bollywood_completed', JSON.stringify(this.completed));
    },

    updateUI() {
        const coinEl = document.getElementById('coin-display');
        if (coinEl) coinEl.textContent = this.coins;

        const starEl = document.getElementById('star-display');
        if (starEl) starEl.textContent = this.stars;
    }
};

// --- Input Management ---
const Input = {
    init() {
        window.addEventListener('keydown', (e) => {
            // Global Dialog Handling
            const modal = document.getElementById('completion-modal');
            const answerDialog = document.getElementById('answer-dialog');

            if (modal && modal.style.opacity === '1') {
                if (e.key === 'Enter' || e.key === 'Escape') {
                    e.preventDefault();
                    document.getElementById('modal-continue').click();
                }
                return; // Block other input when modal is open
            }

            if (answerDialog && answerDialog.style.opacity === '1') {
                if (e.key === 'Enter' || e.key === 'Escape') {
                    e.preventDefault();
                    document.getElementById('close-answer-dialog').click();
                }
                return;
            }

            // Route to current view based on DOM elements
            if (document.getElementById('packs-list')) {
                Home.handleInput(e);
            } else if (document.getElementById('levels-grid')) {
                Album.handleInput(e);
            } else if (document.getElementById('word-display')) {
                Game.handleInput(e);
            }
        });
    }
};

// --- Navigation & View Management ---
// --- Navigation & View Management ---
// Router removed in favor of multi-page navigation

// --- Home View Logic ---
const Home = {
    selectedIndex: 0,
    items: [],
    currentTab: 'packs', // 'packs' or 'events'

    init() {
        this.selectedIndex = 0;
        this.currentTab = 'packs';
        this.render();
    },

    render() {
        const list = document.getElementById('packs-list');
        list.innerHTML = ''; // Clear previous items
        this.items = [];

        // Setup Tabs
        this.setupTabs();

        if (DataLoader.error) {
            list.innerHTML = `
                <div class="col-span-full text-center text-red-400 p-8">
                    <p class="text-xl font-bold mb-2">Failed to load game data</p>
                    <p class="text-sm opacity-75">${DataLoader.error}</p>
                    <p class="text-xs mt-4 opacity-50">Make sure you are running this on a local server (e.g., Live Server).</p>
                </div>
            `;
            return;
        }

        // Render Content based on Tab
        const data = this.currentTab === 'packs' ? DataLoader.packs : DataLoader.events;
        this.renderItems(data);

        // Initial focus
        this.updateFocus();
    },

    setupTabs() {
        const tabPacks = document.getElementById('tab-packs');
        const tabEvents = document.getElementById('tab-events');

        if (!tabPacks || !tabEvents) return;

        // Reset Styles
        const activeClass = ['text-cinema-black', 'bg-cinema-gold', 'shadow-lg', 'scale-105'];
        const inactiveClass = ['text-white/60', 'hover:text-white', 'bg-white/5', 'hover:bg-white/10'];

        if (this.currentTab === 'packs') {
            tabPacks.classList.add(...activeClass);
            tabPacks.classList.remove(...inactiveClass);
            tabEvents.classList.add(...inactiveClass);
            tabEvents.classList.remove(...activeClass);
        } else {
            tabEvents.classList.add(...activeClass);
            tabEvents.classList.remove(...inactiveClass);
            tabPacks.classList.add(...inactiveClass);
            tabPacks.classList.remove(...activeClass);
        }

        tabPacks.onclick = () => {
            if (this.currentTab !== 'packs') {
                this.currentTab = 'packs';
                this.render();
            }
        };

        tabEvents.onclick = () => {
            if (this.currentTab !== 'events') {
                this.currentTab = 'events';
                this.render();
            }
        };
    },

    renderItems(data) {
        const list = document.getElementById('packs-list');
        list.innerHTML = '';

        data.forEach((pack, index) => {
            const el = document.createElement('div');

            const isUnlocked = State.isPackUnlocked(pack.id);
            const isStarPack = pack.is_star;

            el.className = `bg-cinema-dark border border-white/10 rounded-xl p-4 flex items-center gap-4 hover:bg-white/5 transition-colors cursor-pointer group relative overflow-hidden ${!isUnlocked ? 'opacity-75' : ''}`;

            // Lock Overlay
            let lockOverlay = '';
            if (!isUnlocked) {
                lockOverlay = `
                    <div class="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex flex-col items-center justify-center z-10">
                        <div class="text-2xl mb-1">🔒</div>
                        <div class="text-xs font-bold text-cinema-gold uppercase tracking-wider">Requires ${pack.star} Stars</div>
                    </div>
                `;
            }

            // Star Badge
            let starBadge = '';
            if (isStarPack) {
                starBadge = `
                    <div class="absolute top-2 right-2 text-[10px] bg-cinema-gold text-cinema-black px-2 py-0.5 rounded-full font-bold shadow-sm z-20">
                        ⭐ Earn Stars
                    </div>
                `;
            }

            // Cover Image Path
            const coverIndex = (pack.cover !== undefined) ? pack.cover : 0;
            const imgPath = pack.type === 'event'
                ? `data/Events/${pack.name}/img/${coverIndex + 1}.webp`
                : `data/${pack.name}/img/${coverIndex + 1}.webp`;

            el.innerHTML = `
                ${lockOverlay}
                ${starBadge}
                <div class="w-16 h-16 rounded-lg bg-white/5 border border-white/10 overflow-hidden shrink-0 group-hover:scale-105 transition-transform duration-300 shadow-inner">
                    <img src="${imgPath}" alt="${pack.name}" class="w-full h-full object-cover" loading="lazy">
                </div>
                <div class="flex-1 min-w-0">
                    <h3 class="font-bold text-lg truncate group-hover:text-cinema-gold transition-colors">${pack.name}</h3>
                    <p class="text-xs text-white/40 truncate">${pack.lvls} Levels • ${pack.description || 'Guess the movie!'}</p>
                    
                    <!-- Progress Bar -->
                    <div class="mt-3 h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                        <div class="h-full bg-gradient-to-r from-cinema-gold to-yellow-600 w-[${(State.unlocked[pack.id] / pack.lvls) * 100}%]"></div>
                    </div>
                </div>
                <div class="text-white/20 group-hover:translate-x-1 transition-transform shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                    </svg>
                </div>
            `;

            if (isUnlocked) {
                el.onclick = () => window.location.href = `levels.html?id=${pack.id}`;
            } else {
                el.onclick = () => {
                    // Shake animation or toast could be added here
                    el.classList.add('animate-pulse');
                    setTimeout(() => el.classList.remove('animate-pulse'), 500);
                };
            }

            list.appendChild(el);
            this.items.push(el);
        });
    },
    updateFocus() {
        this.items.forEach((el, idx) => {
            if (idx === this.selectedIndex) {
                el.classList.add('bg-white/10', 'ring-2', 'ring-cinema-gold');
                el.focus();
            } else {
                el.classList.remove('bg-white/10', 'ring-2', 'ring-cinema-gold');
            }
        });
    },



    handleInput(e) {
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
            this.selectedIndex = (this.selectedIndex + 1) % this.items.length;
            this.updateFocus();
            e.preventDefault();
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
            this.selectedIndex = (this.selectedIndex - 1 + this.items.length) % this.items.length;
            this.updateFocus();
            e.preventDefault();
        } else if (e.key === 'Enter') {
            this.items[this.selectedIndex].click();
            e.preventDefault();
        }
    }
};

// --- Album View Logic ---
const Album = {
    packId: null,
    selectedIndex: 0,
    items: [],

    async init() {
        const params = new URLSearchParams(window.location.search);
        const packId = params.get('id');

        if (!packId) {
            window.location.href = 'index.html';
            return;
        }

        this.packId = packId;
        this.selectedIndex = 0; // Or find first unlocked/uncompleted?

        const pack = DataLoader.getPack(packId);
        if (!pack) {
            // Data might not be loaded yet if init called too early, but we await DataLoader.init()
            window.location.href = 'index.html';
            return;
        }

        // Security Check: Pack Lock
        if (!State.isPackUnlocked(packId)) {
            window.location.href = 'index.html';
            return;
        }

        document.getElementById('album-title').innerHTML = `
            ${pack.name} 
            ${pack.is_star ? '<span class="ml-2 text-sm bg-cinema-gold text-cinema-black px-2 py-0.5 rounded-full align-middle">⭐ Earn Stars</span>' : ''}
        `;

        const grid = document.getElementById('levels-grid');
        grid.innerHTML = '';
        this.items = [];

        // We need to know how many levels. 
        // Since we don't have the full level list loaded here (it's in units.json), 
        // we rely on pack.lvls metadata.
        for (let i = 0; i < pack.lvls; i++) {
            const el = document.createElement('div');
            const isUnlocked = State.isLevelUnlocked(packId, i);
            const isCompleted = State.completed[packId] && State.completed[packId][i];

            // Image Path
            const imgPath = pack.type === 'event'
                ? `data/Events/${pack.name}/img/${i + 1}.webp`
                : `data/${pack.name}/img/${i + 1}.webp`;

            el.className = `aspect-[2/3] rounded-xl relative overflow-hidden group transition-all duration-300 border border-white/10 ${isUnlocked ? 'cursor-pointer hover:scale-105 hover:shadow-xl hover:shadow-black/50 hover:border-cinema-gold/50' : 'opacity-50 grayscale cursor-not-allowed'}`;

            let overlay = '';
            if (isCompleted) {
                overlay = `
                    <div class="absolute inset-0 bg-green-500/20 backdrop-blur-[1px] flex items-center justify-center border-2 border-green-500/50 rounded-xl">
                        <div class="bg-green-500 text-white rounded-full p-1 shadow-lg">
                            <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
                                <path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd" />
                            </svg>
                        </div>
                    </div>
                `;
            } else if (!isUnlocked) {
                overlay = `
                    <div class="absolute inset-0 bg-black/60 flex items-center justify-center">
                        <span class="text-2xl">🔒</span>
                    </div>
                `;
            }

            el.innerHTML = `
                <img src="${imgPath}" class="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" loading="lazy" alt="Level ${i + 1}">
                <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent">
                    <div class="absolute bottom-2 left-0 right-0 text-center">
                        <span class="text-lg font-bold text-white drop-shadow-md font-mono">${i + 1}</span>
                    </div>
                </div>
                ${overlay}
            `;

            if (isUnlocked) {
                el.onclick = () => {
                    if (isCompleted) {
                        this.showAnswerDialog(packId, i);
                    } else {
                        window.location.href = `game.html?id=${packId}&level=${i}`;
                    }
                };
            }

            grid.appendChild(el);
            this.items.push(el);
        }

        this.updateFocus();
    },

    updateFocus() {
        this.items.forEach((el, idx) => {
            if (idx === this.selectedIndex) {
                if (!el.classList.contains('locked')) {
                    el.classList.add('ring-2', 'ring-cinema-gold', 'bg-white/10');
                    el.focus();
                }
            } else {
                el.classList.remove('ring-2', 'ring-cinema-gold', 'bg-white/10');
            }
        });
    },

    async showAnswerDialog(packId, levelIndex) {
        const dialog = document.getElementById('answer-dialog');
        const img = document.getElementById('answer-image');
        const text = document.getElementById('answer-text');

        if (!dialog || !img || !text) return;

        // Load data if needed (might not be loaded if we came straight here, though unlikely)
        const words = await DataLoader.getLevelWords(packId);
        const word = words[levelIndex];
        const pack = DataLoader.getPack(packId);

        // Image path
        let imgPath = '';
        if (pack.type === 'event') {
            imgPath = `data/Events/${pack.name}/img/${levelIndex + 1}.webp`;
        } else {
            imgPath = `data/${pack.name}/img/${levelIndex + 1}.webp`;
        }

        img.src = imgPath;
        text.textContent = word;

        dialog.style.opacity = '1';
        dialog.style.pointerEvents = 'auto';
        dialog.classList.remove('pointer-events-none');
    },

    handleInput(e) {
        const cols = window.innerWidth >= 1024 ? 8 : (window.innerWidth >= 768 ? 6 : 4); // Approximate cols based on CSS

        if (e.key === 'ArrowRight') {
            let next = this.selectedIndex + 1;
            while (next < this.items.length && this.items[next].classList.contains('locked')) next++;
            if (next < this.items.length) {
                this.selectedIndex = next;
                this.updateFocus();
            }
            e.preventDefault();
        } else if (e.key === 'ArrowLeft') {
            let prev = this.selectedIndex - 1;
            while (prev >= 0 && this.items[prev].classList.contains('locked')) prev--;
            if (prev >= 0) {
                this.selectedIndex = prev;
                this.updateFocus();
            }
            e.preventDefault();
        } else if (e.key === 'ArrowDown') {
            let next = this.selectedIndex + cols;
            if (next < this.items.length && !this.items[next].classList.contains('locked')) {
                this.selectedIndex = next;
                this.updateFocus();
            }
            e.preventDefault();
        } else if (e.key === 'ArrowUp') {
            let prev = this.selectedIndex - cols;
            if (prev >= 0 && !this.items[prev].classList.contains('locked')) {
                this.selectedIndex = prev;
                this.updateFocus();
            }
            e.preventDefault();
        } else if (e.key === 'Enter') {
            if (!this.items[this.selectedIndex].classList.contains('locked')) {
                this.items[this.selectedIndex].click();
            }
            e.preventDefault();
        } else if (e.key === 'Escape') {
            window.location.href = 'index.html';
            e.preventDefault();
        }
    }
};

// --- Game Logic ---
const Game = {
    currentPackId: null,
    currentLevelIndex: null,
    targetWord: "",
    scrambledLetters: [],
    selectedIndices: [], // Array of size targetWord.length, containing scrambledIndex or null

    async init() {
        const params = new URLSearchParams(window.location.search);
        const packId = params.get('id');
        const levelIndex = parseInt(params.get('level'));

        if (!packId || isNaN(levelIndex)) {
            window.location.href = 'index.html';
            return;
        }

        // Security Check: Prevent access to locked levels
        if (!State.isLevelUnlocked(packId, levelIndex)) {
            window.location.href = `levels.html?id=${packId}`;
            return;
        }

        // Security Check: Prevent access to locked packs
        if (!State.isPackUnlocked(packId)) {
            window.location.href = 'index.html';
            return;
        }

        // Replay Restriction: Prevent playing completed levels
        if (State.completed[packId] && State.completed[packId][levelIndex]) {
            // Redirect to levels page where they can see the answer dialog
            window.location.href = `levels.html?id=${packId}`;
            return;
        }

        this.currentPackId = packId;
        this.currentLevelIndex = levelIndex;

        // Show loading state
        document.getElementById('word-display').innerHTML = '<div class="text-white/50">Loading...</div>';

        const words = await DataLoader.getLevelWords(packId);
        if (!words || !words[levelIndex]) {
            alert("Error loading level data!");
            window.location.href = `levels.html?id=${packId}`;
            return;
        }

        const rawWord = words[levelIndex];
        this.currentRawWord = rawWord;
        // Clean word: remove spaces, uppercase
        this.targetWord = rawWord.replace(/\s+/g, '').toUpperCase();

        // Setup UI
        document.getElementById('current-level-num').textContent = levelIndex + 1;
        document.getElementById('back-to-album').onclick = () => window.location.href = `levels.html?id=${packId}`;

        // Image Loading
        const pack = DataLoader.getPack(packId);
        let imgPath = '';
        if (pack.type === 'event') {
            imgPath = `data/Events/${pack.name}/img/${levelIndex + 1}.webp`;
        } else {
            imgPath = `data/${pack.name}/img/${levelIndex + 1}.webp`;
        }
        const imgEl = document.getElementById('level-image');
        imgEl.src = imgPath;
        imgEl.onerror = () => {
            // Fallback if image missing
            imgEl.src = 'https://via.placeholder.com/400x600/0a0a0a/333333?text=No+Image';
        };

        // Full Screen Image Click
        imgEl.parentElement.onclick = () => this.toggleFullScreenImage(true, imgPath);

        // Setup Full Screen Overlay Click
        const fsOverlay = document.getElementById('fullscreen-image-overlay');
        if (fsOverlay) {
            fsOverlay.onclick = (e) => {
                if (e.target !== document.getElementById('fullscreen-image')) {
                    this.toggleFullScreenImage(false);
                }
            };
            // Also close when clicking the image itself in full screen (common UX)
            document.getElementById('fullscreen-image').onclick = () => this.toggleFullScreenImage(false);
        }

        // Buttons
        document.getElementById('btn-delete').onclick = () => this.reset();
        document.getElementById('btn-hint').onclick = () => this.useHint();
        document.getElementById('btn-skip').onclick = () => this.skipLevel();

        this.reset();

        // Onboarding Logic
        const onboardingMsg = document.getElementById('onboarding-msg');
        const closeOnboarding = document.getElementById('close-onboarding');
        const hasSeenOnboarding = localStorage.getItem('bollywood_onboarding_seen');

        if (!hasSeenOnboarding && onboardingMsg) {
            // Show only on desktop/large screens where keyboard is relevant
            if (window.innerWidth >= 768) {
                onboardingMsg.classList.remove('hidden');

                if (closeOnboarding) {
                    closeOnboarding.onclick = () => {
                        onboardingMsg.classList.add('hidden');
                        localStorage.setItem('bollywood_onboarding_seen', 'true');
                    };
                }
            }
        }
    },

    handleInput(e) {
        const key = e.key.toUpperCase();

        // Check for Full Screen Overlay
        const fsOverlay = document.getElementById('fullscreen-image-overlay');
        const isOverlayOpen = fsOverlay && !fsOverlay.classList.contains('pointer-events-none');

        if (isOverlayOpen) {
            if (key === 'ESCAPE' || key === 'ENTER' || e.code === 'Space') {
                this.toggleFullScreenImage(false);
                e.preventDefault();
            }
            return; // Block other input
        }

        e.preventDefault(); // Prevent default browser actions for handled keys

        if (key === 'ESCAPE') {
            window.location.href = `levels.html?id=${this.currentPackId}`;
            return;
        }

        if (e.code === 'Space') {
            const imgEl = document.getElementById('level-image');
            if (imgEl) {
                this.toggleFullScreenImage(true, imgEl.src);
            }
            return;
        }

        if (key === 'BACKSPACE') {
            // Remove last FILLED slot
            // Find the last non-null index
            let lastFilled = -1;
            for (let i = this.selectedIndices.length - 1; i >= 0; i--) {
                if (this.selectedIndices[i] !== null) {
                    lastFilled = i;
                    break;
                }
            }

            if (lastFilled !== -1) {
                this.deselectLetter(lastFilled);
            }
            return;
        }

        // Shortcuts with Arrow Keys
        if (e.key === 'ArrowUp') {
            this.useHint();
            return;
        }
        if (e.key === 'ArrowDown') {
            this.reset();
            return;
        }
        if (e.key === 'ArrowRight') {
            this.skipLevel();
            return;
        }

        // Check if key matches any available letter in scrambledLetters
        // We need to find a letter that matches `key` and is NOT selected.
        // Prioritize: just pick the first available one.

        let foundIdx = -1;
        for (let i = 0; i < this.scrambledLetters.length; i++) {
            if (this.scrambledLetters[i].char === key && !this.isScrambledIndexSelected(i)) {
                foundIdx = i;
                break;
            }
        }

        if (foundIdx !== -1) {
            this.selectLetter(foundIdx);
        }
    },

    isScrambledIndexSelected(scrambledIdx) {
        return this.selectedIndices.includes(scrambledIdx);
    },

    toggleFullScreenImage(show, imgSrc = '') {
        const overlay = document.getElementById('fullscreen-image-overlay');
        const fsImg = document.getElementById('fullscreen-image');

        if (!overlay || !fsImg) return;

        if (show) {
            fsImg.src = imgSrc;
            overlay.classList.remove('pointer-events-none', 'opacity-0');
            fsImg.classList.remove('scale-95');
            fsImg.classList.add('scale-100');
        } else {
            overlay.classList.add('opacity-0');
            fsImg.classList.remove('scale-100');
            fsImg.classList.add('scale-95');
            setTimeout(() => {
                overlay.classList.add('pointer-events-none');
            }, 300); // Match transition duration
        }
    },

    reset() {
        // Initialize with nulls
        this.selectedIndices = new Array(this.targetWord.length).fill(null);

        // Scramble letters
        const letters = this.targetWord.split('');
        // Fisher-Yates shuffle
        for (let i = letters.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [letters[i], letters[j]] = [letters[j], letters[i]];
        }
        this.scrambledLetters = letters.map((char, id) => ({ char, id: `l-${id}` })); // Add unique ID to handle duplicate letters

        this.render();
    },

    render() {
        const wordDisplay = document.getElementById('word-display');
        const keyboard = document.getElementById('keyboard');

        wordDisplay.innerHTML = '';
        keyboard.innerHTML = '';

        // Render Slots
        for (let i = 0; i < this.targetWord.length; i++) {
            const slot = document.createElement('div');
            const selectedIndex = this.selectedIndices[i];

            if (selectedIndex !== null) {
                const letterObj = this.scrambledLetters[selectedIndex];
                slot.className = 'letter-slot filled animate-pop';
                slot.textContent = letterObj.char;
                slot.onclick = () => this.deselectLetter(i);
            } else {
                slot.className = 'letter-slot';
                // Optional: make empty slots clickable to move cursor?
                // For now, just display.
            }
            wordDisplay.appendChild(slot);
        }

        // Render Keyboard
        this.scrambledLetters.forEach((letterObj, index) => {
            const isSelected = this.isScrambledIndexSelected(index);
            const tile = document.createElement('div');
            tile.className = `letter-tile ${isSelected ? 'selected' : ''}`;
            tile.textContent = letterObj.char;

            if (!isSelected) {
                tile.onclick = () => this.selectLetter(index);
            }

            keyboard.appendChild(tile);
        });
    },

    selectLetter(scrambledIndex) {
        // Find first empty slot
        const emptySlotIndex = this.selectedIndices.indexOf(null);

        if (emptySlotIndex !== -1) {
            this.selectedIndices[emptySlotIndex] = scrambledIndex;
            this.render();
            this.checkWin();
        }
    },

    deselectLetter(slotIndex) {
        this.selectedIndices[slotIndex] = null;
        this.render();
    },

    checkWin() {
        // Check if full
        if (this.selectedIndices.includes(null)) return;

        const currentWord = this.selectedIndices.map(idx => this.scrambledLetters[idx].char).join('');

        if (currentWord === this.targetWord) {
            setTimeout(() => {
                this.handleWin();
            }, 300);
        } else {
            // Shake animation for wrong answer
            const slots = document.getElementById('word-display');
            slots.classList.add('animate-shake');
            setTimeout(() => slots.classList.remove('animate-shake'), 500);
        }
    },

    handleWin() {
        State.completeLevel(this.currentPackId, this.currentLevelIndex);
        State.addCoins(10); // Reward
        this.showCompletionModal();
    },

    showCompletionModal() {
        const modal = document.getElementById('completion-modal');
        const content = document.getElementById('modal-content');
        const answerEl = document.getElementById('modal-answer');
        const continueBtn = document.getElementById('modal-continue');

        // Get original word with spaces if possible, but we stored rawWord in start() ?
        // We only stored targetWord (cleaned).
        // Let's fetch raw word again.
        // Get original word with spaces if possible
        answerEl.textContent = this.currentRawWord;

        modal.style.opacity = '1';
        modal.style.pointerEvents = 'auto';
        content.classList.remove('scale-95');
        content.classList.add('scale-100');

        continueBtn.onclick = () => {
            modal.style.opacity = '0';
            modal.style.pointerEvents = 'none';
            content.classList.remove('scale-100');
            content.classList.add('scale-95');

            this.nextLevel();
        };
    },

    nextLevel() {
        const pack = DataLoader.getPack(this.currentPackId);
        const maxLevel = pack.lvls;
        if (this.currentLevelIndex + 1 < maxLevel) {
            // Next level
            window.location.href = `game.html?id=${this.currentPackId}&level=${this.currentLevelIndex + 1}`;
        } else {
            window.location.href = `levels.html?id=${this.currentPackId}`;
        }
    },

    useHint() {
        if (State.deductCoins(20)) {
            // Find the first slot that is either empty or wrong
            let slotToFix = -1;

            for (let i = 0; i < this.targetWord.length; i++) {
                const correctChar = this.targetWord[i];
                const selectedIdx = this.selectedIndices[i];

                if (selectedIdx === null) {
                    slotToFix = i;
                    break;
                }

                const currentLetter = this.scrambledLetters[selectedIdx].char;
                if (currentLetter !== correctChar) {
                    slotToFix = i;
                    break;
                }
            }

            if (slotToFix !== -1) {
                const correctChar = this.targetWord[slotToFix];

                // Find a scrambled index for this char
                // Prioritize one that is NOT selected
                let bestScrambledIdx = -1;
                let usedScrambledIdx = -1;

                for (let i = 0; i < this.scrambledLetters.length; i++) {
                    if (this.scrambledLetters[i].char === correctChar) {
                        if (!this.isScrambledIndexSelected(i)) {
                            bestScrambledIdx = i;
                            break; // Found a free one, perfect
                        } else {
                            usedScrambledIdx = i; // Keep as backup
                        }
                    }
                }

                const finalScrambledIdx = bestScrambledIdx !== -1 ? bestScrambledIdx : usedScrambledIdx;

                if (finalScrambledIdx !== -1) {
                    // If the letter was already used elsewhere, remove it from its old position
                    // Since we might have picked `usedScrambledIdx`, it means it's currently in `selectedIndices`.
                    // We need to set that slot to null.

                    const oldSlotIdx = this.selectedIndices.indexOf(finalScrambledIdx);
                    if (oldSlotIdx !== -1) {
                        this.selectedIndices[oldSlotIdx] = null;
                    }

                    // Now, we also need to clear whatever was at `slotToFix` (if anything)
                    // But wait, if we just overwrite `slotToFix`, the letter that was there (if any) becomes "deselected" automatically
                    // because `selectedIndices` is the only source of truth for "selected".
                    // So we don't need to do anything special to "return" the old letter to the keyboard.
                    // It just won't be in `selectedIndices` anymore.

                    this.selectedIndices[slotToFix] = finalScrambledIdx;

                    this.render();
                    this.checkWin();
                }
            }
        } else {
            alert('Not enough coins!');
        }
    },

    skipLevel() {
        if (State.deductCoins(50)) {
            State.completeLevel(this.currentPackId, this.currentLevelIndex);
            this.showCompletionModal();
        } else {
            alert('Not enough coins!');
        }
    }
};

// Initialize
window.addEventListener('DOMContentLoaded', async () => {
    await State.init();
    Input.init(); // Initialize Global Input

    // Determine current page and init based on DOM elements
    if (document.getElementById('packs-list')) {
        Home.init();
    } else if (document.getElementById('levels-grid')) {
        Album.init();
    } else if (document.getElementById('word-display')) {
        Game.init();
    }

    // Mobile Banner Logic
    const banner = document.getElementById('mobile-banner');
    const closeBtn = document.getElementById('close-banner');
    const app = document.getElementById('app');

    if (closeBtn && banner) {
        closeBtn.onclick = () => {
            banner.style.display = 'none'; // Completely remove from flow/view
            if (app) {
                app.classList.remove('pt-14'); // Remove top padding
            }
        };
    }
});
