import type { KnockoutGame } from "./types";

export function createRegistrationGame(eventId: string): KnockoutGame {
  if (!eventId) throw new Error("A knockout event is required.");
  return { id: `${eventId}-game`, eventId, entrants: [], status: "registration", winnerId: null, revision: 0 };
}

export function appendGameEntrant(game: KnockoutGame, participantId: string): KnockoutGame {
  if (game.status !== "registration") throw new Error("Game registration is closed.");
  if (!participantId) throw new Error("A participant is required.");
  if (game.entrants.includes(participantId)) return game;
  if (game.entrants.length >= 128) throw new Error("A game can have at most 128 entrants.");
  return { ...game, entrants: [...game.entrants, participantId], revision: game.revision + 1 };
}

export function startGame(game: KnockoutGame): KnockoutGame {
  if (game.status !== "registration") throw new Error("This event already has a game.");
  if (game.entrants.length < 2) throw new Error("A game requires two or more registered entrants.");
  return { ...game, status: "active", winnerId: null, revision: game.revision + 1 };
}

export function selectGameWinner(game: KnockoutGame, winnerId: string, revision: number, admin: boolean, reason?: string): KnockoutGame {
  if (!game.entrants.includes(winnerId)) throw new Error("Winner must be a registered entrant.");
  if (game.status === "active") {
    if (game.revision !== revision) throw new Error("This game changed. Refresh and try again.");
    return { ...game, status: "complete", winnerId, revision: revision + 1 };
  }
  if (game.status === "complete") {
    if (!admin) throw new Error("Administrator access is required to correct a winner.");
    if (!reason?.trim()) throw new Error("A reason is required to correct a winner.");
    if (game.revision !== revision) throw new Error("This game changed. Refresh and try again.");
    if (game.winnerId === winnerId) throw new Error("This winner is already recorded.");
    return { ...game, winnerId, revision: revision + 1 };
  }
  throw new Error("The game has not started.");
}
