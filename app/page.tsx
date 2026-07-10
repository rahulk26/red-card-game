"use client";

import { useEffect, useState } from "react";

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

type PeekReveal = {
  actorId: string;
  ref: CardRef;
  card: Card;
  after: "endTurn" | "power9Swap";
};

type GameState = {
  phase: "waiting" | "setup" | "initialPeek" | "playing" | "roundOver" | "matchOver";
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
  peekReveal: PeekReveal | null;
  lastSwap: CardRef[];
  joinedPlayerIds: string[];
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

function createRound(players: Player[], mode: "single" | "match", totalRounds: number, roundNumber: number, phase: GameState["phase"] = "initialPeek"): GameState {
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
    phase,
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
    peekReveal: null,
    lastSwap: [],
    joinedPlayerIds: phase === "waiting" ? [] : dealt.map((player) => player.id),
    redCallerId: null,
    finalTurnsRemaining: [],
    log:
      phase === "waiting"
        ? [`Room created. Waiting for ${players.length} players to join.`]
        : [`Round ${roundNumber} started. ${cardLabel(firstDiscard)} opens the discard pile.`],
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
    peekReveal: null,
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
    peekReveal: null,
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
  const [setupView, setSetupView] = useState<"home" | "online" | "local">("home");
  const [playerCount, setPlayerCount] = useState(4);
  const [names, setNames] = useState(initialNames);
  const [mode, setMode] = useState<"single" | "match">("single");
  const [totalRounds, setTotalRounds] = useState(3);
  const [game, setGame] = useState<GameState | null>(null);
  const [blunder, setBlunder] = useState<{ id: number; message: string } | null>(null);
  const [roomCode, setRoomCode] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [roomMessage, setRoomMessage] = useState("");
  const [initialPeekFlipped, setInitialPeekFlipped] = useState<Record<string, string[]>>({});
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
  const canSeePeekReveal = !!game?.peekReveal && (!roomCode || assignedPlayerId === game.peekReveal.actorId);
  const viewerIndex = game ? Math.max(0, game.players.findIndex((player) => player.id === game.viewerId)) : 0;
  const peekingPlayer = game?.phase === "initialPeek" ? game.players[game.peekIndex] : null;
  const isMyInitialPeek = !!peekingPlayer && (!roomCode || assignedPlayerId === peekingPlayer.id);
  const flippedOpeningCards = peekingPlayer ? (initialPeekFlipped[peekingPlayer.id] ?? []) : [];
  const joinedPlayerIds = game?.joinedPlayerIds ?? game?.players.map((player) => player.id) ?? [];
  const lastSwapRefs = game ? normalizeSwapRefs(game.lastSwap) : [];
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
    setInitialPeekFlipped({});
    setSetupView("home");
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
    const next = createRound(players, mode, mode === "single" ? 1 : totalRounds, 1, "waiting");
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
    const data = (await response.json()) as { code: string; playerId: string | null; room: { game: GameState } };
    setRoomCode(data.code);
    setAssignedPlayerId(data.playerId ?? "");
    setInitialPeekFlipped({});
    setRoomMessage(`Room ${data.code} is ready. Open this site on another device and join with that code.`);
    setSetupView("home");
    setGame({ ...data.room.game, viewerId: data.playerId ?? data.room.game.viewerId });
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
    setInitialPeekFlipped({});
    setRoomMessage(`Joined room ${code}. You are ${data.room.game.players.find((player) => player.id === data.playerId)?.name ?? "a player"}.`);
    setSetupView("home");
    setGame({ ...data.room.game, viewerId: data.playerId });
  }

  function toggleInitialPeekCard(slot: Slot) {
    if (!game || !peekingPlayer || !isMyInitialPeek) return;
    const peekingSlots = peekingPlayer.slots.slice(2, 4).map((candidate) => candidate.id);
    if (!peekingSlots.includes(slot.id)) return;
    setInitialPeekFlipped((current) => {
      const flipped = new Set(current[peekingPlayer.id] ?? []);
      if (flipped.has(slot.id)) flipped.delete(slot.id);
      else flipped.add(slot.id);
      return { ...current, [peekingPlayer.id]: [...flipped] };
    });
  }

  function completeInitialPeek() {
    if (!game) return;
    const peeking = game.players[game.peekIndex];
    if (roomCode && assignedPlayerId !== peeking.id) return;
    const flipped = initialPeekFlipped[peeking.id] ?? [];
    if (flipped.length < 2) return;
    const nextPeekIndex = game.peekIndex + 1;
    const donePeeking = nextPeekIndex >= game.players.length;
    setInitialPeekFlipped((current) => ({ ...current, [peeking.id]: [] }));
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
    if (!game || game.phase !== "playing" || game.held || game.pendingPower) return;
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
    if (!game || game.phase !== "playing" || game.held || game.pendingPower || game.discard.length === 0 || !currentPlayer) return;
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
        lastSwap: [ref],
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
    if (!game || game.phase !== "playing" || !currentPlayer || game.held || game.pendingPower || currentPlayer.turnsTaken < 5) return;
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
    if (game.peekReveal) return;
    if (roomCode && assignedPlayerId !== game.pendingPower.actorId) return;
    const { slot } = findSlot(game.players, ref);
    if (!slot) return;
    const actor = game.pendingPower.actorId;

    if (game.pendingPower.kind === "peek") {
      commitGame({
        ...game,
        peekReveal: { actorId: actor, ref, card: slot.card, after: "endTurn" },
      });
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
      commitGame({
        ...game,
        peekReveal: { actorId: actor, ref, card: slot.card, after: "power9Swap" },
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

  function flipPeekBack() {
    if (!game?.peekReveal) return;
    if (roomCode && assignedPlayerId !== game.peekReveal.actorId) return;
    const actor = game.peekReveal.actorId;
    if (game.peekReveal.after === "power9Swap") {
      commitGame({
        ...game,
        peekReveal: null,
        pendingPower: { kind: "peekThenSwap", actorId: actor, step: "swap", selected: [] },
        log: [`Power 9: ${playerName(game, actor)} peeked. Now choose two cards to swap.`, ...game.log],
      });
      return;
    }
    commitGame(
      nextTurn({
        ...game,
        peekReveal: null,
        pendingPower: null,
        log: [`Power 7: ${playerName(game, actor)} peeked at one card.`, ...game.log],
      }),
    );
  }

  function stackCard(ref: CardRef) {
    if (!game || game.phase !== "playing" || !topDiscard || game.held) return;
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
    setInitialPeekFlipped({});
    setSetupView("home");
    setGame(null);
  }

  if (!game) {
    const setupFields = (
      <>
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
      </>
    );

    if (setupView === "home") {
      return (
        <main className="shell setup-shell">
          <section className="setup-panel home-panel">
            <div className="brand-block">
              <p className="eyebrow">Card room</p>
              <h1>Red</h1>
              <p className="intro">
                Lowest points win. Remember your cards, swap carefully, and call Red when the table feels right.
              </p>
            </div>

            <div className="setup-actions">
              <button className="mode-card primary-choice" onClick={() => setSetupView("online")}>
                <span>Online Room</span>
                <small>Create or join with a room code</small>
              </button>
              <button className="mode-card" onClick={() => setSetupView("local")}>
                <span>Local Game</span>
                <small>Play on one device</small>
              </button>
            </div>
          </section>
        </main>
      );
    }

    return (
      <main className="shell setup-shell">
        <section className="setup-panel setup-flow-panel">
          <button
            className="ghost back-button"
            onClick={() => {
              setRoomMessage("");
              setSetupView("home");
            }}
          >
            Back
          </button>

          {setupView === "online" ? (
            <>
              <div className="brand-block compact">
                <p className="eyebrow">Online room</p>
                <h1>Room Setup</h1>
              </div>

              <div className="split-setup">
                <div className="setup-card">
                  <h2>Create a Game</h2>
                  {setupFields}
                  <button className="primary" onClick={createRoom}>
                    Create online room
                  </button>
                </div>

                <div className="setup-card join-card">
                  <h2>Join a Game</h2>
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
                </div>
              </div>
              {roomMessage && <p className="room-message">{roomMessage}</p>}
            </>
          ) : (
            <>
              <div className="brand-block compact">
                <p className="eyebrow">Local game</p>
                <h1>Table Setup</h1>
              </div>

              <div className="setup-card">
                {setupFields}
                <button className="primary" onClick={startGame}>
                  Deal local game
                </button>
              </div>
            </>
          )}
        </section>
      </main>
    );
  }

  return (
    <main className="shell table-shell">
      {blunder && <div className="blunder-flash">{blunder.message}</div>}
      <header className="topbar">
        <div>
          <h1>Red</h1>
        </div>
        <div className="status-strip">
          <span>{game.phase === "waiting" ? "Waiting for players" : game.phase === "initialPeek" ? `Peek: ${peekingPlayer?.name}` : `Turn: ${currentPlayer?.name}`}</span>
        </div>
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

          {currentPlayer && (
            <button className="red-button" disabled={game.phase !== "playing" || currentPlayer.turnsTaken < 5 || !!game.held || !!game.pendingPower || !!game.redCallerId || (roomCode ? assignedPlayerId !== currentPlayer.id : false)} onClick={callRed}>
              Call Red
            </button>
          )}

          <button className="ghost" onClick={reset}>
            New game
          </button>
        </aside>

        <section className="table-stage" aria-label="Card table">
          <div className="felt-table">
            <div className="table-rail" aria-hidden="true" />
            <div className="center-piles">
              <div>
                <p className="mini-label">Draw</p>
                <button className="deck-card" onClick={drawFromDeck} disabled={game.phase !== "playing" || !!game.held || !!game.pendingPower || (roomCode ? assignedPlayerId !== currentPlayer?.id : false)}>
                  DRAW
                </button>
              </div>
              <div>
                <p className="mini-label">Discard</p>
                <button className="discard-card" onClick={drawFromDiscard} disabled={game.phase !== "playing" || !!game.held || !!game.pendingPower || !topDiscard || (roomCode ? assignedPlayerId !== currentPlayer?.id : false)}>
                  {topDiscard ? <CardFace card={topDiscard} visible compact motion="discard" /> : "Empty"}
                </button>
              </div>
            </div>

            <div className="table-action">
              {game.phase === "waiting" && (
                <div className="held-panel waiting-panel">
                  <p className="mini-label">Room queue</p>
                  <strong>{joinedPlayerIds.length} of {game.players.length} players seated</strong>
                  <div className="queue-list">
                    {game.players.map((player) => (
                      <span className={joinedPlayerIds.includes(player.id) ? "joined" : ""} key={player.id}>
                        {player.name}
                      </span>
                    ))}
                  </div>
                  <p>{roomCode ? `Share room ${roomCode}. The opening flips start when everyone joins.` : "Waiting for players."}</p>
                </div>
              )}

              {game.phase === "initialPeek" && peekingPlayer && (
                <div className="held-panel opening-panel">
                  <p className="mini-label">Opening memory</p>
                  <strong>{isMyInitialPeek ? "Flip your bottom two cards" : `${peekingPlayer.name} is memorizing`}</strong>
                  <p>
                    {isMyInitialPeek
                      ? `${flippedOpeningCards.length}/2 flipped. Click both bottom cards, remember them, then turn them back down.`
                      : "Their cards stay private on your screen."}
                  </p>
                  {isMyInitialPeek && (
                    <button className="secondary" disabled={flippedOpeningCards.length < 2} onClick={completeInitialPeek}>
                      Flip back and continue
                    </button>
                  )}
                </div>
              )}

              {game.held && (
                <div className="held-panel card-motion-panel">
                  <p className="mini-label">{canSeeHeldCard ? "Drawn card" : `${currentPlayer?.name} drew a card`}</p>
                  <CardFace card={game.held.card} visible={canSeeHeldCard} compact={false} motion="drawn" />
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
                  <p>{game.peekReveal ? "Flip the card back to continue." : "Click a card on the board."}</p>
                </div>
              )}

              {game.peekReveal && (
                <div className="held-panel reveal-panel card-motion-panel">
                  <p className="mini-label">{canSeePeekReveal ? "Peeked card" : `${playerName(game, game.peekReveal.actorId)} is peeking`}</p>
                  <CardFace card={game.peekReveal.card} visible={canSeePeekReveal} compact={false} motion="peek" />
                  {canSeePeekReveal ? (
                    <button className="secondary" onClick={flipPeekBack}>
                      Flip back
                    </button>
                  ) : (
                    <p>Waiting for them to flip it back.</p>
                  )}
                </div>
              )}
            </div>
          </div>

          <section className="boards table-seats">
          {game.players.map((player) => (
            <article className={`player-card table-seat ${seatPosition(game.players.indexOf(player), game.players.length, viewerIndex)} ${player.id === currentPlayer?.id && game.phase === "playing" ? "active-player" : ""} ${player.id === game.viewerId ? "viewer-seat" : ""} ${joinedPlayerIds.includes(player.id) ? "joined-seat" : "empty-seat"} ${peekingPlayer?.id === player.id ? "peeking-seat" : ""}`} key={player.id}>
              <div className="player-head">
                <div className="player-avatar" aria-hidden="true">{initials(player.name)}</div>
                <h2>{player.id === game.viewerId ? "You" : player.name}</h2>
              </div>
              <div className="player-board">
                {player.slots.map((slot) => {
                  const seat = seatPosition(game.players.indexOf(player), game.players.length, viewerIndex);
                  const slotIndex = player.slots.findIndex((candidate) => candidate.id === slot.id);
                  const isOpeningBottomCard = game.phase === "initialPeek" && peekingPlayer?.id === player.id && slotIndex >= 2;
                  const openingReveal = isOpeningBottomCard && isMyInitialPeek && flippedOpeningCards.includes(slot.id);
                  const revealMatches =
                    canSeePeekReveal &&
                    game.peekReveal?.ref.playerId === player.id &&
                    game.peekReveal.ref.slotId === slot.id;
                  const visible =
                    (game.phase !== "playing" && game.phase !== "initialPeek" && game.phase !== "waiting") ||
                    openingReveal ||
                    revealMatches ||
                    (game.knowledge[game.viewerId] ?? []).includes(slot.card.id);
                  const canSwap = game.held && currentPlayer?.id === player.id && (!roomCode || assignedPlayerId === player.id);
                  const slotRef = { playerId: player.id, slotId: slot.id };
                  const wasLastSwap = lastSwapRefs.some((ref) => sameRef(ref, slotRef));
                  const isSelectedForPower = !!game.pendingPower?.selected.some((ref) => sameRef(ref, slotRef));
                  return (
                    <div
                      className={`slot-wrap ${wasLastSwap ? "slot-swapped" : ""} ${isSelectedForPower ? "slot-selected" : ""} ${revealMatches || openingReveal ? "slot-revealed" : ""} ${isOpeningBottomCard && isMyInitialPeek ? "opening-clickable" : ""}`}
                      key={slot.id}
                      style={{ order: slotOrder(slotIndex, seat) }}
                    >
                      <button
                        className="card-button"
                        disabled={
                          game.phase === "waiting" ||
                          (!isOpeningBottomCard || !isMyInitialPeek) &&
                            !canSwap &&
                            (!game.pendingPower || !!game.peekReveal || (roomCode ? assignedPlayerId !== game.pendingPower.actorId : false))
                        }
                        onClick={() => {
                          if (isOpeningBottomCard && isMyInitialPeek) toggleInitialPeekCard(slot);
                          else if (game.pendingPower) selectPowerCard(slotRef);
                          else swapHeldWith(slotRef);
                        }}
                      >
                        <CardFace card={slot.card} visible={visible} compact={false} motion={wasLastSwap ? "swap" : revealMatches || openingReveal ? "peek" : undefined} />
                      </button>
                      {wasLastSwap && <span className="swap-marker">Swapped here</span>}
                      {game.phase === "playing" && topDiscard && player.id === game.viewerId && (!roomCode || assignedPlayerId === player.id) && (
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
        </section>

        {(game.phase === "roundOver" || game.phase === "matchOver") && (
          <aside className="side-panel log-panel results-only-panel">
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
          </aside>
        )}
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
  return { ...state, players, lastSwap: [first, second], log: [message, ...state.log] };
}

function powerText(power: NonNullable<PowerState>) {
  if (power.kind === "peek") return "7: peek at any one card.";
  if (power.kind === "blindSwap") return `8: blind swap any two cards. Selected ${power.selected.length}/2.`;
  if (power.step === "peek") return "9: peek at any one card first.";
  return `9: now swap any two cards. Selected ${power.selected.length}/2.`;
}

function seatPosition(index: number, total: number, viewerIndex: number) {
  const relative = (index - viewerIndex + total) % total;
  const layouts: Record<number, string[]> = {
    2: ["seat-bottom", "seat-top"],
    3: ["seat-bottom", "seat-left", "seat-top"],
    4: ["seat-bottom", "seat-left", "seat-top", "seat-right"],
    5: ["seat-bottom", "seat-bottom-left", "seat-top-left", "seat-top-right", "seat-bottom-right"],
    6: ["seat-bottom", "seat-bottom-left", "seat-left", "seat-top", "seat-right", "seat-bottom-right"],
  };
  return layouts[total]?.[relative] ?? "seat-bottom";
}

function sameRef(a: CardRef, b: CardRef) {
  return a.playerId === b.playerId && a.slotId === b.slotId;
}

function normalizeSwapRefs(refs: GameState["lastSwap"] | CardRef | null | undefined) {
  if (!refs) return [];
  return Array.isArray(refs) ? refs : [refs];
}

function slotOrder(slotIndex: number, seat: string) {
  if (seat.includes("top")) return [3, 4, 1, 2][slotIndex] ?? slotIndex + 1;
  if (seat.includes("left")) return [2, 4, 1, 3][slotIndex] ?? slotIndex + 1;
  if (seat.includes("right")) return [1, 3, 2, 4][slotIndex] ?? slotIndex + 1;
  return slotIndex + 1;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "P";
}

function CardFace({ card, visible, compact, motion }: { card: Card; visible: boolean; compact: boolean; motion?: "drawn" | "swap" | "peek" | "discard" }) {
  const motionClass = motion ? `motion-${motion}` : "";
  if (!visible) {
    return <div className={`card-face card-back ${motionClass} ${compact ? "compact-card" : ""}`} />;
  }

  return (
    <div className={`card-face ${motionClass} ${isRed(card) ? "red-suit" : "black-suit"} ${compact ? "compact-card" : ""}`}>
      <span>{card.rank}</span>
      <small>{suitSymbol(card.suit)}</small>
      <em>{cardValue(card)}</em>
    </div>
  );
}
