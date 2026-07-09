"use client";

import { useEffect, useMemo, useState } from "react";

type Suit = "C" | "D" | "H" | "S";
type Rank =
  | "A"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "10"
  | "J"
  | "Q"
  | "K";

type Card = {
  id: string;
  rank: Rank;
  suit: Suit;
};

type Slot = {
  id: string;
  card: Card;
};

type Player = {
  id: string;
  name: string;
  slots: Slot[];
  turnsTaken: number;
  matchScore: number;
  roundScore?: number;
};

type HeldCard = {
  card: Card;
  source: "deck" | "discard";
};

type PowerState =
  | null
  | { kind: "peek"; actorId: string }
  | { kind: "blindSwap"; actorId: string; selected: CardRef[] }
  | { kind: "peekThenSwap"; actorId: string; step: "peek" | "swap"; selected: CardRef[] };

type CardRef = {
  playerId: string;
  slotId: string;
};

type GameState = {
  phase: "setup" | "initialPeek" | "playing" | "roundOver" | "matchOver";
  players: Player[];
  deck: Card[];
  discard: Card[];
  currentPlayer: number;
  viewerId: string;
  roundNumber: number;
  totalRounds: number;
  mode: "single" | "match";
  held: HeldCard | null;
  knowledge: Record<string, string[]>;
  peekIndex: number;
  pendingPower: PowerState;
  redCallerId: string | null;
  finalTurnsRemaining: string[];
  log: string[];
};

const ranks: Rank[] = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const suits: Suit[] = ["C", "D", "H", "S"];

const initialNames = ["Alex", "Blair", "Casey", "Devon"];

function buildDeck() {
  return ranks.flatMap((rank) => suits.map((suit) => ({ id: `${rank}-${suit}`, rank, suit })));
}

function shuffle<T>(items: T[]) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function cardValue(card: Card) {
  if (card.rank === "K") return -2;
  if (card.rank === "A") return 0;
  if (card.rank === "J" || card.rank === "Q") return 10;
  return Number(card.rank);
}

function isRed(card: Card) {
  return card.suit === "D" || card.suit === "H";
}

function suitSymbol(suit: Suit) {
  if (suit === "C") return "♣";
  if (suit === "D") return "♦";
  if (suit === "H") return "♥";
  return "♠";
}

function cardLabel(card: Card) {
  return `${card.rank}${suitSymbol(card.suit)}`;
}

function scoreSlots(slots: Slot[]) {
  return slots.reduce((total, slot) => total + cardValue(slot.card), 0);
}

function scoreBreakdown(slots: Slot[]) {
  return slots.map((slot) => `${cardLabel(slot.card)}=${cardValue(slot.card)}`).join(" + ");
}

function createRound(players: Player[], mode: "single" | "match", totalRounds: number, roundNumber: number): GameState {
  const deck = shuffle(buildDeck());
  const dealt = players.map((player, playerIndex) => ({
    ...player,
    turnsTaken: 0,
    roundScore: undefined,
    slots: [0, 1, 2, 3].map((slotIndex) => ({
      id: `${roundNumber}-${playerIndex}-${slotIndex}-${Math.random().toString(36).slice(2)}`,
      card: deck[playerIndex * 4 + slotIndex],
    })),
  }));
  const afterDeal = deck.slice(players.length * 4);
  const firstDiscard = afterDeal[0];
  const knowledge = Object.fromEntries(dealt.map((player) => [player.id, []]));

  return {
    phase: "initialPeek",
    players: dealt,
    deck: afterDeal.slice(1),
    discard: [firstDiscard],
    currentPlayer: 0,
    viewerId: dealt[0].id,
    roundNumber,
    totalRounds,
    mode,
    held: null,
    knowledge,
    peekIndex: 0,
    pendingPower: null,
    redCallerId: null,
    finalTurnsRemaining: [],
    log: [`Round ${roundNumber} started. ${cardLabel(firstDiscard)} opens the discard pile.`],
  };
}

