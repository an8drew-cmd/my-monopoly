/**
 * ============================================================================
 * ДВИЖОК ПРАВИЛ МОНОПОЛИИ + ИНТЕЛЛЕКТ БОТОВ (gameEngine.js)
 * ============================================================================
 * В оригинальном архиве Monopoly.ipa вся эта логика была зашита внутрь
 * бинарного файла Frameworks/UnityFramework.framework (117 МБ).
 *
 * Здесь вся математика игры написана на чистом JavaScript и работает одинаково:
 * 1) Прямо в телефоне — когда вы играете на одном экране или с ботами;
 * 2) На сервере (server.js) — когда вы играете с друзьями онлайн по коду комнаты.
 */

(function (root, factory) {
  const boardDefault =
    typeof module === 'object' && module.exports
      ? require('./boardConfig.js')
      : root.DEFAULT_BOARD_CONFIG;

  const api = factory(boardDefault);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.MonopolyEngine = api;
  }
})(typeof self !== 'undefined' ? self : this, function (DEFAULT_CONFIG) {
  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /**
   * Создаёт новую партию
   * playersSetup: массив [{ id, name, tokenId, isBot }]
   */
  function createGame(playersSetup, customConfig) {
    const config = clone(customConfig || DEFAULT_CONFIG);
    const ownership = {}; // tileId -> { ownerId, houses: 0..5, mortgaged: false }

    const players = playersSetup.map((p, idx) => {
      const token =
        config.tokens.find((t) => t.id === p.tokenId) ||
        config.tokens[idx % config.tokens.length];
      return {
        id: p.id || 'p' + (idx + 1),
        name: (p.name || `Игрок ${idx + 1}`).trim().slice(0, 18),
        tokenId: token.id,
        emoji: token.emoji,
        color: token.color,
        isBot: !!p.isBot,
        money: Number(config.meta.startingCash) || 15000,
        position: 0,
        inJail: false,
        jailTurns: 0,
        jailCards: 0,
        bankrupt: false
      };
    });

    const state = {
      config,
      players,
      ownership,
      currentPlayerIndex: 0,
      turnNumber: 1,
      turnPhase: 'PRE_ROLL', // PRE_ROLL | BUY_DECISION | AUCTION | DEBT | END_TURN | GAME_OVER
      doublesCount: 0,
      extraRollGranted: false,
      lastDice: [1, 1],
      freeParkingPot: 0,
      debtTo: null, // playerId или 'bank'
      pendingBuyTileId: null,
      auction: null,
      pendingTrade: null,
      winnerId: null,
      chanceDeck: shuffle(config.chanceCards.map((_, i) => i)),
      chestDeck: shuffle(config.chestCards.map((_, i) => i)),
      lastEvent: {
        seq: 1,
        type: 'GAME_START',
        text: 'Партия началась! Удачных сделок!'
      },
      logs: ['🎲 Партия началась! Стартовый капитал: ' + formatMoney(config.meta.startingCash, config)]
    };

    return state;
  }

  function formatMoney(amount, config) {
    const cur = (config && config.meta && config.meta.currency) || '₽';
    const sign = amount < 0 ? '−' : '';
    return sign + Math.abs(Math.round(amount)).toLocaleString('ru-RU') + ' ' + cur;
  }

  function addLog(state, msg) {
    state.logs.unshift(msg);
    if (state.logs.length > 60) state.logs.length = 60;
  }

  function emitEvent(state, type, payload) {
    const seq = (state.lastEvent ? state.lastEvent.seq : 0) + 1;
    state.lastEvent = Object.assign({ seq, type }, payload || {});
  }

  function getPlayer(state, playerId) {
    return state.players.find((p) => p.id === playerId) || null;
  }

  function getCurrentPlayer(state) {
    return state.players[state.currentPlayerIndex];
  }

  function getGroupTiles(config, group) {
    return config.tiles.filter((t) => t.type === 'property' && t.group === group);
  }

  function ownsFullGroup(state, ownerId, group) {
    const groupTiles = getGroupTiles(state.config, group);
    if (!groupTiles.length) return false;
    return groupTiles.every((t) => {
      const own = state.ownership[t.id];
      return own && own.ownerId === ownerId && !own.mortgaged;
    });
  }

  function calculateRent(state, tile, diceSum) {
    const own = state.ownership[tile.id];
    if (!own || !own.ownerId || own.mortgaged) return 0;

    if (tile.type === 'property') {
      const houses = own.houses || 0;
      if (houses > 0) {
        return tile.rent[Math.min(houses, 5)];
      }
      const base = tile.rent[0];
      return ownsFullGroup(state, own.ownerId, tile.group) ? base * 2 : base;
    }

    if (tile.type === 'railroad') {
      const count = state.config.tiles.filter((t) => {
        if (t.type !== 'railroad') return false;
        const o = state.ownership[t.id];
        return o && o.ownerId === own.ownerId && !o.mortgaged;
      }).length;
      return tile.rent[Math.max(0, Math.min(3, count - 1))] || 250;
    }

    if (tile.type === 'utility') {
      const count = state.config.tiles.filter((t) => {
        if (t.type !== 'utility') return false;
        const o = state.ownership[t.id];
        return o && o.ownerId === own.ownerId && !o.mortgaged;
      }).length;
      const mult = count >= 2 ? 10 : 4;
      return (diceSum || 7) * mult * 10; // В масштабе цен ×10: ×40 или ×100 от суммы кубиков
    }

    return 0;
  }

  function canBuildHouse(state, playerId, tileId) {
    const tile = state.config.tiles[tileId];
    if (!tile || tile.type !== 'property') return { ok: false, reason: 'Не улица' };
    const own = state.ownership[tileId];
    if (!own || own.ownerId !== playerId) return { ok: false, reason: 'Не ваш участок' };
    if (own.mortgaged) return { ok: false, reason: 'Участок в залоге' };
    if (own.houses >= 5) return { ok: false, reason: 'Уже стоит Отель' };

    const groupTiles = getGroupTiles(state.config, tile.group);
    const hasAll = groupTiles.every((t) => {
      const o = state.ownership[t.id];
      return o && o.ownerId === playerId && !o.mortgaged;
    });
    if (!hasAll) return { ok: false, reason: 'Соберите все улицы этого цвета (без залога)' };

    // Правило равномерной застройки
    const minHouses = Math.min(...groupTiles.map((t) => state.ownership[t.id].houses || 0));
    if (own.houses > minHouses) {
      return { ok: false, reason: 'Стройте дома равномерно по району' };
    }

    const player = getPlayer(state, playerId);
    if (!player || player.money < tile.houseCost) {
      return { ok: false, reason: 'Недостаточно средств' };
    }
    return { ok: true };
  }

  function canSellHouse(state, playerId, tileId) {
    const tile = state.config.tiles[tileId];
    if (!tile || tile.type !== 'property') return { ok: false, reason: 'Не улица' };
    const own = state.ownership[tileId];
    if (!own || own.ownerId !== playerId || !own.houses) return { ok: false, reason: 'Нет построек' };

    const groupTiles = getGroupTiles(state.config, tile.group);
    const maxHouses = Math.max(...groupTiles.map((t) => (state.ownership[t.id] ? state.ownership[t.id].houses : 0)));
    if (own.houses < maxHouses) {
      return { ok: false, reason: 'Продавайте дома равномерно по району' };
    }
    return { ok: true };
  }

  function canMortgage(state, playerId, tileId) {
    const tile = state.config.tiles[tileId];
    const own = state.ownership[tileId];
    if (!tile || !own || own.ownerId !== playerId) return { ok: false, reason: 'Не ваш участок' };
    if (own.mortgaged) return { ok: false, reason: 'Уже в залоге' };
    if (tile.type === 'property') {
      const groupTiles = getGroupTiles(state.config, tile.group);
      const anyHouses = groupTiles.some((t) => state.ownership[t.id] && state.ownership[t.id].houses > 0);
      if (anyHouses) return { ok: false, reason: 'Сначала продайте дома в этом районе' };
    }
    return { ok: true };
  }

  function checkDebtOrFinishStep(state, creditorId) {
    const cur = getCurrentPlayer(state);
    if (cur.money < 0) {
      state.turnPhase = 'DEBT';
      state.debtTo = creditorId || 'bank';
      addLog(state, `⚠️ У ${cur.name} долг ${formatMoney(Math.abs(cur.money), state.config)}! Заложите участки или продайте дома.`);
      return;
    }
    state.debtTo = null;
    if (state.extraRollGranted && !cur.inJail) {
      state.turnPhase = 'PRE_ROLL';
    } else {
      state.turnPhase = 'END_TURN';
    }
  }

  function sendToJail(state, player, reasonText) {
    player.position = 10;
    player.inJail = true;
    player.jailTurns = 0;
    state.extraRollGranted = false;
    state.doublesCount = 0;
    state.turnPhase = 'END_TURN';
    addLog(state, `🚓 ${player.name} отправляется в Тюрьму (${reasonText}).`);
  }

  function buildPath(fromPos, toPos) {
    const path = [];
    let p = fromPos;
    while (p !== toPos) {
      p = (p + 1) % 40;
      path.push(p);
      if (path.length > 42) break;
    }
    return path;
  }

  function resolveLanding(state, player, diceSum, walkPath, cardInfo) {
    const tile = state.config.tiles[player.position];

    if (tile.type === 'go') {
      emitEvent(state, 'MOVE', { playerId: player.id, dice: state.lastDice, path: walkPath, card: cardInfo });
      checkDebtOrFinishStep(state, 'bank');
      return;
    }

    if (tile.type === 'property' || tile.type === 'railroad' || tile.type === 'utility') {
      const own = state.ownership[tile.id];
      if (!own || !own.ownerId) {
        state.turnPhase = 'BUY_DECISION';
        state.pendingBuyTileId = tile.id;
        emitEvent(state, 'LAND_UNOWNED', {
          playerId: player.id,
          tileId: tile.id,
          dice: state.lastDice,
          path: walkPath,
          card: cardInfo
        });
        return;
      }

      if (own.ownerId !== player.id && !own.mortgaged) {
        const owner = getPlayer(state, own.ownerId);
        let rent = calculateRent(state, tile, diceSum);
        if (cardInfo && cardInfo.doubleRailroad && tile.type === 'railroad') {
          rent *= 2;
        }
        player.money -= rent;
        if (owner) owner.money += rent;
        addLog(
          state,
          `💸 ${player.name} платит аренду ${formatMoney(rent, state.config)} игроку ${owner ? owner.name : ''} за «${tile.name}».`
        );
        emitEvent(state, 'PAY_RENT', {
          playerId: player.id,
          ownerId: own.ownerId,
          tileId: tile.id,
          amount: rent,
          dice: state.lastDice,
          path: walkPath,
          card: cardInfo
        });
        checkDebtOrFinishStep(state, own.ownerId);
        return;
      }

      emitEvent(state, 'MOVE', { playerId: player.id, dice: state.lastDice, path: walkPath, card: cardInfo });
      checkDebtOrFinishStep(state, 'bank');
      return;
    }

    if (tile.type === 'tax') {
      const tax = tile.amount || 1000;
      player.money -= tax;
      if (state.config.meta.freeParkingJackpot) {
        state.freeParkingPot += tax;
      }
      addLog(state, `🧾 ${player.name} оплачивает «${tile.name}»: ${formatMoney(tax, state.config)}.`);
      emitEvent(state, 'TAX', { playerId: player.id, amount: tax, dice: state.lastDice, path: walkPath, card: cardInfo });
      checkDebtOrFinishStep(state, 'bank');
      return;
    }

    if (tile.type === 'parking') {
      if (state.config.meta.freeParkingJackpot && state.freeParkingPot > 0) {
        const pot = state.freeParkingPot;
        state.freeParkingPot = 0;
        player.money += pot;
        addLog(state, `🎉 ${player.name} срывает куш на Бесплатной парковке: +${formatMoney(pot, state.config)}!`);
      }
      emitEvent(state, 'MOVE', { playerId: player.id, dice: state.lastDice, path: walkPath, card: cardInfo });
      checkDebtOrFinishStep(state, 'bank');
      return;
    }

    if (tile.type === 'jail') {
      emitEvent(state, 'MOVE', { playerId: player.id, dice: state.lastDice, path: walkPath, card: cardInfo });
      checkDebtOrFinishStep(state, 'bank');
      return;
    }

    if (tile.type === 'gotojail') {
      sendToJail(state, player, 'клетка «В тюрьму!»');
      emitEvent(state, 'GOTO_JAIL', { playerId: player.id, dice: state.lastDice, path: walkPath });
      return;
    }

    if (tile.type === 'chance' || tile.type === 'chest') {
      const isChance = tile.type === 'chance';
      const deckKey = isChance ? 'chanceDeck' : 'chestDeck';
      const list = isChance ? state.config.chanceCards : state.config.chestCards;
      if (!state[deckKey] || state[deckKey].length === 0) {
        state[deckKey] = shuffle(list.map((_, i) => i));
      }
      const cardIdx = state[deckKey].shift();
      const card = list[cardIdx] || list[0];
      const drawnCard = {
        deck: isChance ? 'ШАНС' : 'КАЗНА',
        text: card.text
      };
      addLog(state, `${isChance ? '❓ Шанс' : '📦 Казна'} (${player.name}): «${card.text}»`);

      if (card.action === 'money') {
        player.money += card.amount;
        if (card.amount < 0 && state.config.meta.freeParkingJackpot) {
          state.freeParkingPot += Math.abs(card.amount);
        }
        emitEvent(state, 'CARD', { playerId: player.id, dice: state.lastDice, path: walkPath, card: drawnCard });
        checkDebtOrFinishStep(state, 'bank');
        return;
      }

      if (card.action === 'jailFree') {
        player.jailCards += 1;
        state[deckKey].push(cardIdx);
        emitEvent(state, 'CARD', { playerId: player.id, dice: state.lastDice, path: walkPath, card: drawnCard });
        checkDebtOrFinishStep(state, 'bank');
        return;
      }

      if (card.action === 'gotoJail') {
        state[deckKey].push(cardIdx);
        sendToJail(state, player, 'карточка');
        emitEvent(state, 'CARD', { playerId: player.id, dice: state.lastDice, path: walkPath, card: drawnCard });
        return;
      }

      if (card.action === 'repairs') {
        state[deckKey].push(cardIdx);
        let cost = 0;
        Object.keys(state.ownership).forEach((tId) => {
          const o = state.ownership[tId];
          if (o && o.ownerId === player.id && o.houses > 0) {
            if (o.houses === 5) cost += card.hotel || 1000;
            else cost += o.houses * (card.house || 250);
          }
        });
        player.money -= cost;
        if (cost > 0) {
          addLog(state, `🔧 Ремонт обошёлся ${player.name} в ${formatMoney(cost, state.config)}.`);
        }
        emitEvent(state, 'CARD', { playerId: player.id, dice: state.lastDice, path: walkPath, card: drawnCard });
        checkDebtOrFinishStep(state, 'bank');
        return;
      }

      if (card.action === 'payEach') {
        state[deckKey].push(cardIdx);
        let total = 0;
        state.players.forEach((other) => {
          if (other.id !== player.id && !other.bankrupt) {
            other.money += card.amount;
            total += card.amount;
          }
        });
        player.money -= total;
        emitEvent(state, 'CARD', { playerId: player.id, dice: state.lastDice, path: walkPath, card: drawnCard });
        checkDebtOrFinishStep(state, 'bank');
        return;
      }

      if (card.action === 'collectEach') {
        state[deckKey].push(cardIdx);
        let total = 0;
        state.players.forEach((other) => {
          if (other.id !== player.id && !other.bankrupt) {
            const give = Math.min(Math.max(0, other.money), card.amount);
            other.money -= give;
            total += give;
          }
        });
        player.money += total;
        emitEvent(state, 'CARD', { playerId: player.id, dice: state.lastDice, path: walkPath, card: drawnCard });
        checkDebtOrFinishStep(state, 'bank');
        return;
      }

      if (card.action === 'moveTo') {
        state[deckKey].push(cardIdx);
        const oldPos = player.position;
        const target = card.target;
        if (target < oldPos) {
          player.money += state.config.meta.goSalary;
          addLog(state, `🏁 ${player.name} проходит «СТАРТ» и получает +${formatMoney(state.config.meta.goSalary, state.config)}!`);
        }
        const extraPath = buildPath(oldPos, target);
        player.position = target;
        resolveLanding(state, player, diceSum, walkPath.concat(extraPath), drawnCard);
        return;
      }

      if (card.action === 'nearestRailroad') {
        state[deckKey].push(cardIdx);
        const railroads = [5, 15, 25, 35];
        const oldPos = player.position;
        let target = railroads.find((r) => r > oldPos);
        if (target === undefined) {
          target = railroads[0];
          player.money += state.config.meta.goSalary;
          addLog(state, `🏁 ${player.name} проходит «СТАРТ» и получает +${formatMoney(state.config.meta.goSalary, state.config)}!`);
        }
        const extraPath = buildPath(oldPos, target);
        player.position = target;
        resolveLanding(state, player, diceSum, walkPath.concat(extraPath), Object.assign({ doubleRailroad: true }, drawnCard));
        return;
      }

      if (card.action === 'moveSteps') {
        state[deckKey].push(cardIdx);
        const target = (player.position + card.steps + 40) % 40;
        player.position = target;
        resolveLanding(state, player, diceSum, walkPath.concat([target]), drawnCard);
        return;
      }
    }

    checkDebtOrFinishStep(state, 'bank');
  }

  function advanceToNextPlayer(state) {
    const alive = state.players.filter((p) => !p.bankrupt);
    if (alive.length <= 1) {
      state.turnPhase = 'GAME_OVER';
      state.winnerId = alive[0] ? alive[0].id : null;
      if (alive[0]) {
        addLog(state, `🏆 ПОБЕДА! ${alive[0].name} становится главным монополистом!`);
        emitEvent(state, 'GAME_OVER', { winnerId: alive[0].id, winnerName: alive[0].name });
      }
      return;
    }

    let nextIdx = state.currentPlayerIndex;
    for (let i = 0; i < state.players.length; i++) {
      nextIdx = (nextIdx + 1) % state.players.length;
      if (!state.players[nextIdx].bankrupt) break;
    }
    if (nextIdx <= state.currentPlayerIndex) {
      state.turnNumber += 1;
    }
    state.currentPlayerIndex = nextIdx;
    state.turnPhase = 'PRE_ROLL';
    state.doublesCount = 0;
    state.extraRollGranted = false;
    state.pendingBuyTileId = null;
    state.debtTo = null;
    emitEvent(state, 'NEXT_TURN', { playerId: state.players[nextIdx].id });
  }

  function finishAuctionIfReady(state) {
    const auc = state.auction;
    if (!auc) return;

    if (auc.activeBidders.length === 0) {
      const tile = state.config.tiles[auc.tileId];
      addLog(state, `🔨 На аукционе за «${tile.name}» никто не сделал ставку.`);
      state.auction = null;
      checkDebtOrFinishStep(state, 'bank');
      return;
    }

    if (auc.activeBidders.length === 1 && auc.highestBidderId === auc.activeBidders[0]) {
      const winner = getPlayer(state, auc.highestBidderId);
      const tile = state.config.tiles[auc.tileId];
      if (winner) {
        winner.money -= auc.currentBid;
        state.ownership[auc.tileId] = { ownerId: winner.id, houses: 0, mortgaged: false };
        addLog(state, `🔨 ${winner.name} выигрывает аукцион за «${tile.name}» по цене ${formatMoney(auc.currentBid, state.config)}!`);
        emitEvent(state, 'AUCTION_WON', { playerId: winner.id, tileId: auc.tileId, amount: auc.currentBid });
      }
      state.auction = null;
      checkDebtOrFinishStep(state, 'bank');
    }
  }

  /**
   * ГЛАВНЫЙ ОБРАБОТЧИК ДЕЙСТВИЙ ИГРОКОВ
   * action: { type, playerId, ... }
   */
  function applyAction(state, action) {
    if (state.turnPhase === 'GAME_OVER') {
      return { ok: false, error: 'Партия уже завершена' };
    }

    const actor = getPlayer(state, action.playerId);
    if (!actor || actor.bankrupt) {
      return { ok: false, error: 'Игрок не найден' };
    }

    const current = getCurrentPlayer(state);

    // --- ОТВЕТ НА ПРЕДЛОЖЕНИЕ ОБМЕНА (может сделать адресат сделки) ---
    if (action.type === 'respondTrade') {
      const trade = state.pendingTrade;
      if (!trade || trade.toId !== actor.id) {
        return { ok: false, error: 'Нет активного предложения для вас' };
      }
      const proposer = getPlayer(state, trade.fromId);
      const target = getPlayer(state, trade.toId);
      state.pendingTrade = null;

      if (!action.accept) {
        addLog(state, `🤝 ${target.name} отклоняет предложение обмена от ${proposer.name}.`);
        emitEvent(state, 'TRADE_DECLINED', { fromId: proposer.id, toId: target.id });
        return { ok: true };
      }

      // Проверка актуальности ресурсов перед сделкой
      if (proposer.money < trade.offerCash || target.money < trade.requestCash) {
        return { ok: false, error: 'У одной из сторон изменился баланс' };
      }
      for (const tId of trade.offerTiles) {
        if (!state.ownership[tId] || state.ownership[tId].ownerId !== proposer.id) {
          return { ok: false, error: 'Участки сделки изменились' };
        }
      }
      for (const tId of trade.requestTiles) {
        if (!state.ownership[tId] || state.ownership[tId].ownerId !== target.id) {
          return { ok: false, error: 'Участки сделки изменились' };
        }
      }

      proposer.money = proposer.money - trade.offerCash + trade.requestCash;
      target.money = target.money - trade.requestCash + trade.offerCash;
      trade.offerTiles.forEach((tId) => {
        state.ownership[tId].ownerId = target.id;
      });
      trade.requestTiles.forEach((tId) => {
        state.ownership[tId].ownerId = proposer.id;
      });

      addLog(state, `🤝 СДЕЛКА! ${proposer.name} и ${target.name} успешно обменялись активами!`);
      emitEvent(state, 'TRADE_ACCEPTED', { fromId: proposer.id, toId: target.id });

      if (state.turnPhase === 'DEBT' && current.money >= 0) {
        checkDebtOrFinishStep(state, 'bank');
      }
      return { ok: true };
    }

    if (action.type === 'cancelTrade') {
      if (state.pendingTrade && state.pendingTrade.fromId === actor.id) {
        state.pendingTrade = null;
        emitEvent(state, 'TRADE_CANCELLED', {});
        return { ok: true };
      }
      return { ok: false, error: 'Нечего отменять' };
    }

    // --- СТАВКИ НА АУКЦИОНЕ ---
    if (state.turnPhase === 'AUCTION') {
      const auc = state.auction;
      const expectedBidderId = auc.activeBidders[auc.turnIndex % auc.activeBidders.length];
      if (actor.id !== expectedBidderId) {
        return { ok: false, error: 'Сейчас очередь другого участника аукциона' };
      }

      if (action.type === 'bid') {
        const raise = Number(action.raise) || 100;
        const nextBid = auc.highestBidderId ? auc.currentBid + raise : Math.max(auc.currentBid, raise);
        if (actor.money < nextBid) {
          return { ok: false, error: 'Недостаточно денег для ставки' };
        }
        auc.currentBid = nextBid;
        auc.highestBidderId = actor.id;
        auc.turnIndex = (auc.turnIndex + 1) % auc.activeBidders.length;
        emitEvent(state, 'AUCTION_BID', { playerId: actor.id, amount: nextBid });
        finishAuctionIfReady(state);
        return { ok: true };
      }

      if (action.type === 'passAuction') {
        const idx = auc.activeBidders.indexOf(actor.id);
        if (idx !== -1) {
          auc.activeBidders.splice(idx, 1);
          if (auc.turnIndex >= auc.activeBidders.length) {
            auc.turnIndex = 0;
          }
        }
        emitEvent(state, 'AUCTION_PASS', { playerId: actor.id });
        finishAuctionIfReady(state);
        return { ok: true };
      }

      return { ok: false, error: 'Сначала завершите аукцион' };
    }

    // Все остальные ходовые действия может делать только текущий активный игрок
    if (actor.id !== current.id) {
      return { ok: false, error: 'Сейчас ход другого игрока' };
    }

    // --- ОПЛАТА ЗАЛОГА / КАРТОЧКА В ТЮРЬМЕ ---
    if (action.type === 'payBail') {
      if (!actor.inJail || state.turnPhase !== 'PRE_ROLL') {
        return { ok: false, error: 'Вы не в тюрьме' };
      }
      const bail = state.config.meta.jailBail || 500;
      if (actor.money < bail) {
        return { ok: false, error: 'Недостаточно средств для залога' };
      }
      actor.money -= bail;
      actor.inJail = false;
      actor.jailTurns = 0;
      addLog(state, `🔓 ${actor.name} вносит залог ${formatMoney(bail, state.config)} и выходит на свободу.`);
      emitEvent(state, 'JAIL_FREE', { playerId: actor.id });
      return { ok: true };
    }

    if (action.type === 'useJailCard') {
      if (!actor.inJail || actor.jailCards <= 0 || state.turnPhase !== 'PRE_ROLL') {
        return { ok: false, error: 'Нет карточки освобождения' };
      }
      actor.jailCards -= 1;
      actor.inJail = false;
      actor.jailTurns = 0;
      addLog(state, `🎫 ${actor.name} использует карточку «Освобождение из тюрьмы»!`);
      emitEvent(state, 'JAIL_FREE', { playerId: actor.id });
      return { ok: true };
    }

    // --- БРОСОК КУБИКОВ ---
    if (action.type === 'roll') {
      if (state.turnPhase !== 'PRE_ROLL') {
        return { ok: false, error: 'Сейчас нельзя бросать кубики' };
      }

      const d1 = 1 + Math.floor(Math.random() * 6);
      const d2 = 1 + Math.floor(Math.random() * 6);
      const sum = d1 + d2;
      const isDouble = d1 === d2;
      state.lastDice = [d1, d2];

      if (actor.inJail) {
        if (isDouble) {
          actor.inJail = false;
          actor.jailTurns = 0;
          state.extraRollGranted = false;
          addLog(state, `🎲 ${actor.name} выбрасывает дубль (${d1}:${d2}) и выходит из Тюрьмы!`);
        } else {
          actor.jailTurns += 1;
          if (actor.jailTurns >= 3) {
            const bail = state.config.meta.jailBail || 500;
            actor.money -= bail;
            actor.inJail = false;
            actor.jailTurns = 0;
            addLog(state, `🔓 3-я попытка (${d1}:${d2}): ${actor.name} оплачивает штраф ${formatMoney(bail, state.config)} и делает ход.`);
          } else {
            addLog(state, `🔒 ${actor.name} выбрасывает ${d1}:${d2} — остаётся в Тюрьме (попытка ${actor.jailTurns}/3).`);
            state.turnPhase = 'END_TURN';
            emitEvent(state, 'JAIL_STAY', { playerId: actor.id, dice: [d1, d2] });
            return { ok: true };
          }
        }
      } else {
        if (isDouble) {
          state.doublesCount += 1;
          if (state.doublesCount >= 3) {
            sendToJail(state, actor, '3 дубля подряд');
            emitEvent(state, 'GOTO_JAIL', { playerId: actor.id, dice: [d1, d2], path: [10] });
            return { ok: true };
          }
          state.extraRollGranted = true;
        } else {
          state.extraRollGranted = false;
        }
      }

      const oldPos = actor.position;
      const newPos = (oldPos + sum) % 40;
      const walkPath = buildPath(oldPos, newPos);
      if (oldPos + sum >= 40) {
        actor.money += state.config.meta.goSalary;
        addLog(state, `🏁 ${actor.name} проходит «СТАРТ» (+${formatMoney(state.config.meta.goSalary, state.config)}).`);
      }
      actor.position = newPos;
      const tile = state.config.tiles[newPos];
      addLog(state, `🎲 ${actor.name} выбрасывает ${d1}+${d2}=${sum}${isDouble ? ' (ДУБЛЬ!)' : ''} → «${tile.name}».`);
      resolveLanding(state, actor, sum, walkPath, null);
      return { ok: true };
    }

    // --- ПОКУПКА УЧАСТКА ИЛИ ОТПРАВКА НА АУКЦИОН ---
    if (action.type === 'buy') {
      if (state.turnPhase !== 'BUY_DECISION' || state.pendingBuyTileId === null) {
        return { ok: false, error: 'Нет участка для покупки' };
      }
      const tile = state.config.tiles[state.pendingBuyTileId];
      if (actor.money < tile.price) {
        return { ok: false, error: 'Недостаточно денег для покупки' };
      }
      actor.money -= tile.price;
      state.ownership[tile.id] = { ownerId: actor.id, houses: 0, mortgaged: false };
      state.pendingBuyTileId = null;
      addLog(state, `🏠 ${actor.name} покупает «${tile.name}» за ${formatMoney(tile.price, state.config)}!`);
      emitEvent(state, 'BOUGHT', { playerId: actor.id, tileId: tile.id, amount: tile.price });
      checkDebtOrFinishStep(state, 'bank');
      return { ok: true };
    }

    if (action.type === 'startAuction') {
      if (state.turnPhase !== 'BUY_DECISION' || state.pendingBuyTileId === null) {
        return { ok: false, error: 'Нет участка для аукциона' };
      }
      const tile = state.config.tiles[state.pendingBuyTileId];
      state.pendingBuyTileId = null;
      const startBid = Math.max(50, Math.round((tile.price * 0.25) / 50) * 50);
      const bidders = state.players.filter((p) => !p.bankrupt && p.money >= startBid).map((p) => p.id);

      if (bidders.length === 0) {
        addLog(state, `🔨 «${tile.name}» остаётся у банка.`);
        checkDebtOrFinishStep(state, 'bank');
        return { ok: true };
      }

      state.turnPhase = 'AUCTION';
      state.auction = {
        tileId: tile.id,
        currentBid: startBid,
        highestBidderId: null,
        activeBidders: bidders,
        turnIndex: 0
      };
      addLog(state, `🔨 Аукцион за «${tile.name}»! Стартовая цена: ${formatMoney(startBid, state.config)}.`);
      emitEvent(state, 'AUCTION_START', { tileId: tile.id, startBid });
      return { ok: true };
    }

    // --- ПОСТРОЙКА И ПРОДАЖА ДОМОВ / ЗАЛОГ ---
    if (action.type === 'buildHouse') {
      const check = canBuildHouse(state, actor.id, action.tileId);
      if (!check.ok) return { ok: false, error: check.reason };
      const tile = state.config.tiles[action.tileId];
      actor.money -= tile.houseCost;
      state.ownership[tile.id].houses += 1;
      const h = state.ownership[tile.id].houses;
      addLog(
        state,
        `🏗️ ${actor.name} строит ${h === 5 ? 'ОТЕЛЬ 🏨' : `дом №${h} 🏠`} на «${tile.name}» (−${formatMoney(tile.houseCost, state.config)}).`
      );
      emitEvent(state, 'BUILD', { playerId: actor.id, tileId: tile.id, houses: h });
      return { ok: true };
    }

    if (action.type === 'sellHouse') {
      const check = canSellHouse(state, actor.id, action.tileId);
      if (!check.ok) return { ok: false, error: check.reason };
      const tile = state.config.tiles[action.tileId];
      const refund = Math.floor(tile.houseCost / 2);
      state.ownership[tile.id].houses -= 1;
      actor.money += refund;
      addLog(state, `🏘️ ${actor.name} продаёт постройку на «${tile.name}» за +${formatMoney(refund, state.config)}.`);
      emitEvent(state, 'SELL_HOUSE', { playerId: actor.id, tileId: tile.id });
      if (state.turnPhase === 'DEBT' && actor.money >= 0) {
        checkDebtOrFinishStep(state, 'bank');
      }
      return { ok: true };
    }

    if (action.type === 'mortgage') {
      const check = canMortgage(state, actor.id, action.tileId);
      if (!check.ok) return { ok: false, error: check.reason };
      const tile = state.config.tiles[action.tileId];
      const loan = Math.floor(tile.price / 2);
      state.ownership[tile.id].mortgaged = true;
      actor.money += loan;
      addLog(state, `🏦 ${actor.name} закладывает «${tile.name}» и получает +${formatMoney(loan, state.config)}.`);
      emitEvent(state, 'MORTGAGE', { playerId: actor.id, tileId: tile.id });
      if (state.turnPhase === 'DEBT' && actor.money >= 0) {
        checkDebtOrFinishStep(state, 'bank');
      }
      return { ok: true };
    }

    if (action.type === 'unmortgage') {
      const tile = state.config.tiles[action.tileId];
      const own = state.ownership[action.tileId];
      if (!tile || !own || own.ownerId !== actor.id || !own.mortgaged) {
        return { ok: false, error: 'Участок не в залоге' };
      }
      const cost = Math.ceil((tile.price / 2) * 1.1);
      if (actor.money < cost) {
        return { ok: false, error: 'Недостаточно денег для выкупа' };
      }
      actor.money -= cost;
      own.mortgaged = false;
      addLog(state, `🔓 ${actor.name} выкупает «${tile.name}» из залога за ${formatMoney(cost, state.config)}.`);
      emitEvent(state, 'UNMORTGAGE', { playerId: actor.id, tileId: tile.id });
      return { ok: true };
    }

    // --- ПРЕДЛОЖЕНИЕ ОБМЕНА (ТОРГ) ---
    if (action.type === 'proposeTrade') {
      const target = getPlayer(state, action.toId);
      if (!target || target.bankrupt || target.id === actor.id) {
        return { ok: false, error: 'Некорректный партнёр для обмена' };
      }
      const offerCash = Math.max(0, Math.round(Number(action.offerCash) || 0));
      const requestCash = Math.max(0, Math.round(Number(action.requestCash) || 0));
      const offerTiles = Array.isArray(action.offerTiles) ? action.offerTiles.map(Number) : [];
      const requestTiles = Array.isArray(action.requestTiles) ? action.requestTiles.map(Number) : [];

      if (offerCash === 0 && requestCash === 0 && offerTiles.length === 0 && requestTiles.length === 0) {
        return { ok: false, error: 'Выберите хотя бы один актив для обмена' };
      }
      if (actor.money < offerCash) return { ok: false, error: 'У вас недостаточно денег для доплаты' };
      if (target.money < requestCash) return { ok: false, error: 'У партнёра нет такой суммы' };

      const validateTradedTiles = (tileIds, ownerId) => {
        for (const tId of tileIds) {
          const own = state.ownership[tId];
          const tile = state.config.tiles[tId];
          if (!own || own.ownerId !== ownerId) return 'Чужой участок в сделке';
          if (tile.type === 'property') {
            const grp = getGroupTiles(state.config, tile.group);
            if (grp.some((g) => state.ownership[g.id] && state.ownership[g.id].houses > 0)) {
              return `Сначала продайте дома в районе «${tile.name}»`;
            }
          }
        }
        return null;
      };

      const err1 = validateTradedTiles(offerTiles, actor.id);
      if (err1) return { ok: false, error: err1 };
      const err2 = validateTradedTiles(requestTiles, target.id);
      if (err2) return { ok: false, error: err2 };

      state.pendingTrade = {
        id: 'tr_' + Date.now(),
        fromId: actor.id,
        toId: target.id,
        offerCash,
        requestCash,
        offerTiles,
        requestTiles
      };
      addLog(state, `💼 ${actor.name} предлагает сделку игроку ${target.name}.`);
      emitEvent(state, 'TRADE_PROPOSED', { trade: state.pendingTrade });
      return { ok: true };
    }

    // --- ЗАВЕРШЕНИЕ ХОДА ---
    if (action.type === 'endTurn') {
      if (state.turnPhase !== 'END_TURN') {
        return { ok: false, error: 'Сначала завершите текущее действие' };
      }
      advanceToNextPlayer(state);
      return { ok: true };
    }

    // --- БАНКРОТСТВО ---
    if (action.type === 'declareBankruptcy') {
      actor.bankrupt = true;
      const creditor = state.debtTo && state.debtTo !== 'bank' ? getPlayer(state, state.debtTo) : null;

      Object.keys(state.ownership).forEach((tId) => {
        const own = state.ownership[tId];
        if (own && own.ownerId === actor.id) {
          if (creditor && !creditor.bankrupt) {
            own.houses = 0;
            own.ownerId = creditor.id;
          } else {
            delete state.ownership[tId];
          }
        }
      });

      if (creditor && actor.money > 0) {
        creditor.money += actor.money;
      }
      actor.money = 0;
      addLog(
        state,
        `💥 ${actor.name} объявляет себя банкротом! ${creditor ? `Активы переходят к ${creditor.name}.` : 'Участки возвращаются в банк.'}`
      );
      emitEvent(state, 'BANKRUPT', { playerId: actor.id });
      advanceToNextPlayer(state);
      return { ok: true };
    }

    return { ok: false, error: 'Неизвестное действие' };
  }

  /**
   * ==========================================================================
   * ИСКУССТВЕННЫЙ ИНТЕЛЛЕКТ БОТА
   * ==========================================================================
   * Возвращает следующее действие бота (или null, если сейчас очередь человека)
   */
  function computeBotAction(state) {
    if (!state || state.turnPhase === 'GAME_OVER') return null;

    // 1. Если висит предложение обмена боту — оцениваем выгоду!
    if (state.pendingTrade) {
      const target = getPlayer(state, state.pendingTrade.toId);
      if (target && target.isBot && !target.bankrupt) {
        const tr = state.pendingTrade;
        const valueTiles = (ids, receiverId) =>
          ids.reduce((acc, id) => {
            const t = state.config.tiles[id];
            const own = state.ownership[id];
            let base = t.price * (own && own.mortgaged ? 0.5 : 1.15);
            if (t.type === 'property') {
              const grp = getGroupTiles(state.config, t.group);
              const ownedByReceiver = grp.filter(
                (g) => state.ownership[g.id] && state.ownership[g.id].ownerId === receiverId
              ).length;
              if (ownedByReceiver + 1 === grp.length) base *= 1.65; // Даёт полную монополию!
            }
            return acc + base;
          }, 0);

        const gain = tr.offerCash + valueTiles(tr.offerTiles, target.id);
        const give = tr.requestCash + valueTiles(tr.requestTiles, target.id);
        const accept = gain >= give * 0.98 && target.money - tr.requestCash >= 300;
        return { type: 'respondTrade', playerId: target.id, accept };
      }
      return null;
    }

    // 2. Если идёт аукцион и очередь делать ставку за ботом
    if (state.turnPhase === 'AUCTION' && state.auction) {
      const auc = state.auction;
      const bidderId = auc.activeBidders[auc.turnIndex % auc.activeBidders.length];
      const bot = getPlayer(state, bidderId);
      if (!bot || !bot.isBot) return null;

      const tile = state.config.tiles[auc.tileId];
      let maxWilling = tile.price * 0.95;
      if (tile.type === 'property') {
        const grp = getGroupTiles(state.config, tile.group);
        const myInGrp = grp.filter((g) => state.ownership[g.id] && state.ownership[g.id].ownerId === bot.id).length;
        if (myInGrp >= 1) maxWilling = tile.price * 1.25;
      }
      maxWilling = Math.min(maxWilling, bot.money - 400);
      const nextBid = auc.highestBidderId ? auc.currentBid + 100 : auc.currentBid;

      if (auc.highestBidderId !== bot.id && nextBid <= maxWilling && bot.money >= nextBid) {
        return { type: 'bid', playerId: bot.id, raise: 100 };
      }
      return { type: 'passAuction', playerId: bot.id };
    }

    const cur = getCurrentPlayer(state);
    if (!cur || !cur.isBot || cur.bankrupt) return null;

    // 3. Перед броском
    if (state.turnPhase === 'PRE_ROLL') {
      if (cur.inJail) {
        if (cur.jailCards > 0) return { type: 'useJailCard', playerId: cur.id };
        const bail = state.config.meta.jailBail || 500;
        if (cur.money >= bail + 1500) return { type: 'payBail', playerId: cur.id };
      }
      return { type: 'roll', playerId: cur.id };
    }

    // 4. Решение о покупке
    if (state.turnPhase === 'BUY_DECISION') {
      const tile = state.config.tiles[state.pendingBuyTileId];
      if (tile && cur.money >= tile.price + 250) {
        return { type: 'buy', playerId: cur.id };
      }
      if (tile && cur.money >= tile.price && Math.random() < 0.75) {
        return { type: 'buy', playerId: cur.id };
      }
      return { type: 'startAuction', playerId: cur.id };
    }

    // 5. Погашение долга
    if (state.turnPhase === 'DEBT') {
      // Сначала продаём дома
      for (const t of state.config.tiles) {
        if (canSellHouse(state, cur.id, t.id).ok) {
          return { type: 'sellHouse', playerId: cur.id, tileId: t.id };
        }
      }
      // Затем закладываем участки
      for (const t of state.config.tiles) {
        if (canMortgage(state, cur.id, t.id).ok) {
          return { type: 'mortgage', playerId: cur.id, tileId: t.id };
        }
      }
      return { type: 'declareBankruptcy', playerId: cur.id };
    }

    // 6. Фаза завершения хода: выкупаем залоги и строим дома, если есть запас денег
    if (state.turnPhase === 'END_TURN') {
      for (const t of state.config.tiles) {
        const own = state.ownership[t.id];
        if (own && own.ownerId === cur.id && own.mortgaged) {
          const cost = Math.ceil((t.price / 2) * 1.1);
          if (cur.money >= cost + 2000) {
            return { type: 'unmortgage', playerId: cur.id, tileId: t.id };
          }
        }
      }
      for (const t of state.config.tiles) {
        if (canBuildHouse(state, cur.id, t.id).ok && cur.money >= t.houseCost + 1200) {
          return { type: 'buildHouse', playerId: cur.id, tileId: t.id };
        }
      }
      return { type: 'endTurn', playerId: cur.id };
    }

    return null;
  }

  return {
    createGame,
    applyAction,
    computeBotAction,
    calculateRent,
    canBuildHouse,
    canSellHouse,
    canMortgage,
    ownsFullGroup,
    formatMoney
  };
});
