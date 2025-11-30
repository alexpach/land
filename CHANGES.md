# Changelog

## [1.0.5] - 2025-11-30
- **Changes Page**: Added a new `/changes` page to view the changelog in-game. Linked from the version number.
- **Deployment Fix**: Fixed issue where `rules` and `changes` pages were 404ing on production by ensuring they are copied to the build folder.

## [1.0.4] - 2025-11-30
- **Game Over Screen**: Improved UI to be non-blocking, allowing map exploration after winning. Added a "Main Menu" button.
- **Fixes**: Fixed broken links by ensuring relative paths are used correctly.
- **Music**: Simplified music options to only include working tracks.

## [1.0.3] - 2025-11-27
- **Deployment Fix**: Fixed music playback on GitHub Pages by ensuring assets are correctly copied to the build folder and using relative paths.

## [1.0.2] - 2025-11-27
- **Main Menu**: Added hamburger menu button to game screen for quick return to start.
- **Visual Polish**: Fixed start screen layout, button alignments, and dropdown styling.
- **Navigation**: Fixed routing issues for Rules page.
- **Bug Fixes**: Fixed Mute button appearing when no music is selected.

## [1.0.1] - 2025-11-26
- **Game Rules Screen**: Added a dedicated rules page with a pixel-art book icon link.
- **Random Music**: Added "Random (Loop)" option with dynamic tempo variation.
- **UI Refinements**: Improved start screen layout (top-aligned buttons) and standardized button sizes.
- **Visuals**: Enhanced Mystery Box visuals with darker/deeper debossed text.
- **Refined Mobile Experience**: Reduced camera rotation speed and improved UI padding on small screens.
- **Cleanup**: Removed unused MIDI files and updated audio controller.

## [1.0.0] - 2025-11-26
- **Compact Start Screen**: Redesigned start screen with grouped inputs and dynamic player count buttons.
- **Input Lock**: Implemented input lock during turn switches to prevent accidental moves.
- **Crash Fix**: Resolved crash in camera rotation logic.

## [0.9.0] - 2025-11-25
- **Touch Interaction**: Added support for tap-to-place and drag-to-rotate on mobile devices.
- **Mobile Responsiveness**: Fixed broken layout on mobile screens and added safe area support.

## [0.8.0] - 2025-11-25
- **Undo Fix**: Fixed bug where players could undo moves on claimed land.
- **Auto-Rotate Fix**: Resolved issues with auto-rotation logic.

## [0.7.0] - 2025-11-24
- **Documentation**: Added README demo link, Copyright info, and Game Rules.
- **Deployment**: Setup GitHub Pages deployment.

## [0.6.0] - 2025-11-23
- **Starfield**: Implemented dynamic starfield background.
- **Bomb Logic**: Fixed bomb color reset and unclaim logic.

## [0.5.0] - 2025-11-23
- **Music Integration**: Added background music with mute toggle and dynamic selection.
- **Mystery Box Visuals**: Refined mystery box appearance (debossed text).

## [0.4.0] - 2025-11-22
- **Mystery Box**: Introduced Mystery Boxes with "Bomb" and "Extra Turn" effects.
- **Turn Logic**: Implemented turn switching and move limits.

## [0.3.0] - 2025-11-21
- **Game Loop**: Established core game loop (placing pucks, capturing territories).
- **Camera Control**: Added camera rotation and zoom.

## [0.2.0] - 2025-11-20
- **Geometry**: Implemented Goldberg Polyhedron geometry generation.
- **Rendering**: Basic Three.js scene setup with lighting.

## [0.1.0] - 2025-11-19
- **Initial Commit**: Project scaffolding with Vite and Three.js.