function ensureDeck(state: GameState) {
  if (state.deck.length > 0) return state;
  if (state.discard.length <= 1) return state;
  const top = state.discard[state.discard.length - 1];
  return {
    ...state,
    deck: shuffle(state.discard.slice(0, -1)),
    discard: [top],
    log: ["Discard pile reshuffled into the deck.", ...state.log],
  };
}

function findSlot(players: Player[], ref: CardRef) {
  const playerIndex = players.findIndex((player) => player.id === ref.playerId);
  const slotIndex = players[playerIndex]?.slots.findIndex((slot) => slot.id === ref.slotId) ?? -1;
  return { playerIndex, slotIndex, slot: players[playerIndex]?.slots[slotIndex] };
}

function nextTurn(state: GameState) {
  const current = state.players[state.currentPlayer];
  const players = state.players.map((player) =>
    player.id === current.id ? { ...player, turnsTaken: player.turnsTaken + 1 } : player,
  );
  const finalTurnsRemaining =
    state.redCallerId && state.finalTurnsRemaining[0] === current.id
      ? state.finalTurnsRemaining.slice(1)
      : state.finalTurnsRemaining;

  if (state.redCallerId && finalTurnsRemaining.length === 0) {
    return finishRound({ ...state, players, finalTurnsRemaining, held: null, pendingPower: null });
  }

  let nextIndex = (state.currentPlayer + 1) % players.length;
  if (state.redCallerId) {
    const nextId = finalTurnsRemaining[0];
    nextIndex = Math.max(0, players.findIndex((player) => player.id === nextId));
  }

  return {
    ...state,
    players,
    finalTurnsRemaining,
    currentPlayer: nextIndex,
    viewerId: players[nextIndex].id,
    held: null,
    pendingPower: null,
    log: [`${players[nextIndex].name}'s turn.`, ...state.log],
  };
}

function finishRound(state: GameState) {
  const scored = state.players.map((player) => {
    const roundScore = scoreSlots(player.slots);
    return { ...player, roundScore, matchScore: player.matchScore + roundScore };
  });
  const lowRound = Math.min(...scored.map((player) => player.roundScore ?? 0));
  const winners = scored.filter((player) => player.roundScore === lowRound).map((player) => player.name).join(", ");
  const matchDone = state.mode === "single" || state.roundNumber >= state.totalRounds;

  return {
    ...state,
    players: scored,
    phase: matchDone ? "matchOver" : "roundOver",
    held: null,
    pendingPower: null,
    log: [`Round ${state.roundNumber} complete. Lowest round score: ${winners}.`, ...state.log],
  };
}

function addKnowledge(state: GameState, viewerId: string, card: Card) {
  const known = new Set(state.knowledge[viewerId] ?? []);
  known.add(card.id);
  return {
    ...state,
    knowledge: { ...state.knowledge, [viewerId]: [...known] },
  };
}

function forgetCard(state: GameState, viewerId: string, card: Card) {
  return {
    ...state,
    knowledge: {
      ...state.knowledge,
      [viewerId]: (state.knowledge[viewerId] ?? []).filter((cardId) => cardId !== card.id),
    },
  };
}

