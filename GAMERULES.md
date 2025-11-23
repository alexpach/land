# Game Rules: The Game of Land

## Objective
Capture the most territory on the sphere by surrounding tiles (hexagons and pentagons) with your color. The first player to capture a majority of the tiles wins!

## Players
*   **2-4 Players** (Configurable)
*   Each player is assigned a unique color.

## Gameplay Loop

### Turns
The game is played in turns. On each turn, a player has a limited number of **Moves** (configurable, default is usually 5).

### Actions
On your turn, you can perform the following actions, each costing **1 Move**:

1.  **Place a Puck**:
    *   Click on an empty vertex (corner of a tile) to place a puck of your color.
    *   **Undo**: You can click on a puck you placed *this turn* to remove it and refund the move cost.

2.  **Steal a Puck**:
    *   You can remove an opponent's puck if it is **Vulnerable**.
    *   **Vulnerable**: A puck is vulnerable if it is **NOT** connected to any captured land (tile) owned by that opponent.
    *   If a puck is adjacent to at least one tile owned by its owner, it is **Protected** and cannot be stolen.

### Capturing Territory
*   **Surround to Capture**: If a tile (hexagon or pentagon) is **fully surrounded** by pucks of a single player's color, that tile is captured.
*   **Effect**:
    *   The tile turns into the capturing player's color.
    *   **All pucks** on the vertices of that tile become owned by the capturing player (even if they were previously owned by an opponent).
    *   If the tile was previously owned by another player, it is stolen from them (their score decreases, yours increases).

## Special Mechanics

### Mystery Boxes
Pentagons (the 12 special tiles on the sphere) contain **Mystery Boxes**.
*   **How to Open**: Capture the pentagon to open the box.
*   **Rewards/Penalties**:
    *   **+1 Move** (25% chance): You get 1 extra move this turn.
    *   **+2 Moves** (25% chance): You get 2 extra moves this turn.
    *   **+3 Moves** (25% chance): You get 3 extra moves this turn.
    *   **BOMB!** (25% chance):
        *   **Explosion**: A mushroom cloud appears!
        *   **Debris**: All pucks on the pentagon are blown away (removed from the board).
        *   **Reset**: The pentagon becomes unowned (sand color).
        *   **Turn End**: The explosion takes time, delaying the next player's turn slightly.

## Winning Conditions
The game ends when either:

1.  **Majority Rule**: A player captures enough tiles to guarantee a win (more than 50% of the total tiles divided by the number of players).
    *   *Formula*: `Floor(Total Tiles / Player Count) + 1`
2.  **Domination**: All vertices on the board are filled. The player with the most captured tiles wins.

If the game ends with a tie in scores, it is a Draw.
