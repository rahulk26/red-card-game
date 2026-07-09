# Red Card Game

Red is a multiplayer memory card game about getting stuck with the lowest possible score. Each player starts with four face-down cards, gets one quick look at two of them, and then has to remember, bluff, swap, stack, and take risks as the round unfolds.

This web version supports 2-6 players in an online room. One player creates a room, shares the room code, and everyone joins from their own device.

## Play Online

Play the live version here:

[https://red-card-room.rahulk1326.chatgpt.site](https://red-card-room.rahulk1326.chatgpt.site)

To start a game:

1. Open the live site.
2. Choose the number of players and enter player names.
3. Click **Create online room**.
4. Share the room code with the other players.
5. Each player opens the same link, enters the code, and joins.
6. Once everyone is in, play through the opening peeks and start the round.

## What The Game Is About

The goal is simple: end the round with the lowest point total.

The twist is that most cards stay face down. You only know what you have by remembering your opening peek, watching swaps, using power cards, and deciding whether a risky stack attempt is worth it.

Players can also call **Red** after enough turns. Once Red is called, everyone else gets one final turn to improve their hand before scores are revealed.

## Core Rules

- Use a standard 52-card deck with no jokers.
- Each player starts with 4 face-down cards in a 2x2 grid.
- At the beginning of the round, each player may look at their bottom 2 cards once.
- On your turn, draw from the face-down deck or take the top card from the discard pile.
- If you draw from the deck, you may discard it or swap it into one of your own face-down slots.
- If you take from the discard pile, that is your turn's draw and you must swap it into your own grid.
- The card you swap out goes to the discard pile.
- When the deck runs out, the discard pile is reshuffled into the deck while keeping the current top discard available.

## Card Values

| Card | Points |
| --- | ---: |
| King | -2 |
| Ace | 0 |
| 2-10 | Face value |
| Jack | 10 |
| Queen | 10 |

Lowest total wins the round.

## Power Cards

Power cards only activate when drawn from the face-down deck and then discarded. They do not activate when they were already face down in a player's grid, when swapped out, or when taken from the discard pile.

- **7**: Peek at any one card on the board.
- **8**: Blind swap any two cards on the board.
- **9**: Peek at any one card, then swap any two cards on the board. The peeked card and swapped cards may be different.

## Stacking

If the top discard is a rank you believe you have face down, you can try to stack one of your own cards on it.

- You may only stack your own cards.
- You can attempt a stack during any player's turn.
- If the rank matches, your card is removed from your grid.
- If the rank is wrong, the card returns to your grid and you draw an extra unknown face-down penalty card.
- Only the first successful stack for a given discard is allowed, so timing matters.

## Game Modes

- **Single round**: lowest score wins that round.
- **X-round match**: play a chosen number of rounds and compare total scores. Lowest cumulative score wins.

## Local Development

Prerequisite:

- Node.js `>=22.13.0`

Install and run:

```bash
npm install
npm run dev
```

Useful commands:

```bash
npm run build
npm test
```

## Tech Stack

- Next.js / React
- vinext
- Cloudflare-style Worker entrypoint
- D1-backed online room persistence for the hosted version

## Current Status

This is an active prototype. The hosted game already supports online room codes, per-device player assignment, hidden opponent drawn cards, power-card peeks, stacking, match scoring, and the custom Red rules described above.