export default function Home() {
  const [playerCount, setPlayerCount] = useState(4);
  const [names, setNames] = useState(initialNames);
  const [mode, setMode] = useState<"single" | "match">("single");
  const [totalRounds, setTotalRounds] = useState(3);
  const [game, setGame] = useState<GameState | null>(null);
  const [blunder, setBlunder] = useState<{ id: number; message: string } | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [roomMessage, setRoomMessage] = useState("");
  const [clientId] = useState(() => {
    if (typeof window === "undefined") return "server";
    const existing = window.sessionStorage.getItem("red-client-id");
    if (existing) return existing;
    const next = crypto.randomUUID();
    window.sessionStorage.setItem("red-client-id", next);
    return next;
  });
  const [assignedPlayerId, setAssignedPlayerId] = useState("");

  const currentPlayer = game?.players[game.currentPlayer];
  const viewer = game?.players.find((player) => player.id === game.viewerId);
  const topDiscard = game?.discard[game.discard.length - 1] ?? null;
  const canSeeHeldCard = !roomCode || assignedPlayerId === currentPlayer?.id;
  const matchLeader = useMemo(() => {
    if (!game) return null;
    const low = Math.min(...game.players.map((player) => player.matchScore));
    return game.players.filter((player) => player.matchScore === low).map((player) => player.name).join(", ");
  }, [game]);

  useEffect(() => {
    if (!roomCode) return undefined;

    const interval = window.setInterval(async () => {
      try {
        const response = await fetch(`/api/red/rooms/${roomCode}`);
        if (!response.ok) return;
        const room = (await response.json()) as { game: GameState };
        setGame((current) => {
          if (!current) return room.game;
          const desiredViewer = assignedPlayerId || current.viewerId;
          const viewerStillExists = room.game.players.some((player) => player.id === desiredViewer);
          return { ...room.game, viewerId: viewerStillExists ? desiredViewer : room.game.viewerId };
        });
      } catch {
        // The next poll will try again.
      }
    }, 900);

    return () => window.clearInterval(interval);
  }, [assignedPlayerId, roomCode]);

  function commitGame(next: GameState) {
    setGame(next);
    if (!roomCode) return;
    void fetch(`/api/red/rooms/${roomCode}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ game: next }),
    }).catch(() => {
      setRoomMessage("Room sync missed. Your next move will try again.");
    });
  }

  function startGame() {
    const players = Array.from({ length: playerCount }, (_, index) => ({
      id: `p${index + 1}`,
      name: names[index]?.trim() || `Player ${index + 1}`,
      slots: [],
      turnsTaken: 0,
      matchScore: 0,
    }));
    setRoomCode("");
    setRoomMessage("");
    setAssignedPlayerId("");
    setGame(createRound(players, mode, mode === "single" ? 1 : totalRounds, 1));
  }

  async function createRoom() {
    const players = Array.from({ length: playerCount }, (_, index) => ({
      id: `p${index + 1}`,
      name: names[index]?.trim() || `Player ${index + 1}`,
      slots: [],
      turnsTaken: 0,
      matchScore: 0,
    }));
    const next = createRound(players, mode, mode === "single" ? 1 : totalRounds, 1);
    setRoomMessage("Creating room...");
    const response = await fetch("/api/red/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ game: next, clientId }),
    });
    if (!response.ok) {
      setRoomMessage("Could not create a room.");
      return;
    }
    const data = (await response.json()) as { code: string; playerId: string | null };
    setRoomCode(data.code);
    setAssignedPlayerId(data.playerId ?? "");
    setRoomMessage(`Room ${data.code} is ready. Open this site on another device and join with that code.`);
    setGame({ ...next, viewerId: data.playerId ?? next.viewerId });
  }

  async function joinRoom() {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    setRoomMessage("Joining room...");
    const response = await fetch(`/api/red/rooms/${code}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId }),
    });
    if (!response.ok) {
      setRoomMessage(response.status === 409 ? "Room is full." : "Room not found.");
      return;
    }
    const data = (await response.json()) as { playerId: string; room: { game: GameState } };
    setRoomCode(code);
    setAssignedPlayerId(data.playerId);
    setRoomMessage(`Joined room ${code}. You are ${data.room.game.players.find((player) => player.id === data.playerId)?.name ?? "a player"}.`);
    setGame({ ...data.room.game, viewerId: data.playerId });
  }

  function completeInitialPeek() {
    if (!game) return;
    const peeking = game.players[game.peekIndex];
    if (roomCode && assignedPlayerId !== peeking.id) return;
    const nextPeekIndex = game.peekIndex + 1;
    const donePeeking = nextPeekIndex >= game.players.length;
    commitGame({
      ...game,
      peekIndex: nextPeekIndex,
      viewerId: donePeeking ? game.players[0].id : game.players[nextPeekIndex].id,
      phase: donePeeking ? "playing" : "initialPeek",
      log:
        donePeeking
          ? ["All players peeked. The first turn begins.", ...game.log]
          : game.log,
    });
  }

  function flashBlunder(message: string) {
    const id = Date.now();
    setBlunder({ id, message });
    window.setTimeout(() => {
      setBlunder((current) => (current?.id === id ? null : current));
    }, 1100);
  }

  function drawFromDeck() {
    if (!game || game.held || game.pendingPower) return;
    if (roomCode && assignedPlayerId !== currentPlayer?.id) return;
    let ready = ensureDeck(game);
    if (ready.deck.length === 0) return;
    const card = ready.deck[0];
    ready = {
      ...ready,
      deck: ready.deck.slice(1),
      held: { card, source: "deck" },
      viewerId: currentPlayer?.id ?? ready.viewerId,
      log: [`${currentPlayer?.name} drew from the deck.`, ...ready.log],
    };
    if (currentPlayer) ready = addKnowledge(ready, currentPlayer.id, card);
    commitGame(ready);
  }

  function drawFromDiscard() {
    if (!game || game.held || game.pendingPower || game.discard.length === 0 || !currentPlayer) return;
    if (roomCode && assignedPlayerId !== currentPlayer.id) return;
    const card = game.discard[game.discard.length - 1];
    commitGame(
      addKnowledge(
        {
          ...game,
          discard: game.discard.slice(0, -1),
          held: { card, source: "discard" },
          viewerId: currentPlayer.id,
          log: [`${currentPlayer.name} took ${cardLabel(card)} from discard and must swap it.`, ...game.log],
        },
        currentPlayer.id,
        card,
      ),
    );
  }

  function discardHeld() {
    if (!game || !game.held || game.held.source !== "deck" || !currentPlayer) return;
    if (roomCode && assignedPlayerId !== currentPlayer.id) return;
    const discarded = game.held.card;
    const next = {
      ...game,
      discard: [...game.discard, discarded],
      held: null,
      log: [`${currentPlayer.name} discarded ${cardLabel(discarded)}.`, ...game.log],
    };
    if (discarded.rank === "7") {
      commitGame({ ...next, pendingPower: { kind: "peek", actorId: currentPlayer.id } });
      return;
    }
    if (discarded.rank === "8") {
      commitGame({ ...next, pendingPower: { kind: "blindSwap", actorId: currentPlayer.id, selected: [] } });
      return;
    }
    if (discarded.rank === "9") {
      commitGame({ ...next, pendingPower: { kind: "peekThenSwap", actorId: currentPlayer.id, step: "peek", selected: [] } });
      return;
    }
    commitGame(nextTurn(next));
  }

  function swapHeldWith(ref: CardRef) {
    if (!game || !game.held || !currentPlayer) return;
    if (roomCode && assignedPlayerId !== currentPlayer.id) return;
    const { playerIndex, slotIndex, slot } = findSlot(game.players, ref);
    if (playerIndex !== game.currentPlayer || slotIndex < 0) return;
    const oldValue = cardValue(slot.card);
    const newValue = cardValue(game.held.card);
    const players = game.players.map((player, index) => {
      if (index !== playerIndex) return player;
      const slots = player.slots.map((candidate, candidateIndex) =>
        candidateIndex === slotIndex ? { ...candidate, card: game.held!.card } : candidate,
      );
      return { ...player, slots };
    });
    const next = forgetCard(
      {
        ...game,
        players,
        discard: [...game.discard, slot.card],
        held: null,
        log: [`${currentPlayer.name} swapped into their grid and discarded ${cardLabel(slot.card)}.`, ...game.log],
      },
      currentPlayer.id,
      game.held.card,
    );
    if (newValue > oldValue) {
      flashBlunder(`Blunder: ${newValue} points replaced ${oldValue}.`);
    }
    commitGame(nextTurn(next));
  }

  function callRed() {
    if (!game || !currentPlayer || game.held || game.pendingPower || currentPlayer.turnsTaken < 5) return;
    if (roomCode && assignedPlayerId !== currentPlayer.id) return;
    const remaining = game.players
      .filter((player) => player.id !== currentPlayer.id)
      .slice(game.currentPlayer)
      .concat(game.players.filter((player) => player.id !== currentPlayer.id).slice(0, game.currentPlayer))
      .map((player) => player.id);
    const nextIndex = game.players.findIndex((player) => player.id === remaining[0]);
    commitGame({
      ...game,
      redCallerId: currentPlayer.id,
      finalTurnsRemaining: remaining,
      currentPlayer: Math.max(0, nextIndex),
      viewerId: remaining[0] ?? game.viewerId,
      log: [`${currentPlayer.name} called Red. Everyone else gets one final turn.`, ...game.log],
    });
  }

  function selectPowerCard(ref: CardRef) {
    if (!game || !game.pendingPower) return;
    if (roomCode && assignedPlayerId !== game.pendingPower.actorId) return;
    const { slot } = findSlot(game.players, ref);
    if (!slot) return;
    const actor = game.pendingPower.actorId;

    if (game.pendingPower.kind === "peek") {
      const next = addKnowledge(game, actor, slot.card);
      commitGame(nextTurn({ ...next, log: [`Power 7: ${playerName(game, actor)} peeked at one card.`, ...next.log] }));
      return;
    }

    if (game.pendingPower.kind === "blindSwap") {
      const selected = [...game.pendingPower.selected, ref];
      if (selected.length < 2) {
        commitGame({ ...game, pendingPower: { ...game.pendingPower, selected } });
        return;
      }
      commitGame(nextTurn(swapBoardCards({ ...game, pendingPower: null }, selected[0], selected[1], "Power 8: two cards were blind swapped.")));
      return;
    }

    if (game.pendingPower.kind === "peekThenSwap" && game.pendingPower.step === "peek") {
      const next = addKnowledge(game, actor, slot.card);
      commitGame({
        ...next,
        pendingPower: { kind: "peekThenSwap", actorId: actor, step: "swap", selected: [] },
        log: [`Power 9: ${playerName(game, actor)} peeked. Now choose two cards to swap.`, ...next.log],
      });
      return;
    }

    if (game.pendingPower.kind === "peekThenSwap" && game.pendingPower.step === "swap") {
      const selected = [...game.pendingPower.selected, ref];
      if (selected.length < 2) {
        commitGame({ ...game, pendingPower: { ...game.pendingPower, selected } });
        return;
      }
      commitGame(nextTurn(swapBoardCards({ ...game, pendingPower: null }, selected[0], selected[1], "Power 9: two cards were swapped.")));
    }
  }

  function stackCard(ref: CardRef) {
    if (!game || !topDiscard || game.held) return;
    if (roomCode && assignedPlayerId !== ref.playerId) return;
    if (ref.playerId !== game.viewerId) return;
    const { playerIndex, slotIndex, slot } = findSlot(game.players, ref);
    if (!slot || playerIndex < 0) return;
    if (slot.card.rank === topDiscard.rank) {
      const players = game.players.map((player, index) =>
        index === playerIndex
          ? { ...player, slots: player.slots.filter((_, candidateIndex) => candidateIndex !== slotIndex) }
          : player,
      );
      commitGame({
        ...game,
        players,
        discard: [...game.discard, slot.card],
        log: [`${game.players[playerIndex].name} stacked ${cardLabel(slot.card)} correctly and removed a card.`, ...game.log],
      });
      return;
    }

    let ready = ensureDeck(game);
    const penalty = ready.deck[0];
    if (!penalty) return;
    const penalized = ready.players.map((player, index) =>
      index === playerIndex
        ? {
            ...player,
            slots: [
              ...player.slots,
              {
                id: `${player.id}-penalty-${Math.random().toString(36).slice(2)}`,
                card: penalty,
              },
            ],
          }
        : player,
    );
    commitGame({
      ...ready,
      players: penalized,
      deck: ready.deck.slice(1),
      log: [
        `${ready.players[playerIndex].name} tried to stack ${cardLabel(slot.card)} on ${cardLabel(topDiscard)} and drew a penalty card.`,
        ...ready.log,
      ],
    });
  }

  function nextRound() {
    if (!game) return;
    commitGame(createRound(game.players, game.mode, game.totalRounds, game.roundNumber + 1));
  }

  function reset() {
    setRoomCode("");
    setRoomMessage("");
    setAssignedPlayerId("");
    setGame(null);
  }

  if (!game) {
    return (
      <main className="shell setup-shell">
        <section className="setup-panel">
          <div>
            <p className="eyebrow">Online room prototype</p>
            <h1>Red</h1>
            <p className="intro">
              A fast memory card game where low points win, stack calls are risky, and every face-down card
              might be exactly what you need.
            </p>
          </div>

          <div className="setup-grid">
            <label>
              Players
              <input
                type="number"
                min={2}
                max={6}
                value={playerCount}
                onChange={(event) => setPlayerCount(Math.max(2, Math.min(6, Number(event.target.value))))}
              />
            </label>
            <label>
              Mode
              <select value={mode} onChange={(event) => setMode(event.target.value as "single" | "match")}>
                <option value="single">Single round</option>
                <option value="match">X-round match</option>
              </select>
            </label>
            <label>
              Match rounds
              <input
                type="number"
                min={2}
                max={12}
                disabled={mode === "single"}
                value={totalRounds}
                onChange={(event) => setTotalRounds(Math.max(2, Math.min(12, Number(event.target.value))))}
              />
            </label>
          </div>

          <div className="names-grid">
            {Array.from({ length: playerCount }, (_, index) => (
              <label key={index}>
                Player {index + 1}
                <input
                  value={names[index] ?? ""}
                  onChange={(event) => {
                    const next = [...names];
                    next[index] = event.target.value;
                    setNames(next);
                  }}
                />
              </label>
            ))}
          </div>

          <button className="primary" onClick={startGame}>
            Deal local game
          </button>

          <div className="room-tools">
            <button className="secondary" onClick={createRoom}>
              Create online room
            </button>
            <div className="join-row">
              <input
                value={joinCode}
                maxLength={5}
                placeholder="Room code"
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
              />
              <button className="ghost" onClick={joinRoom}>
                Join
              </button>
            </div>
            {roomMessage && <p>{roomMessage}</p>}
          </div>
        </section>
      </main>
    );
  }

  if (game.phase === "initialPeek") {
    const peeking = game.players[game.peekIndex];
    const isMyPeek = !roomCode || assignedPlayerId === peeking.id;
    if (!isMyPeek) {
      return (
        <main className="shell peek-shell">
          <section className="peek-panel">
            <p className="eyebrow">Waiting</p>
            <h1>{peeking.name} is looking at their bottom two cards</h1>
            <p className="intro">Your cards stay hidden. Your device will update when it is your turn to peek or play.</p>
            {roomCode && <p className="room-note">Room {roomCode}</p>}
          </section>
        </main>
      );
    }
    return (
      <main className="shell peek-shell">
        <section className="peek-panel">
          <p className="eyebrow">Opening memory</p>
          <h1>{peeking.name}, look at your bottom two cards once</h1>
          <div className="player-board focus-board">
            {peeking.slots.map((slot, index) => (
              <CardFace key={slot.id} card={slot.card} visible={index >= 2} compact={false} />
            ))}
          </div>
          <button className="primary" onClick={completeInitialPeek}>
            I memorized them
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="shell table-shell">
      {blunder && <div className="blunder-flash">{blunder.message}</div>}
      <header className="topbar">
        <div>
          <p className="eyebrow">Round {game.roundNumber} of {game.totalRounds}</p>
          <h1>Red</h1>
        </div>
        <div className="status-strip">
          <span>Turn: {currentPlayer?.name}</span>
          <span>Deck: {game.deck.length}</span>
          <span>Leader: {matchLeader}</span>
          {roomCode && <span>Room: {roomCode}</span>}
        </div>
        <button className="ghost" onClick={reset}>
          New game
        </button>
      </header>

      <section className="table-grid">
        <aside className="side-panel">
          {roomCode ? (
            <div className="identity-card">
              <p className="mini-label">You are</p>
              <strong>{viewer?.name}</strong>
              <span>Room {roomCode}</span>
            </div>
          ) : (
            <label>
              Viewing as
              <select value={game.viewerId} onChange={(event) => setGame({ ...game, viewerId: event.target.value })}>
                {game.players.map((player) => (
                  <option key={player.id} value={player.id}>{player.name}</option>
                ))}
              </select>
            </label>
          )}

          <div className="pile-row">
            <div>
              <p className="mini-label">Deck</p>
              <button className="deck-card" onClick={drawFromDeck} disabled={game.phase !== "playing" || !!game.held || !!game.pendingPower || (roomCode ? assignedPlayerId !== currentPlayer?.id : false)}>
                {game.deck.length}
              </button>
            </div>
            <div>
              <p className="mini-label">Discard</p>
              <button className="discard-card" onClick={drawFromDiscard} disabled={game.phase !== "playing" || !!game.held || !!game.pendingPower || !topDiscard || (roomCode ? assignedPlayerId !== currentPlayer?.id : false)}>
                {topDiscard ? <CardFace card={topDiscard} visible compact /> : "Empty"}
              </button>
            </div>
          </div>

          {game.held && (
            <div className="held-panel">
              <p className="mini-label">{canSeeHeldCard ? "Drawn card" : `${currentPlayer?.name} drew a card`}</p>
              <CardFace card={game.held.card} visible={canSeeHeldCard} compact={false} />
              {canSeeHeldCard && game.held.source === "deck" && (
                <button className="secondary" onClick={discardHeld}>
                  Discard it
                </button>
              )}
              <p>
                {canSeeHeldCard
                  ? `Choose one of ${currentPlayer?.name}'s cards to swap.`
                  : `Waiting for ${currentPlayer?.name} to choose.`}
              </p>
            </div>
          )}

          {game.pendingPower && (
            <div className="held-panel power-panel">
              <p className="mini-label">Power active</p>
              <strong>{powerText(game.pendingPower)}</strong>
              <p>Click a card on the board.</p>
            </div>
          )}

          {currentPlayer && (
            <button className="red-button" disabled={currentPlayer.turnsTaken < 5 || !!game.held || !!game.pendingPower || !!game.redCallerId || (roomCode ? assignedPlayerId !== currentPlayer.id : false)} onClick={callRed}>
              Call Red
            </button>
          )}
        </aside>

        <section className="boards">
          {game.players.map((player) => (
            <article className={`player-card ${player.id === currentPlayer?.id ? "active-player" : ""}`} key={player.id}>
              <div className="player-head">
                <div>
                  <h2>{player.name}</h2>
                  <p>{player.slots.length} cards · {player.turnsTaken} turns</p>
                </div>
                <strong>{player.matchScore} total</strong>
              </div>
              <div className="player-board">
                {player.slots.map((slot) => {
                  const visible = game.phase !== "playing" || (game.knowledge[game.viewerId] ?? []).includes(slot.card.id);
                  const canSwap = game.held && currentPlayer?.id === player.id && (!roomCode || assignedPlayerId === player.id);
                  return (
                    <div className="slot-wrap" key={slot.id}>
                      <button
                        className="card-button"
                        disabled={!canSwap && (!game.pendingPower || (roomCode ? assignedPlayerId !== game.pendingPower.actorId : false))}
                        onClick={() => {
                          if (game.pendingPower) selectPowerCard({ playerId: player.id, slotId: slot.id });
                          else swapHeldWith({ playerId: player.id, slotId: slot.id });
                        }}
                      >
                        <CardFace card={slot.card} visible={visible} compact={false} />
                      </button>
                      {topDiscard && player.id === game.viewerId && (!roomCode || assignedPlayerId === player.id) && (
                        <button className="stack-button" onClick={() => stackCard({ playerId: player.id, slotId: slot.id })}>
                          Stack
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </article>
          ))}
        </section>

        <aside className="side-panel log-panel">
          <h2>Scores</h2>
          <div className="score-list">
            {game.players.map((player) => (
              <div key={player.id}>
                <span>{player.name}</span>
                <strong>
                  <small>Round</small> {player.roundScore ?? "?"} <small>Total</small> {player.matchScore}
                </strong>
              </div>
            ))}
          </div>

          {(game.phase === "roundOver" || game.phase === "matchOver") && (
            <div className="result-panel">
              <h2>{game.phase === "matchOver" ? "Match complete" : "Round complete"}</h2>
              {game.players.map((player) => (
                <p key={player.id}>
                  {player.name}: {scoreBreakdown(player.slots)} = {player.roundScore} this round, {player.matchScore} total
                </p>
              ))}
              {game.phase === "roundOver" ? (
                <button className="primary" onClick={nextRound}>Deal next round</button>
              ) : (
                <button className="primary" onClick={reset}>Play again</button>
              )}
            </div>
          )}

          <h2>Table log</h2>
          <ol className="log-list">
            {game.log.slice(0, 8).map((entry, index) => (
              <li key={`${entry}-${index}`}>{entry}</li>
            ))}
          </ol>
        </aside>
      </section>
    </main>
  );
}

function playerName(game: GameState, id: string) {
  return game.players.find((player) => player.id === id)?.name ?? "Player";
}

function swapBoardCards(state: GameState, first: CardRef, second: CardRef, message: string) {
  const a = findSlot(state.players, first);
  const b = findSlot(state.players, second);
  if (!a.slot || !b.slot) return state;
  const players = state.players.map((player, playerIndex) => ({
    ...player,
    slots: player.slots.map((slot, slotIndex) => {
      if (playerIndex === a.playerIndex && slotIndex === a.slotIndex) return { ...slot, card: b.slot!.card };
      if (playerIndex === b.playerIndex && slotIndex === b.slotIndex) return { ...slot, card: a.slot!.card };
      return slot;
    }),
  }));
  return { ...state, players, log: [message, ...state.log] };
}

function powerText(power: NonNullable<PowerState>) {
  if (power.kind === "peek") return "7: peek at any one card.";
  if (power.kind === "blindSwap") return `8: blind swap any two cards. Selected ${power.selected.length}/2.`;
  if (power.step === "peek") return "9: peek at any one card first.";
  return `9: now swap any two cards. Selected ${power.selected.length}/2.`;
}

function CardFace({ card, visible, compact }: { card: Card; visible: boolean; compact: boolean }) {
  if (!visible) {
    return <div className={`card-face card-back ${compact ? "compact-card" : ""}`}>RED</div>;
  }

  return (
    <div className={`card-face ${isRed(card) ? "red-suit" : "black-suit"} ${compact ? "compact-card" : ""}`}>
      <span>{card.rank}</span>
      <small>{suitSymbol(card.suit)}</small>
      <em>{cardValue(card)}</em>
    </div>
  );
}
