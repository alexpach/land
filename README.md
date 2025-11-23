# Land

A 3D strategy game played on a spherical world.

## Overview

"Land" is a turn-based strategy game where players compete to capture territory on a Goldberg Polyhedron (a sphere made of hexagons and pentagons). Players place "pucks" on the vertices of the grid to surround and capture tiles.

## Controls

*   **Rotate World**: Click and drag anywhere on the background or sphere.
*   **Zoom**: Scroll wheel or pinch.
*   **Place Puck**: Click on a vertex (grid intersection).
*   **Interact**: Click buttons in the UI to start game, mute music, etc.

## Features

*   **3D World**: A fully rotatable, interactive spherical grid.
*   **Procedural Geometry**: Custom Goldberg Polyhedron generation.
*   **Interactive Grid**: Clickable vertices and reactive tiles.
*   **Dynamic Visuals**: Integrated grid lines, 3D node structures, and Starfield background.
*   **Retro Audio**: 8-bit style background music with mute control.

## Tech Stack

*   **Engine**: Three.js
*   **Build Tool**: Vite
*   **UI**: lil-gui

## Setup

1.  Install dependencies:
    ```bash
    npm install
    ```
2.  Run development server:
    ```bash
    npm run dev
    ```
