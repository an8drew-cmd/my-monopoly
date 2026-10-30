/**
 * ============================================================================
 * ИНТЕРФЕЙС 2D МОНОПОЛИИ, АНИМАЦИИ И ОНЛАЙН-СВЯЗЬ (app.js)
 * ============================================================================
 */
(function () {
  const STORAGE_CFG_KEY = 'my_monopoly_custom_config_v1';

  // Загружаем базовую конфигурацию + пользовательские правки из памяти устройства
  function loadActiveConfig() {
    const base = JSON.parse(JSON.stringify(window.DEFAULT_BOARD_CONFIG));
    try {
      const raw = localStorage.getItem(STORAGE_CFG_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        if (saved && saved.meta && Array.isArray(saved.tiles) && saved.tiles.length === 40) {
          return saved;
        }
      }
    } catch (_) {}
    return base;
  }

  let customConfig = loadActiveConfig();

  // Состояние приложения
  const app = {
    mode: 'local', // 'local' | 'online'
    state: null,
    myPlayerId: null, // В локальной игре = текущий не-бот; в онлайне = наш ID в комнате
    isHost: false,
    roomCode: null,
    reconnectKey: null,
    ws: null,
    botTimer: null,
    animating: false,
    displayedPositions: {}, // playerId -> tileId (для плавной шаговой анимации)
    lastProcessedEventSeq: 0,
    selectedDeedTileId: null,
    chatBubbles: {} // playerId -> text
  };

  // Начальный список игроков для локальной игры
  let localSetup = [
    { id: 'p1', name: 'Вы', tokenIdx: 0, isBot: false },
    { id: 'p2', name: 'Макс (Бот)', tokenIdx: 1, isBot: true },
    { id: 'p3', name: 'Алиса (Бот)', tokenIdx: 2, isBot: true }
  ];
  let selectedOnlineTokenIdx = 0;

  // Утилиты DOM
  const $ = (id) => document.getElementById(id);

  function toast(msg) {
    const box = $('toast-container');
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.remove(), 2900);
  }

  function fmt(amount, cfg) {
    return window.MonopolyEngine.formatMoney(amount, cfg || (app.state ? app.state.config : customConfig));
  }

  // ==================== ГЛАВНОЕ МЕНЮ И ВКЛАДКИ ====================

  function refreshBrandHeaders() {
    $('menu-title').textContent = customConfig.meta.gameTitle || 'МОНОПОЛИЯ';
    $('menu-subtitle').textContent =
      (customConfig.meta.gameSubtitle || 'Клуб друзей') +
      ' · Старт ' +
      fmt(customConfig.meta.startingCash, customConfig);
  }

  function initTabs() {
    document.querySelectorAll('.mode-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        window.GameSound.click();
        document.querySelectorAll('.mode-tab').forEach((b) => b.classList.remove('active'));
        document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        $('tab-' + btn.dataset.tab).classList.add('active');
      });
    });
  }

  function renderLocalSetup() {
    const list = $('local-players-list');
    list.innerHTML = '';
    localSetup.forEach((p, idx) => {
      const tok = customConfig.tokens[p.tokenIdx % customConfig.tokens.length];
      const row = document.createElement('div');
      row.className = 'setup-player-row';

      const tokBtn = document.createElement('button');
      tokBtn.className = 'token-cycle-btn';
      tokBtn.style.background = tok.color + '33';
      tokBtn.style.borderColor = tok.color;
      tokBtn.textContent = tok.emoji;
      tokBtn.title = 'Нажми, чтобы сменить фишку';
      tokBtn.onclick = () => {
        window.GameSound.click();
        p.tokenIdx = (p.tokenIdx + 1) % customConfig.tokens.length;
        renderLocalSetup();
      };

      const inp = document.createElement('input');
      inp.value = p.name;
      inp.maxLength = 16;
      inp.oninput = (e) => {
        p.name = e.target.value;
      };

      const botBtn = document.createElement('button');
      botBtn.className = 'bot-toggle-btn' + (p.isBot ? ' is-bot' : '');
      botBtn.textContent = p.isBot ? '🤖 Бот' : '👤 Человек';
      botBtn.onclick = () => {
        window.GameSound.click();
        p.isBot = !p.isBot;
        if (p.isBot && !p.name.includes('Бот')) p.name = p.name + ' (Бот)';
        if (!p.isBot) p.name = p.name.replace(' (Бот)', '');
        renderLocalSetup();
      };

      const delBtn = document.createElement('button');
      delBtn.className = 'icon-btn';
      delBtn.textContent = '✕';
      delBtn.style.visibility = localSetup.length > 2 ? 'visible' : 'hidden';
      delBtn.onclick = () => {
        if (localSetup.length > 2) {
          localSetup.splice(idx, 1);
          renderLocalSetup();
        }
      };

      row.append(tokBtn, inp, botBtn, delBtn);
      list.appendChild(row);
    });
  }

  function renderOnlineTokenPicker() {
    const box = $('online-token-picker');
    box.innerHTML = '';
    customConfig.tokens.forEach((t, idx) => {
      const btn = document.createElement('button');
      btn.className = 'token-pick-item' + (idx === selectedOnlineTokenIdx ? ' selected' : '');
      btn.textContent = t.emoji;
      btn.onclick = () => {
        window.GameSound.click();
        selectedOnlineTokenIdx = idx;
        renderOnlineTokenPicker();
      };
      box.appendChild(btn);
    });
  }

  // ==================== КОНСТРУКТОР СВОИХ ПРАВИЛ ====================

  function renderCustomEditor() {
    $('cfg-title').value = customConfig.meta.gameTitle;
    $('cfg-currency').value = customConfig.meta.currency;
    $('cfg-start-cash').value = customConfig.meta.startingCash;
    $('cfg-go-salary').value = customConfig.meta.goSalary;
    $('cfg-parking-jackpot').checked = !!customConfig.meta.freeParkingJackpot;

    const list = $('cfg-tiles-editor');
    list.innerHTML = '';
    customConfig.tiles.forEach((tile) => {
      const row = document.createElement('div');
      row.className = 'cfg-tile-item';

      const dot = document.createElement('div');
      dot.className = 'cfg-color-dot';
      if (tile.group && customConfig.groups[tile.group]) {
        dot.style.background = customConfig.groups[tile.group].color;
      } else {
        dot.style.background = '#334155';
        dot.textContent = tile.icon || '•';
      }

      const nameInp = document.createElement('input');
      nameInp.value = tile.name;
      nameInp.dataset.tileId = tile.id;
      nameInp.dataset.field = 'name';

      const priceWrap = document.createElement('div');
      if (tile.price !== undefined || tile.amount !== undefined) {
        const pInp = document.createElement('input');
        pInp.type = 'number';
        pInp.step = '50';
        pInp.value = tile.price !== undefined ? tile.price : tile.amount;
        pInp.dataset.tileId = tile.id;
        pInp.dataset.field = tile.price !== undefined ? 'price' : 'amount';
        priceWrap.appendChild(pInp);
      } else {
        priceWrap.style.fontSize = '11px';
        priceWrap.style.color = '#94a3b8';
        priceWrap.textContent = 'Особая';
      }

      row.append(dot, nameInp, priceWrap);
      list.appendChild(row);
    });
  }

  function collectEditorIntoConfig() {
    customConfig.meta.gameTitle = $('cfg-title').value.trim() || 'МОНОПОЛИЯ';
    customConfig.meta.currency = $('cfg-currency').value.trim() || '₽';
    customConfig.meta.startingCash = Math.max(500, Number($('cfg-start-cash').value) || 15000);
    customConfig.meta.goSalary = Math.max(100, Number($('cfg-go-salary').value) || 2000);
    customConfig.meta.freeParkingJackpot = $('cfg-parking-jackpot').checked;

    $('cfg-tiles-editor').querySelectorAll('input').forEach((inp) => {
      const id = Number(inp.dataset.tileId);
      const field = inp.dataset.field;
      const tile = customConfig.tiles[id];
      if (!tile) return;
      if (field === 'name') {
        tile.name = inp.value.trim() || tile.name;
      } else if (field === 'price') {
        const oldPrice = tile.price || 1000;
        const newPrice = Math.max(100, Number(inp.value) || oldPrice);
        const ratio = newPrice / oldPrice;
        tile.price = newPrice;
        if (Array.isArray(tile.rent) && Math.abs(ratio - 1) > 0.01 && tile.type === 'property') {
          tile.rent = tile.rent.map((r) => Math.max(10, Math.round((r * ratio) / 10) * 10));
        }
      } else if (field === 'amount') {
        tile.amount = Math.max(50, Number(inp.value) || 500);
      }
    });
    customConfig.tiles[0].sub = '+' + customConfig.meta.goSalary + ' ' + customConfig.meta.currency;
  }

  // ==================== ОТРИСОВКА 2D-ДОСКИ 11x11 ====================

  function getTileGridPosition(id) {
    if (id === 0) return { col: 11, row: 11, cls: 'corner' };
    if (id > 0 && id < 10) return { col: 11 - id, row: 11, cls: 'side-bottom' };
    if (id === 10) return { col: 1, row: 11, cls: 'corner' };
    if (id > 10 && id < 20) return { col: 1, row: 11 - (id - 10), cls: 'side-left' };
    if (id === 20) return { col: 1, row: 1, cls: 'corner' };
    if (id > 20 && id < 30) return { col: 1 + (id - 20), row: 1, cls: 'side-top' };
    if (id === 30) return { col: 11, row: 1, cls: 'corner' };
    return { col: 11, row: 1 + (id - 30), cls: 'side-right' };
  }

  function buildBoardDOM(config) {
    const grid = $('board-grid');
    // Удаляем старые клетки, оставляя .board-center
    grid.querySelectorAll('.tile').forEach((el) => el.remove());

    config.tiles.forEach((tile) => {
      const pos = getTileGridPosition(tile.id);
      const cell = document.createElement('div');
      cell.className = `tile ${pos.cls}`;
      cell.id = `tile-${tile.id}`;
      cell.style.gridColumn = pos.col;
      cell.style.gridRow = pos.row;

      if (tile.type === 'property' && config.groups[tile.group]) {
        const band = document.createElement('div');
        band.className = 'tile-band';
        band.id = `band-${tile.id}`;
        band.style.background = config.groups[tile.group].color;
        cell.appendChild(band);
      }

      const content = document.createElement('div');
      content.className = 'tile-content';

      if (tile.icon) {
        const ic = document.createElement('div');
        ic.className = 'tile-icon';
        ic.textContent = tile.icon;
        content.appendChild(ic);
      }

      const nm = document.createElement('div');
      nm.className = 'tile-name';
      nm.textContent = tile.name;
      content.appendChild(nm);

      if (tile.price || tile.amount) {
        const pr = document.createElement('div');
        pr.className = 'tile-price';
        pr.textContent = (tile.price || tile.amount) + '';
        content.appendChild(pr);
      }

      const tokenBox = document.createElement('div');
      tokenBox.className = 'tile-tokens';
      tokenBox.id = `tokens-${tile.id}`;

      cell.appendChild(content);
      cell.appendChild(tokenBox);
      cell.addEventListener('click', () => openTileDeedModal(tile.id));
      grid.appendChild(cell);
    });

    $('board-center-title').textContent = config.meta.gameTitle || 'МОНОПОЛИЯ';
  }

  // Отрисовка точек на 2D-кубиках
  const PIP_MAP = {
    1: [4],
    2: [0, 8],
    3: [0, 4, 8],
    4: [0, 2, 6, 8],
    5: [0, 2, 4, 6, 8],
    6: [0, 2, 3, 5, 6, 8]
  };

  function renderDie(el, val) {
    el.innerHTML = '';
    const active = PIP_MAP[val] || PIP_MAP[1];
    for (let i = 0; i < 9; i++) {
      const cell = document.createElement('div');
      if (active.includes(i)) {
        cell.className = 'pip';
      }
      el.appendChild(cell);
    }
  }

  // Кто сейчас управляет устройством?
  function canControlPlayer(playerId) {
    if (!app.state) return false;
    const p = app.state.players.find((x) => x.id === playerId);
    if (!p || p.isBot || p.bankrupt) return false;
    if (app.mode === 'local') return true; // На одном экране люди ходят по очереди
    return app.myPlayerId === playerId;
  }

  function sendGameAction(action) {
    if (!app.state) return;
    if (app.mode === 'local') {
      const res = window.MonopolyEngine.applyAction(app.state, action);
      if (!res.ok) {
        toast('⚠️ ' + res.error);
        return;
      }
      handleNewStateEffects(app.state);
      scheduleLocalBots();
    } else if (app.ws && app.ws.readyState === WebSocket.OPEN) {
      app.ws.send(JSON.stringify({ type: 'gameAction', action }));
    }
  }

  // ==================== АНИМАЦИЯ ХОДОВ И ЗВУКОВ ====================

  function handleNewStateEffects(state) {
    const ev = state.lastEvent;
    if (!ev || ev.seq === app.lastProcessedEventSeq) {
      renderGameUI();
      return;
    }
    app.lastProcessedEventSeq = ev.seq;

    if (ev.type === 'BOUGHT' || ev.type === 'AUCTION_WON' || ev.type === 'BUILD') {
      window.GameSound.buy();
    } else if (ev.type === 'PAY_RENT' || ev.type === 'TAX') {
      window.GameSound.pay();
    } else if (ev.type === 'GAME_OVER') {
      window.GameSound.win();
    }

    // Если было перемещение по полю — анимируем кубики и шаги фишки!
    if (Array.isArray(ev.path) && ev.path.length > 0 && ev.playerId) {
      app.animating = true;
      window.GameSound.dice();
      const d1El = $('die-1');
      const d2El = $('die-2');
      d1El.classList.add('rolling');
      d2El.classList.add('rolling');

      setTimeout(() => {
        d1El.classList.remove('rolling');
        d2El.classList.remove('rolling');
        renderDie(d1El, state.lastDice[0]);
        renderDie(d2El, state.lastDice[1]);

        const steps = ev.path.slice();
        const stepInterval = setInterval(() => {
          if (steps.length === 0) {
            clearInterval(stepInterval);
            app.animating = false;
            app.displayedPositions[ev.playerId] = state.players.find((p) => p.id === ev.playerId).position;
            renderGameUI();
            if (ev.card) {
              showDrawnCardModal(ev.card);
            }
            return;
          }
          app.displayedPositions[ev.playerId] = steps.shift();
          window.GameSound.step();
          renderTokensOnly();
        }, 78);
      }, 360);
    } else {
      renderDie($('die-1'), state.lastDice[0]);
      renderDie($('die-2'), state.lastDice[1]);
      state.players.forEach((p) => {
        app.displayedPositions[p.id] = p.position;
      });
      renderGameUI();
      if (ev.card) {
        showDrawnCardModal(ev.card);
      }
    }
  }

  function showDrawnCardModal(card) {
    window.GameSound.card();
    $('drawn-card-badge').textContent = card.deck || 'КАРТОЧКА';
    $('drawn-card-text').textContent = card.text;
    $('modal-card-drawn').classList.remove('hidden');
  }

  function renderTokensOnly() {
    if (!app.state) return;
    app.state.config.tiles.forEach((t) => {
      const box = $(`tokens-${t.id}`);
      if (box) box.innerHTML = '';
    });
    const cur = app.state.players[app.state.currentPlayerIndex];
    app.state.players.forEach((p) => {
      if (p.bankrupt) return;
      const pos = app.displayedPositions[p.id] !== undefined ? app.displayedPositions[p.id] : p.position;
      const box = $(`tokens-${pos}`);
      if (!box) return;
      const tok = document.createElement('div');
      tok.className = 'board-token' + (cur && cur.id === p.id ? ' active-turn' : '');
      tok.style.borderColor = p.color;
      tok.textContent = p.emoji;
      box.appendChild(tok);
    });
  }

  function renderGameUI() {
    const state = app.state;
    if (!state) return;

    const cfg = state.config;
    const cur = state.players[state.currentPlayerIndex];

    // Верхняя плашка
    $('hud-mode-badge').textContent = app.mode === 'online' ? `ОНЛАЙН · ${app.roomCode}` : 'ЛОКАЛЬНО';
    $('hud-turn-info').textContent = `Раунд ${state.turnNumber}`;

    // Копилка на парковке
    const potEl = $('board-parking-pot');
    if (cfg.meta.freeParkingJackpot) {
      potEl.classList.remove('hidden');
      potEl.textContent = `🅿️ Джекпот парковки: ${fmt(state.freeParkingPot, cfg)}`;
    } else {
      potEl.classList.add('hidden');
    }

    // Обновляем владельцев и дома на всех 40 клетках
    cfg.tiles.forEach((tile) => {
      const cell = $(`tile-${tile.id}`);
      if (!cell) return;
      const own = state.ownership[tile.id];
      cell.classList.toggle('mortgaged', !!(own && own.mortgaged));

      const oldTag = cell.querySelector('.owner-tag');
      if (oldTag) oldTag.remove();

      if (own && own.ownerId) {
        const owner = state.players.find((p) => p.id === own.ownerId);
        if (owner) {
          const tag = document.createElement('div');
          tag.className = 'owner-tag';
          tag.style.background = owner.color;
          cell.appendChild(tag);
        }
      }

      const band = $(`band-${tile.id}`);
      if (band) {
        band.innerHTML = '';
        if (own && own.houses > 0) {
          if (own.houses === 5) {
            const st = document.createElement('span');
            st.className = 'hotel-star';
            st.textContent = '🏨';
            band.appendChild(st);
          } else {
            for (let i = 0; i < own.houses; i++) {
              const d = document.createElement('span');
              d.className = 'house-dot';
              band.appendChild(d);
            }
          }
        }
      }
    });

    renderTokensOnly();
    renderCenterControls(state, cur);
    renderPlayersStrip(state, cur);
    renderAuctionModal(state);
    renderIncomingTradeModal(state);

    // Если открыта карточка участка — обновим кнопки на ней
    if (app.selectedDeedTileId !== null && !$('modal-tile').classList.contains('hidden')) {
      openTileDeedModal(app.selectedDeedTileId);
    }

    // Финал игры
    if (state.turnPhase === 'GAME_OVER' && state.winnerId) {
      const winP = state.players.find((p) => p.id === state.winnerId);
      if (winP) {
        $('winner-title').textContent = `${winP.emoji} Победитель — ${winP.name}!`;
        $('winner-subtitle').textContent = `Итоговый капитал: ${fmt(winP.money, cfg)}`;
        $('modal-winner').classList.remove('hidden');
      }
    }

    $('center-last-log').textContent = state.logs[0] || '';
  }

  function renderCenterControls(state, cur) {
    const banner = $('active-player-banner');
    const box = $('turn-controls');
    box.innerHTML = '';

    if (state.turnPhase === 'GAME_OVER') {
      banner.textContent = '🏆 Партия завершена!';
      return;
    }

    const mine = canControlPlayer(cur.id);
    banner.innerHTML = `${cur.emoji} Ход: <span style="color:${cur.color}">${cur.name}</span>${
      state.extraRollGranted ? ' · 🔥 ДУБЛЬ!' : ''
    }`;

    if (!mine) {
      const waitSpan = document.createElement('span');
      waitSpan.style.fontSize = '12px';
      waitSpan.style.color = '#94a3b8';
      waitSpan.textContent = cur.isBot ? '🤖 Бот обдумывает ход…' : `Ждём хода ${cur.name}…`;
      box.appendChild(waitSpan);
      return;
    }

    if (state.turnPhase === 'PRE_ROLL') {
      if (cur.inJail) {
        const bail = state.config.meta.jailBail || 500;
        if (cur.money >= bail) {
          const bBtn = document.createElement('button');
          bBtn.className = 'btn btn-outline';
          bBtn.textContent = `🔓 Залог ${fmt(bail)}`;
          bBtn.onclick = () => sendGameAction({ type: 'payBail', playerId: cur.id });
          box.appendChild(bBtn);
        }
        if (cur.jailCards > 0) {
          const cBtn = document.createElement('button');
          cBtn.className = 'btn btn-accent';
          cBtn.textContent = '🎫 Карта свободы';
          cBtn.onclick = () => sendGameAction({ type: 'useJailCard', playerId: cur.id });
          box.appendChild(cBtn);
        }
      }
      const rBtn = document.createElement('button');
      rBtn.className = 'btn btn-primary';
      rBtn.textContent = cur.inJail ? '🎲 Кинуть на дубль' : '🎲 Бросить кубики';
      rBtn.onclick = () => sendGameAction({ type: 'roll', playerId: cur.id });
      box.appendChild(rBtn);
      return;
    }

    if (state.turnPhase === 'BUY_DECISION' && state.pendingBuyTileId !== null) {
      const tile = state.config.tiles[state.pendingBuyTileId];
      const buyBtn = document.createElement('button');
      buyBtn.className = 'btn btn-primary';
      buyBtn.textContent = `🏠 Купить «${tile.name}» (${fmt(tile.price)})`;
      buyBtn.disabled = cur.money < tile.price;
      if (cur.money < tile.price) buyBtn.style.opacity = '0.5';
      buyBtn.onclick = () => sendGameAction({ type: 'buy', playerId: cur.id });

      const aucBtn = document.createElement('button');
      aucBtn.className = 'btn btn-outline';
      aucBtn.textContent = '🔨 На аукцион';
      aucBtn.onclick = () => sendGameAction({ type: 'startAuction', playerId: cur.id });

      box.append(buyBtn, aucBtn);
      return;
    }

    if (state.turnPhase === 'DEBT') {
      const debtBtn = document.createElement('button');
      debtBtn.className = 'btn btn-danger';
      debtBtn.textContent = '💥 Признать банкротство';
      debtBtn.onclick = () => {
        if (confirm('Точно признать банкротство? Сначала можно заложить участки кликом по ним на доске!')) {
          sendGameAction({ type: 'declareBankruptcy', playerId: cur.id });
        }
      };
      box.appendChild(debtBtn);
      return;
    }

    if (state.turnPhase === 'END_TURN') {
      const endBtn = document.createElement('button');
      endBtn.className = 'btn btn-accent';
      endBtn.textContent = '✅ Завершить ход';
      endBtn.onclick = () => sendGameAction({ type: 'endTurn', playerId: cur.id });
      box.appendChild(endBtn);
    }
  }

  function renderPlayersStrip(state, cur) {
    const strip = $('players-strip');
    strip.innerHTML = '';

    state.players.forEach((p) => {
      const card = document.createElement('div');
      card.className =
        'player-card' +
        (cur && cur.id === p.id ? ' active' : '') +
        (p.bankrupt ? ' bankrupt' : '');

      if (app.chatBubbles[p.id]) {
        const bub = document.createElement('div');
        bub.className = 'chat-bubble';
        bub.textContent = app.chatBubbles[p.id];
        card.appendChild(bub);
      }

      const top = document.createElement('div');
      top.className = 'pcard-top';

      const ident = document.createElement('div');
      ident.className = 'pcard-ident';

      const av = document.createElement('div');
      av.className = 'pcard-avatar';
      av.style.background = p.color + '33';
      av.style.border = `1.5px solid ${p.color}`;
      av.textContent = p.emoji;

      const nm = document.createElement('div');
      nm.className = 'pcard-name';
      nm.textContent =
        p.name +
        (app.mode === 'online' && p.id === app.myPlayerId ? ' (Вы)' : '') +
        (p.inJail ? ' 🔒' : '') +
        (p.jailCards > 0 ? ' 🎫' : '');

      ident.append(av, nm);

      const mon = document.createElement('div');
      mon.className = 'pcard-money' + (p.money < 0 ? ' negative' : '');
      mon.textContent = p.bankrupt ? 'БАНКРОТ' : fmt(p.money, state.config);

      top.append(ident, mon);

      const propsRow = document.createElement('div');
      propsRow.className = 'pcard-props';
      state.config.tiles.forEach((t) => {
        const own = state.ownership[t.id];
        if (own && own.ownerId === p.id) {
          const chip = document.createElement('div');
          chip.className = 'prop-chip';
          chip.title = t.name;
          chip.style.background =
            t.group && state.config.groups[t.group]
              ? state.config.groups[t.group].color
              : '#94a3b8';
          if (own.mortgaged) chip.style.opacity = '0.35';
          chip.onclick = (e) => {
            e.stopPropagation();
            openTileDeedModal(t.id);
          };
          propsRow.appendChild(chip);
        }
      });

      card.append(top, propsRow);
      strip.appendChild(card);
    });
  }

  // ==================== КАРТОЧКА УЧАСТКА (ТИТУЛ) ====================

  function openTileDeedModal(tileId) {
    if (!app.state) return;
    app.selectedDeedTileId = tileId;
    const cfg = app.state.config;
    const tile = cfg.tiles[tileId];
    const own = app.state.ownership[tileId];
    const header = $('deed-header');
    const body = $('deed-body');
    const actions = $('deed-actions');

    window.GameSound.click();
    $('deed-title').textContent = tile.name;
    actions.innerHTML = '';

    if (tile.group && cfg.groups[tile.group]) {
      header.style.background = cfg.groups[tile.group].color;
      header.style.color = cfg.groups[tile.group].textColor || '#fff';
      header.querySelector('.deed-kicker').textContent = cfg.groups[tile.group].name.toUpperCase();
    } else {
      header.style.background = '#334155';
      header.style.color = '#fff';
      header.querySelector('.deed-kicker').textContent = 'ИНФОРМАЦИЯ О КЛЕТКЕ';
    }

    const ownerPlayer = own && own.ownerId ? app.state.players.find((p) => p.id === own.ownerId) : null;
    let html = '';

    if (tile.type === 'property') {
      html += `<div class="rent-row"><span>Стоимость участка:</span><strong>${fmt(tile.price, cfg)}</strong></div>`;
      html += `<div class="rent-row"><span>Владелец:</span><strong>${
        ownerPlayer ? ownerPlayer.emoji + ' ' + ownerPlayer.name + (own.mortgaged ? ' (В ЗАЛОГЕ)' : '') : 'Свободен'
      }</strong></div>`;
      html += `<div class="rent-row"><span>Базовая рента (полный район ×2):</span><strong>${fmt(tile.rent[0], cfg)}</strong></div>`;
      html += `<div class="rent-row"><span>С 1 домом 🏠:</span><strong>${fmt(tile.rent[1], cfg)}</strong></div>`;
      html += `<div class="rent-row"><span>С 2 домами 🏠🏠:</span><strong>${fmt(tile.rent[2], cfg)}</strong></div>`;
      html += `<div class="rent-row"><span>С 3 домами 🏠🏠🏠:</span><strong>${fmt(tile.rent[3], cfg)}</strong></div>`;
      html += `<div class="rent-row"><span>С 4 домами 🏠🏠🏠🏠:</span><strong>${fmt(tile.rent[4], cfg)}</strong></div>`;
      html += `<div class="rent-row"><span>С Отелем 🏨:</span><strong>${fmt(tile.rent[5], cfg)}</strong></div>`;
      html += `<div class="rent-row"><span>Постройка дома:</span><strong>${fmt(tile.houseCost, cfg)}</strong></div>`;
      html += `<div class="rent-row"><span>Залог в банк:</span><strong>${fmt(Math.floor(tile.price / 2), cfg)}</strong></div>`;
    } else if (tile.type === 'railroad') {
      html += `<div class="rent-row"><span>Стоимость:</span><strong>${fmt(tile.price, cfg)}</strong></div>`;
      html += `<div class="rent-row"><span>Владелец:</span><strong>${ownerPlayer ? ownerPlayer.name : 'Свободен'}</strong></div>`;
      tile.rent.forEach((r, idx) => {
        html += `<div class="rent-row"><span>При владении ${idx + 1} ж/д:</span><strong>${fmt(r, cfg)}</strong></div>`;
      });
    } else if (tile.type === 'utility') {
      html += `<div class="rent-row"><span>Стоимость:</span><strong>${fmt(tile.price, cfg)}</strong></div>`;
      html += `<div class="rent-row"><span>Владелец:</span><strong>${ownerPlayer ? ownerPlayer.name : 'Свободен'}</strong></div>`;
      html += `<div class="rent-row"><span>1 предприятие:</span><strong>Сумма кубиков × 40</strong></div>`;
      html += `<div class="rent-row"><span>Оба предприятия:</span><strong>Сумма кубиков × 100</strong></div>`;
    } else {
      html += `<p style="margin:6px 0;color:#cbd5e1;">Особая клетка игрового поля. ${
        tile.amount ? 'Сумма платежа: ' + fmt(tile.amount, cfg) : tile.sub || ''
      }</p>`;
    }

    body.innerHTML = html;

    // Кнопки управления недвижимостью для владельца в его ход
    const cur = app.state.players[app.state.currentPlayerIndex];
    if (own && cur && own.ownerId === cur.id && canControlPlayer(cur.id)) {
      if (tile.type === 'property') {
        const buildCheck = window.MonopolyEngine.canBuildHouse(app.state, cur.id, tile.id);
        if (buildCheck.ok) {
          const b = document.createElement('button');
          b.className = 'btn btn-primary btn-sm';
          b.textContent = own.houses === 4 ? `🏨 Отель (${fmt(tile.houseCost)})` : `🏗️ Дом (${fmt(tile.houseCost)})`;
          b.onclick = () => sendGameAction({ type: 'buildHouse', playerId: cur.id, tileId: tile.id });
          actions.appendChild(b);
        }

        const sellCheck = window.MonopolyEngine.canSellHouse(app.state, cur.id, tile.id);
        if (sellCheck.ok) {
          const s = document.createElement('button');
          s.className = 'btn btn-outline btn-sm';
          s.textContent = `🏘️ Продать (+${fmt(Math.floor(tile.houseCost / 2))})`;
          s.onclick = () => sendGameAction({ type: 'sellHouse', playerId: cur.id, tileId: tile.id });
          actions.appendChild(s);
        }
      }

      if (!own.mortgaged && window.MonopolyEngine.canMortgage(app.state, cur.id, tile.id).ok) {
        const m = document.createElement('button');
        m.className = 'btn btn-outline btn-sm';
        m.textContent = `🏦 Заложить (+${fmt(Math.floor(tile.price / 2))})`;
        m.onclick = () => sendGameAction({ type: 'mortgage', playerId: cur.id, tileId: tile.id });
        actions.appendChild(m);
      } else if (own.mortgaged) {
        const buyout = Math.ceil((tile.price / 2) * 1.1);
        if (cur.money >= buyout) {
          const u = document.createElement('button');
          u.className = 'btn btn-accent btn-sm';
          u.textContent = `🔓 Выкупить (${fmt(buyout)})`;
          u.onclick = () => sendGameAction({ type: 'unmortgage', playerId: cur.id, tileId: tile.id });
          actions.appendChild(u);
        }
      }
    }

    $('modal-tile').classList.remove('hidden');
  }

  // ==================== АУКЦИОН И ОБМЕН ====================

  function renderAuctionModal(state) {
    const modal = $('modal-auction');
    if (state.turnPhase !== 'AUCTION' || !state.auction) {
      modal.classList.add('hidden');
      return;
    }
    const auc = state.auction;
    const tile = state.config.tiles[auc.tileId];
    const bidderId = auc.activeBidders[auc.turnIndex % auc.activeBidders.length];
    const bidder = state.players.find((p) => p.id === bidderId);
    const leader = auc.highestBidderId ? state.players.find((p) => p.id === auc.highestBidderId) : null;

    $('auc-tile-name').textContent = tile.name + ` (номинал ${fmt(tile.price)})`;
    $('auc-current-bid').textContent = fmt(auc.currentBid);
    $('auc-leader').textContent = leader ? `Лидирует: ${leader.emoji} ${leader.name}` : 'Стартовая цена';
    $('auc-turn-prompt').textContent = bidder
      ? `${bidder.emoji} Слово за ${bidder.name} (баланс ${fmt(bidder.money)})`
      : '';

    const canAct = bidder && canControlPlayer(bidder.id);
    $('auc-buttons').style.opacity = canAct ? '1' : '0.45';
    $('auc-buttons').style.pointerEvents = canAct ? 'auto' : 'none';

    modal.classList.remove('hidden');
  }

  function openTradeBuilder() {
    if (!app.state) return;
    const cur = app.state.players[app.state.currentPlayerIndex];
    if (!canControlPlayer(cur.id)) {
      toast('Предлагать обмен можно во время своего хода');
      return;
    }

    const partners = app.state.players.filter((p) => !p.bankrupt && p.id !== cur.id);
    if (!partners.length) return;

    const sel = $('trade-partner-select');
    sel.innerHTML = '';
    partners.forEach((p) => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = `${p.emoji} ${p.name} (${fmt(p.money)})`;
      sel.appendChild(opt);
    });

    const populateColumns = () => {
      const partnerId = sel.value;
      const partner = app.state.players.find((p) => p.id === partnerId);
      $('trade-my-title').textContent = `Отдаёт ${cur.name}`;
      $('trade-their-title').textContent = `Отдаёт ${partner ? partner.name : ''}`;
      $('trade-offer-cash').value = 0;
      $('trade-request-cash').value = 0;

      const fillTiles = (container, ownerId) => {
        container.innerHTML = '';
        const myTiles = app.state.config.tiles.filter(
          (t) => app.state.ownership[t.id] && app.state.ownership[t.id].ownerId === ownerId
        );
        if (!myTiles.length) {
          container.innerHTML = '<span style="color:#94a3b8;">Нет участков</span>';
          return;
        }
        myTiles.forEach((t) => {
          const lbl = document.createElement('label');
          lbl.className = 'trade-check-item';
          lbl.innerHTML = `<input type="checkbox" value="${t.id}" /> <span>${t.name}</span>`;
          container.appendChild(lbl);
        });
      };

      fillTiles($('trade-my-tiles'), cur.id);
      fillTiles($('trade-their-tiles'), partnerId);
    };

    sel.onchange = populateColumns;
    populateColumns();
    $('modal-trade').classList.remove('hidden');
  }

  function renderIncomingTradeModal(state) {
    const modal = $('modal-trade-incoming');
    const tr = state.pendingTrade;
    if (!tr) {
      modal.classList.add('hidden');
      return;
    }

    const fromP = state.players.find((p) => p.id === tr.fromId);
    const toP = state.players.find((p) => p.id === tr.toId);
    if (!fromP || !toP) return;

    const namesOf = (ids) =>
      ids.map((id) => `«${state.config.tiles[id].name}»`).join(', ') || 'без участков';

    $('incoming-trade-summary').innerHTML = `
      <div><strong>${fromP.emoji} ${fromP.name}</strong> предлагает игроку <strong>${toP.emoji} ${toP.name}</strong>:</div>
      <hr style="border-color:rgba(148,163,184,0.2);margin:8px 0;">
      <div>📤 Отдаёт: <strong>${namesOf(tr.offerTiles)}</strong> ${tr.offerCash ? '+ ' + fmt(tr.offerCash) : ''}</div>
      <div>📥 Просит взамен: <strong>${namesOf(tr.requestTiles)}</strong> ${tr.requestCash ? '+ ' + fmt(tr.requestCash) : ''}</div>
    `;

    const iAmTarget = canControlPlayer(toP.id);
    $('incoming-trade-buttons').classList.toggle('hidden', !iAmTarget);
    $('incoming-trade-waiting').classList.toggle('hidden', iAmTarget);
    modal.classList.remove('hidden');
  }

  // ==================== ЛОКАЛЬНЫЙ ЦИКЛ БОТОВ ====================

  function scheduleLocalBots() {
    if (app.mode !== 'local' || !app.state) return;
    clearTimeout(app.botTimer);
    app.botTimer = setTimeout(() => {
      if (!app.state || app.mode !== 'local') return;
      if (app.animating) {
        scheduleLocalBots();
        return;
      }
      const botAction = window.MonopolyEngine.computeBotAction(app.state);
      if (botAction) {
        window.MonopolyEngine.applyAction(app.state, botAction);
        handleNewStateEffects(app.state);
        scheduleLocalBots();
      }
    }, 820);
  }

  // ==================== ОНЛАЙН ПО КОДУ КОМНАТЫ (WebSocket) ====================

  function connectOnlineWS(onOpenCallback) {
    if (app.ws && app.ws.readyState === WebSocket.OPEN) {
      if (onOpenCallback) onOpenCallback();
      return;
    }

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${proto}//${window.location.host}/ws`;
    $('online-status-msg').textContent = 'Подключение к игровому серверу…';

    const ws = new WebSocket(wsUrl);
    app.ws = ws;

    ws.onopen = () => {
      $('online-status-msg').textContent = '';
      clearInterval(app.heartbeatTimer);
      app.heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
        fetch('./health').catch(() => {});
      }, 25000);
      if (onOpenCallback) onOpenCallback();
    };

    ws.onmessage = (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch (_) {
        return;
      }

      if (msg.type === 'error') {
        toast('⚠️ ' + msg.message);
        $('online-status-msg').textContent = msg.message;
        return;
      }

      if (msg.type === 'roomJoined') {
        app.mode = 'online';
        app.roomCode = msg.code;
        app.myPlayerId = msg.playerId;
        app.isHost = !!msg.isHost;
        app.reconnectKey = msg.reconnectKey;
        try {
          sessionStorage.setItem(
            'monopoly_online_session',
            JSON.stringify({ code: msg.code, playerId: msg.playerId, reconnectKey: msg.reconnectKey })
          );
        } catch (_) {}
        renderOnlineLobby(msg.lobby);
        return;
      }

      if (msg.type === 'lobbyUpdate') {
        app.isHost = msg.lobby.hostId === app.myPlayerId;
        renderOnlineLobby(msg.lobby);
        return;
      }

      if (msg.type === 'gameStarted') {
        app.mode = 'online';
        app.state = msg.state;
        app.lastProcessedEventSeq = msg.state.lastEvent ? msg.state.lastEvent.seq : 0;
        app.displayedPositions = {};
        msg.state.players.forEach((p) => (app.displayedPositions[p.id] = p.position));
        enterGameScreen();
        return;
      }

      if (msg.type === 'gameState') {
        app.state = msg.state;
        handleNewStateEffects(msg.state);
        return;
      }

      if (msg.type === 'chat') {
        app.chatBubbles[msg.playerId] = msg.text;
        renderGameUI();
        setTimeout(() => {
          if (app.chatBubbles[msg.playerId] === msg.text) {
            delete app.chatBubbles[msg.playerId];
            renderGameUI();
          }
        }, 3800);
      }
    };

    ws.onclose = () => {
      if (app.mode === 'online' && app.roomCode) {
        toast('Связь прервалась, пробуем переподключиться…');
        setTimeout(() => tryAutoReconnect(), 1800);
      }
    };
  }

  function tryAutoReconnect() {
    try {
      const saved = JSON.parse(sessionStorage.getItem('monopoly_online_session') || 'null');
      if (!saved || !saved.code) return;
      connectOnlineWS(() => {
        app.ws.send(
          JSON.stringify({
            type: 'reconnectRoom',
            code: saved.code,
            playerId: saved.playerId,
            reconnectKey: saved.reconnectKey
          })
        );
      });
    } catch (_) {}
  }

  function renderOnlineLobby(lobby) {
    $('online-entry-box').classList.add('hidden');
    $('online-lobby-box').classList.remove('hidden');
    $('lobby-room-code').textContent = lobby.code;

    const list = $('lobby-players-list');
    list.innerHTML = '';
    lobby.players.forEach((p) => {
      const item = document.createElement('div');
      item.className = 'lobby-item';
      item.innerHTML = `
        <span><strong>${p.emoji} ${p.name}</strong> ${p.id === lobby.hostId ? '👑' : ''} ${p.isBot ? '🤖' : ''}</span>
        <span style="font-size:12px;color:#94a3b8;">${p.id === app.myPlayerId ? 'Это вы' : 'Готов'}</span>
      `;
      list.appendChild(item);
    });

    $('lobby-host-controls').classList.toggle('hidden', !app.isHost);
    $('lobby-guest-wait').classList.toggle('hidden', app.isHost);
  }

  // ==================== ПЕРЕКЛЮЧЕНИЕ ЭКРАНОВ ====================

  function enterGameScreen() {
    $('screen-menu').classList.remove('active');
    $('screen-game').classList.add('active');
    $('quick-chat-bar').classList.toggle('hidden', app.mode !== 'online');
    buildBoardDOM(app.state.config);
    renderDie($('die-1'), app.state.lastDice[0]);
    renderDie($('die-2'), app.state.lastDice[1]);
    renderGameUI();
  }

  function exitToMenu() {
    clearTimeout(app.botTimer);
    $('modal-winner').classList.add('hidden');
    $('screen-game').classList.remove('active');
    $('screen-menu').classList.add('active');
    app.state = null;
  }

  // ==================== ПРИВЯЗКА ВСЕХ КНОПОК ====================

  function bindEvents() {
    $('btn-add-local-player').onclick = () => {
      if (localSetup.length >= 6) {
        toast('Максимум 6 игроков за одним столом');
        return;
      }
      window.GameSound.click();
      const idx = localSetup.length;
      localSetup.push({
        id: 'p' + Date.now(),
        name: `Бот ${idx}`,
        tokenIdx: idx % customConfig.tokens.length,
        isBot: true
      });
      renderLocalSetup();
    };

    $('btn-start-local').onclick = () => {
      window.GameSound.click();
      app.mode = 'local';
      const players = localSetup.map((p, idx) => ({
        id: 'local_' + (idx + 1),
        name: p.name || `Игрок ${idx + 1}`,
        tokenId: customConfig.tokens[p.tokenIdx % customConfig.tokens.length].id,
        isBot: p.isBot
      }));
      app.state = window.MonopolyEngine.createGame(players, customConfig);
      app.lastProcessedEventSeq = app.state.lastEvent.seq;
      app.displayedPositions = {};
      app.state.players.forEach((p) => (app.displayedPositions[p.id] = 0));
      enterGameScreen();
      scheduleLocalBots();
    };

    // Онлайн кнопки
    $('btn-create-room').onclick = () => {
      window.GameSound.click();
      const name = $('online-name').value.trim() || 'Хост';
      const tokenId = customConfig.tokens[selectedOnlineTokenIdx].id;
      connectOnlineWS(() => {
        app.ws.send(JSON.stringify({ type: 'createRoom', name, tokenId, customConfig }));
      });
    };

    $('btn-join-room').onclick = () => {
      window.GameSound.click();
      const code = $('online-room-code-input').value.trim().toUpperCase();
      if (code.length < 3) {
        toast('Введите 4-значный код комнаты');
        return;
      }
      const name = $('online-name').value.trim() || 'Гость';
      const tokenId = customConfig.tokens[selectedOnlineTokenIdx].id;
      connectOnlineWS(() => {
        app.ws.send(JSON.stringify({ type: 'joinRoom', code, name, tokenId }));
      });
    };

    $('btn-copy-invite').onclick = () => {
      const inviteUrl = `${window.location.origin}${window.location.pathname}?room=${app.roomCode}`;
      const text = `Заходи в нашу Монополию! Код комнаты: ${app.roomCode}\nСсылка: ${inviteUrl}`;
      navigator.clipboard.writeText(text).then(
        () => toast('✅ Приглашение скопировано! Отправь друзьям'),
        () => toast(`Код комнаты: ${app.roomCode}`)
      );
    };

    $('btn-lobby-add-bot').onclick = () => {
      if (app.ws && app.ws.readyState === WebSocket.OPEN) {
        app.ws.send(JSON.stringify({ type: 'addBot' }));
      }
    };

    $('btn-lobby-start').onclick = () => {
      if (app.ws && app.ws.readyState === WebSocket.OPEN) {
        app.ws.send(JSON.stringify({ type: 'startGame' }));
      }
    };

    $('btn-leave-lobby').onclick = () => {
      if (app.ws && app.ws.readyState === WebSocket.OPEN) {
        app.ws.send(JSON.stringify({ type: 'leaveRoom' }));
      }
      sessionStorage.removeItem('monopoly_online_session');
      app.roomCode = null;
      $('online-lobby-box').classList.add('hidden');
      $('online-entry-box').classList.remove('hidden');
    };

    // Конструктор правил
    $('btn-save-config').onclick = () => {
      collectEditorIntoConfig();
      localStorage.setItem(STORAGE_CFG_KEY, JSON.stringify(customConfig));
      refreshBrandHeaders();
      toast('💾 Ваши правила и названия сохранены!');
    };

    $('btn-reset-config').onclick = () => {
      localStorage.removeItem(STORAGE_CFG_KEY);
      customConfig = JSON.parse(JSON.stringify(window.DEFAULT_BOARD_CONFIG));
      renderCustomEditor();
      refreshBrandHeaders();
      toast('Возвращены классические настройки');
    };

    $('btn-export-config').onclick = () => {
      collectEditorIntoConfig();
      const content =
        '// Автоматически сгенерированный файл твоих настроек Монополии\n' +
        '(function(r,f){if(typeof module==="object"&&module.exports)module.exports=f();else r.DEFAULT_BOARD_CONFIG=f();})(typeof self!=="undefined"?self:this,function(){return ' +
        JSON.stringify(customConfig, null, 2) +
        ';});\n';
      const blob = new Blob([content], { type: 'application/javascript;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'boardConfig.js';
      a.click();
      toast('📥 Файл boardConfig.js скачан!');
    };

    // Игровой верхний бар
    $('btn-exit-game').onclick = () => {
      if (confirm('Выйти в главное меню?')) {
        if (app.mode === 'online' && app.ws && app.ws.readyState === WebSocket.OPEN) {
          app.ws.send(JSON.stringify({ type: 'leaveRoom' }));
          sessionStorage.removeItem('monopoly_online_session');
        }
        exitToMenu();
      }
    };

    $('btn-winner-menu').onclick = exitToMenu;

    $('btn-toggle-zoom').onclick = () => {
      $('board-grid').classList.toggle('zoomed');
    };

    $('btn-toggle-sound').onclick = () => {
      const on = window.GameSound.toggle();
      $('btn-toggle-sound').textContent = on ? '🔊' : '🔇';
    };

    $('btn-open-log').onclick = () => {
      if (!app.state) return;
      const box = $('full-log-list');
      box.innerHTML = '';
      app.state.logs.forEach((line) => {
        const d = document.createElement('div');
        d.className = 'log-entry';
        d.textContent = line;
        box.appendChild(d);
      });
      $('modal-log').classList.remove('hidden');
    };

    $('btn-ios-guide').onclick = () => {
      $('modal-ios-guide').classList.remove('hidden');
    };

    // Аукцион
    document.querySelectorAll('#auc-buttons [data-bid]').forEach((btn) => {
      btn.onclick = () => {
        if (!app.state || !app.state.auction) return;
        const auc = app.state.auction;
        const bidderId = auc.activeBidders[auc.turnIndex % auc.activeBidders.length];
        sendGameAction({ type: 'bid', playerId: bidderId, raise: Number(btn.dataset.bid) });
      };
    });

    $('btn-auc-pass').onclick = () => {
      if (!app.state || !app.state.auction) return;
      const auc = app.state.auction;
      const bidderId = auc.activeBidders[auc.turnIndex % auc.activeBidders.length];
      sendGameAction({ type: 'passAuction', playerId: bidderId });
    };

    // Обмен
    $('btn-open-trade').onclick = openTradeBuilder;

    $('btn-send-trade').onclick = () => {
      if (!app.state) return;
      const cur = app.state.players[app.state.currentPlayerIndex];
      const toId = $('trade-partner-select').value;
      const offerCash = Number($('trade-offer-cash').value) || 0;
      const requestCash = Number($('trade-request-cash').value) || 0;
      const offerTiles = Array.from($('trade-my-tiles').querySelectorAll('input:checked')).map((i) => Number(i.value));
      const requestTiles = Array.from($('trade-their-tiles').querySelectorAll('input:checked')).map((i) => Number(i.value));

      $('modal-trade').classList.add('hidden');
      sendGameAction({
        type: 'proposeTrade',
        playerId: cur.id,
        toId,
        offerCash,
        requestCash,
        offerTiles,
        requestTiles
      });
    };

    $('btn-accept-trade').onclick = () => {
      if (!app.state || !app.state.pendingTrade) return;
      sendGameAction({ type: 'respondTrade', playerId: app.state.pendingTrade.toId, accept: true });
    };

    $('btn-decline-trade').onclick = () => {
      if (!app.state || !app.state.pendingTrade) return;
      sendGameAction({ type: 'respondTrade', playerId: app.state.pendingTrade.toId, accept: false });
    };

    $('btn-cancel-trade').onclick = () => {
      if (!app.state || !app.state.pendingTrade) return;
      sendGameAction({ type: 'cancelTrade', playerId: app.state.pendingTrade.fromId });
    };

    // Быстрые реплики чата
    document.querySelectorAll('.chat-chip').forEach((chip) => {
      chip.onclick = () => {
        if (app.ws && app.ws.readyState === WebSocket.OPEN) {
          app.ws.send(JSON.stringify({ type: 'chat', text: chip.dataset.msg }));
        }
      };
    });

    // Закрытие модалок
    document.querySelectorAll('.modal-close-btn').forEach((btn) => {
      btn.onclick = () => {
        $(btn.dataset.close).classList.add('hidden');
      };
    });
  }

  // Автопроверка ?room=XXXX из ссылки приглашения
  function checkInviteUrl() {
    const params = new URLSearchParams(window.location.search);
    const room = params.get('room');
    if (room) {
      document.querySelector('[data-tab="online"]').click();
      $('online-room-code-input').value = room.toUpperCase();
    } else {
      tryAutoReconnect();
    }
  }

  // Регистрация Service Worker для офлайн-работы на iPhone
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  // Старт приложения
  refreshBrandHeaders();
  initTabs();
  renderLocalSetup();
  renderOnlineTokenPicker();
  renderCustomEditor();
  bindEvents();
  checkInviteUrl();
})();
