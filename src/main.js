import * as THREE from 'three';
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
import GUI from 'lil-gui';
import { GoldbergGeometry } from './geometry/GoldbergGeometry.js';
import { AudioController } from './audio/AudioController.js';

console.log("Land Game Starting...");

// Scene Setup
const scene = new THREE.Scene();
// scene.background = new THREE.Color(0x111111); // Removed for Starfield

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.z = 5;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

// Controls
const controls = new TrackballControls(camera, renderer.domElement);
controls.rotateSpeed = 1.0;
controls.zoomSpeed = 1.2;
controls.panSpeed = 0.8;
controls.noZoom = false;
controls.noPan = true; // Pan doesn't make sense for a centered sphere
controls.staticMoving = false; // Dynamic damping
controls.dynamicDampingFactor = 0.1;
controls.minDistance = 2.5;
controls.maxDistance = 10;

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6); // Soft white light
scene.add(ambientLight);

const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
hemisphereLight.position.set(0, 20, 0);
scene.add(hemisphereLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(5, 10, 7);
scene.add(directionalLight);

// Geometry Placeholder
let goldbergMesh;
let vertexInstancedMesh;
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const selectedVertices = new Set();
let gameState;
let vertexOwners;
let faceOwners;
const audioController = new AudioController();

const mapSizes = {
    'Small': 1,
    'Medium': 2,
    'Large': 3,
    'Extra-Large': 4,
    'XXL': 5
};

const params = {
    mapSize: 'Medium', // Default to Medium
    hexCount: 0,
    playerCount: 2 // Default 2 players
};

function createGeometry() {
    if (goldbergMesh) {
        scene.remove(goldbergMesh);
        goldbergMesh.geometry.dispose();
        goldbergMesh.material.dispose();
    }
    if (vertexInstancedMesh) {
        scene.remove(vertexInstancedMesh);
        vertexInstancedMesh.dispose(); // InstancedMesh has dispose method
    }
    if (window.gridMesh) {
        scene.remove(window.gridMesh);
        window.gridMesh.geometry.dispose();
        window.gridMesh.material.dispose();
    }

    // Reset state
    selectedVertices.clear();

    // Game State is initialized in startGame()

    updateTurnUI();

    // Map vertex index to player ID (who owns the puck)
    vertexOwners = new Map();
    // Map face index to player ID (who owns the tile)
    faceOwners = new Map();

    updateTurnUI();

    updateTurnUI();

    const detail = mapSizes[params.mapSize];

    // Calculate Hexagon Count: 10 * (v^2) - 10 where v = detail + 1
    // v=2 -> 30
    // v=3 -> 80
    // v=4 -> 150
    // v=5 -> 240
    // v=6 -> 350
    const v = detail + 1;
    const hexCount = 10 * (v * v) - 10;
    params.hexCount = hexCount;

    const radius = 2; // Fixed radius
    const geometry = new GoldbergGeometry(radius, detail);

    // Use vertex colors
    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.5,
        metalness: 0.1,
        flatShading: true
    });

    goldbergMesh = new THREE.Mesh(geometry, material);
    gameGroup.add(goldbergMesh);

    // Create Integrated Grid and Nodes
    const connectivity = geometry.userData.connectivity;
    if (connectivity) {
        const vertices = connectivity.vertices;
        const edges = connectivity.edgeList;

        // 1. Grid (Edges)
        const gridPositions = [];
        for (let i = 0; i < edges.length; i++) {
            const v1 = vertices[edges[i][0]];
            const v2 = vertices[edges[i][1]];
            gridPositions.push(v1.x, v1.y, v1.z);
            gridPositions.push(v2.x, v2.y, v2.z);
        }

        const gridGeo = new THREE.BufferGeometry();
        gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gridPositions, 3));

        const gridMat = new THREE.LineBasicMaterial({
            color: 0xffffff,
            opacity: 0.5,
            transparent: true,
            depthWrite: false, // Don't write to depth buffer to avoid occlusion issues with nodes
            polygonOffset: true,
            polygonOffsetFactor: -1, // Pull towards camera
            polygonOffsetUnits: -1
        });

        const gridMesh = new THREE.LineSegments(gridGeo, gridMat);
        gameGroup.add(gridMesh);
        window.gridMesh = gridMesh;
        // Store reference if needed, or just let it be part of the scene
        // For now, we don't interact with the grid lines directly

        // 2. Nodes (Vertices) - Solid 3D Structures (Cylinders)
        // Calculate average edge length to determine node size
        let totalEdgeLength = 0;
        for (let i = 0; i < edges.length; i++) {
            const v1 = vertices[edges[i][0]];
            const v2 = vertices[edges[i][1]];
            totalEdgeLength += v1.distanceTo(v2);
        }
        const avgEdgeLength = totalEdgeLength / edges.length;

        // Radius = 10% of distance between vertices (edge length)
        const nodeRadius = avgEdgeLength * 0.10;

        // Height = very low profile (e.g., 20% of radius or fixed small value)
        const nodeHeight = nodeRadius * 0.4; // Flat puck

        const nodeGeo = new THREE.CylinderGeometry(nodeRadius, nodeRadius, nodeHeight, 16);
        // Rotate geometry so cylinder axis aligns with Z (default is Y)
        // Actually, we will align Y to the normal, so default Cylinder orientation (Y-up) is fine.
        // We just need to rotate the instance.

        const nodeMat = new THREE.MeshPhysicalMaterial({
            color: 0xffffff, // White base (tinted by instance color)
            emissive: 0x000000, // Black base (we add glow in shader)
            roughness: 0.1,
            metalness: 0.1,
            transmission: 0.6, // Glass-like
            thickness: 1.0,
            transparent: true, // Needed for alpha/transmission blend
        });

        // Custom shader to tint emissive with instance color
        nodeMat.onBeforeCompile = (shader) => {
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <emissivemap_fragment>',
                `
                #include <emissivemap_fragment>
                #ifdef USE_INSTANCING_COLOR
                    // Add instance color as emissive glow
                    totalEmissiveRadiance += vColor.rgb * 0.8;
                #endif
                `
            );
        };

        vertexInstancedMesh = new THREE.InstancedMesh(nodeGeo, nodeMat, vertices.length);

        const dummy = new THREE.Object3D();
        const color = new THREE.Color();
        const defaultColor = new THREE.Color(0x888888); // Gray

        for (let i = 0; i < vertices.length; i++) {
            const v = vertices[i];

            // Orient cylinder to face outwards (align Y axis with normal)
            // Normal at v is v.normalize() (since it's a sphere at 0,0,0)
            const normal = v.clone().normalize();
            const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);

            dummy.position.copy(v);
            dummy.quaternion.copy(quaternion);
            dummy.scale.set(0, 0, 0); // Start hidden

            // Offset slightly outwards so it sits ON the vertex
            // We want the bottom of the cylinder to touch the surface.
            // Cylinder center is at height/2. So we move it out by height/2.
            // Plus a tiny epsilon to avoid z-fighting with the grid lines.
            dummy.position.add(normal.multiplyScalar(nodeHeight / 2 + 0.005));

            dummy.updateMatrix();
            vertexInstancedMesh.setMatrixAt(i, dummy.matrix);
            vertexInstancedMesh.setColorAt(i, defaultColor);
        }

        vertexInstancedMesh.instanceMatrix.needsUpdate = true;
        vertexInstancedMesh.instanceColor.needsUpdate = true;

        gameGroup.add(vertexInstancedMesh);
    }

    // Create Mystery Boxes on Pentagons
    createMysteryBoxes();
}

let mysteryBoxMesh;
const mysteryBoxData = new Map(); // faceIndex -> boolean (isCollected)

function createMysteryBoxes() {
    if (mysteryBoxMesh) {
        scene.remove(mysteryBoxMesh);
        mysteryBoxMesh.dispose();
    }
    mysteryBoxData.clear();

    const connectivity = goldbergMesh.geometry.userData.connectivity;
    const faces = connectivity.faces;
    const pentagonIndices = [];

    faces.forEach((face, idx) => {
        if (face.type === 'pentagon') {
            pentagonIndices.push(idx);
            mysteryBoxData.set(idx, false); // Not collected
        }
    });

    if (pentagonIndices.length === 0) return;

    // Calculate average edge length for sizing
    const edges = connectivity.edgeList;
    let totalEdgeLength = 0;
    for (let i = 0; i < edges.length; i++) {
        const v1 = connectivity.vertices[edges[i][0]];
        const v2 = connectivity.vertices[edges[i][1]];
        totalEdgeLength += v1.distanceTo(v2);
    }
    const avgEdgeLength = totalEdgeLength / edges.length;

    // Box Size: 35% of "tile size" (approx diameter ~ 2 * edge length)
    // Let's try boxSize = avgEdgeLength * 0.8 (roughly 35% of the full tile width)
    // Box Size: 40% smaller than before (was 0.8, now ~0.48)
    const boxSize = avgEdgeLength * 0.48;

    const geometry = new THREE.BoxGeometry(boxSize, boxSize, boxSize);

    // Create Bump Map for Debossed Effect
    const canvas = document.createElement('canvas');
    canvas.width = 256; // Higher resolution for cleaner text
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    // 1. Background: White (High)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 256, 256);

    // 2. Text: Black (Low)
    ctx.fillStyle = '#000000';
    // 75% of box size -> 75% of 256px = 192px
    ctx.font = 'bold 192px "Press Start 2P", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Draw Text
    ctx.fillText('?', 128, 128);

    const bumpMap = new THREE.CanvasTexture(canvas);

    // Materials
    // Single Material for all sides, but we only want the '?' on the Top.
    // Actually, InstancedMesh supports an array of materials.
    // We can use a plain Gold material for sides/bottom, and the Bump Map material for Top.

    const matGold = new THREE.MeshStandardMaterial({
        color: 0xFFD700,
        roughness: 0.3,
        metalness: 0.8,
        emissive: 0x222200,
        emissiveIntensity: 0.2
    });

    const matTop = new THREE.MeshStandardMaterial({
        color: 0xFFD700, // Same Gold Color
        bumpMap: bumpMap,
        bumpScale: 0.15, // Stronger deboss (approx 10% of width)
        roughness: 0.3,
        metalness: 0.8,
        emissive: 0x222200,
        emissiveIntensity: 0.2
    });

    // Array of materials: Right, Left, Top, Bottom, Front, Back
    const materials = [matGold, matGold, matTop, matGold, matGold, matGold];

    mysteryBoxMesh = new THREE.InstancedMesh(geometry, materials, pentagonIndices.length);

    const dummy = new THREE.Object3D();

    pentagonIndices.forEach((faceIdx, i) => {
        const face = faces[faceIdx];
        // Calculate centroid
        let centroid = new THREE.Vector3();
        face.indices.forEach(vIdx => {
            centroid.add(connectivity.vertices[vIdx]);
        });
        centroid.divideScalar(face.indices.length);

        // Orient box to face outwards
        const normal = centroid.clone().normalize();
        const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);

        // Position: Sunk into the tile (only 20% visible)
        // Top of box is at +boxSize/2 relative to center.
        // We want Top to be at Surface + boxSize*0.2.
        // So Center should be at Surface + boxSize*0.2 - boxSize*0.5 = Surface - boxSize*0.3.
        const offset = -boxSize * 0.3;

        dummy.position.copy(centroid.add(normal.multiplyScalar(offset)));
        dummy.quaternion.copy(quaternion);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();

        mysteryBoxMesh.setMatrixAt(i, dummy.matrix);
        mysteryBoxData.set(faceIdx, i);
    });

    mysteryBoxMesh.instanceMatrix.needsUpdate = true;
    gameGroup.add(mysteryBoxMesh);
}

// Interaction Handler
// Interaction Handler
let isDragging = false;
let startCameraPos = new THREE.Vector3();
const dragAngleThreshold = 10; // degrees

function onMouseDown(event) {
    isDragging = false;
    startCameraPos.copy(camera.position);
}

function onMouseUp(event) {
    const angle = startCameraPos.angleTo(camera.position) * (180 / Math.PI);

    if (angle > dragAngleThreshold) {
        isDragging = true;
    } else {
        isDragging = false;
    }
}

function onMouseClick(event) {
    if (isDragging) return;

    // Use hoveredVertex directly!
    if (hoveredVertex !== null) {
        toggleVertexSelection(hoveredVertex);
    }
}

function onMouseMove(event) {
    // Update mouse for raycaster (normalized coordinates)
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    updateHover();
}

window.addEventListener('mousedown', onMouseDown);
window.addEventListener('mouseup', onMouseUp);
window.addEventListener('click', onMouseClick);
window.addEventListener('mousemove', onMouseMove);

// Touch Support
function onTouchStart(event) {
    if (event.touches.length > 1) return; // Ignore multi-touch (pinch zoom handled by controls?)

    onInteractionStart();
    isDragging = false;
    startCameraPos.copy(camera.position);

    // Update mouse for raycaster
    const touch = event.touches[0];
    mouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;

    updateHover();
}

function onTouchMove(event) {
    if (event.touches.length > 1) return;

    const touch = event.touches[0];
    mouse.x = (touch.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(touch.clientY / window.innerHeight) * 2 + 1;

    // Optional: Update hover while dragging? 
    // Usually better to only update on tap for performance/clarity on mobile
}

function onTouchEnd(event) {
    // Calculate drag distance/angle
    const angle = startCameraPos.angleTo(camera.position) * (180 / Math.PI);

    if (angle > dragAngleThreshold) {
        isDragging = true;
    } else {
        isDragging = false;
        // It was a tap!
        // We need to re-run raycast because 'hoveredVertex' might be stale if we didn't update during move
        // Or just rely on the last touchstart position.

        // Let's force an update
        updateHover();
        if (hoveredVertex !== null) {
            toggleVertexSelection(hoveredVertex);
        }
    }
}

window.addEventListener('touchstart', onTouchStart, { passive: false });
window.addEventListener('touchmove', onTouchMove, { passive: false });
window.addEventListener('touchend', onTouchEnd);

function toggleVertexSelection(index) {
    if (gameState.isInputLocked) return; // Prevent moves if locked

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];

    // If already owned
    if (vertexOwners.has(index)) {
        const ownerId = vertexOwners.get(index);

        // 1. Own Puck: Undo?
        if (ownerId === currentPlayer.id && gameState.pucksPlacedInTurn.has(index)) {
            // Fix: Cannot undo if this puck is part of a claimed land!
            const connectivity = goldbergMesh.geometry.userData.connectivity;
            const faces = connectivity.faces;
            let isPartOfClaim = false;

            for (let i = 0; i < faces.length; i++) {
                const face = faces[i];
                if (face.indices.includes(index)) {
                    if (faceOwners.get(i) === currentPlayer.id) {
                        isPartOfClaim = true;
                        break;
                    }
                }
            }

            if (isPartOfClaim) {
                console.log("Cannot remove puck that is part of claimed land!");
                return;
            }

            // Undo move
            vertexOwners.delete(index);
            gameState.pucksPlacedInTurn.delete(index);

            // Reset color (Gray)
            const defaultColor = new THREE.Color(0x888888);
            setPointColor(index, defaultColor.r, defaultColor.g, defaultColor.b);

            // Keep it visible (Scale 1) because we are hovering over it!
            setPuckScale(index, 1);

            gameState.movesInTurn--;
            updateTurnUI();
            vertexInstancedMesh.instanceColor.needsUpdate = true;
            return;
        }

        // 2. Opponent Puck: Takeover?
        if (ownerId !== currentPlayer.id) {
            // Check if vulnerable
            // A puck is vulnerable if it is NOT connected to any land owned by its owner.
            // Land = Face.
            // So, check all faces adjacent to this vertex.
            // If NONE are owned by ownerId, it is vulnerable.

            const connectivity = goldbergMesh.geometry.userData.connectivity;
            // We need vertexToFaces. Let's build it on demand or cache it.
            // Since we don't have it cached, let's search. (Optimization: Cache this in createGeometry)
            // Searching faces is O(N_faces * 6). N_faces ~ 100-1000. Fast enough for click.

            let isProtected = false;
            const faces = connectivity.faces;
            for (let i = 0; i < faces.length; i++) {
                const face = faces[i];
                if (face.indices.includes(index)) {
                    if (faceOwners.get(i) === ownerId) {
                        isProtected = true;
                        break;
                    }
                }
            }

            if (!isProtected) {
                // Takeover! (Unmark)
                vertexOwners.delete(index);

                // Reset color (Gray)
                const defaultColor = new THREE.Color(0x888888);
                setPointColor(index, defaultColor.r, defaultColor.g, defaultColor.b);

                // Keep visible (Scale 1)
                setPuckScale(index, 1);

                // Cost: 1 Move
                gameState.movesInTurn++;

                // Visual feedback? Maybe a sound or flash?
                console.log(`Player ${currentPlayer.name} removed Player ${gameState.players[ownerId].name}'s puck!`);

                vertexInstancedMesh.instanceColor.needsUpdate = true;

                // Check turn switch
                if (gameState.movesInTurn >= gameState.maxMovesPerTurn) {
                    switchTurn();
                } else {
                    updateTurnUI();
                }
                return;
            } else {
                console.log("Puck is protected by land!");
                return;
            }
        }

        return;
    }

    // Place puck
    vertexOwners.set(index, currentPlayer.id);
    gameState.pucksPlacedInTurn.add(index); // Track for undo
    currentPlayer.lastPuckIndex = index; // Track for camera

    // Set color to Player Color
    setPointColor(index, currentPlayer.color.r, currentPlayer.color.g, currentPlayer.color.b);

    // Ensure it is visible
    setPuckScale(index, 1);

    // Update Turn State
    gameState.movesInTurn++;

    vertexInstancedMesh.instanceColor.needsUpdate = true;

    // Check for captures IMMEDIATELY (before turn switch)
    gameState.animationDelay = 0; // Reset delay
    checkHexagons();

    if (gameState.movesInTurn >= gameState.maxMovesPerTurn) {
        if (gameState.animationDelay > 0) {
            setTimeout(switchTurn, gameState.animationDelay);
        } else {
            switchTurn();
        }
    } else {
        updateTurnUI();
    }
}

function switchTurn() {
    // Lock Input
    gameState.isInputLocked = true;

    // Reset moves
    gameState.movesInTurn = 0;
    gameState.pucksPlacedInTurn.clear();

    // Next player
    gameState.currentPlayerIndex = (gameState.currentPlayerIndex + 1) % gameState.players.length;
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];

    console.log(`Turn switched to ${currentPlayer.name}`);

    // Show Banner
    showTurnBanner(`${currentPlayer.name}'s Turn`, currentPlayer.color);

    // Unlock Input after banner (1.2 seconds)
    setTimeout(() => {
        if (gameState) gameState.isInputLocked = false;
    }, 1200);

    updateTurnUI();
    rotateCameraToPlayer(currentPlayer);
}

// ... (omitted code) ...



// Camera Rotation Logic
let cameraTargetPosition = null;
let isAnimatingCamera = false;

function rotateCameraToPlayer(player) {
    const connectivity = goldbergMesh.geometry.userData.connectivity;
    if (!connectivity) return;

    const vertices = connectivity.vertices;
    const faces = connectivity.faces;

    // const player = gameState.players[playerId]; // No longer needed
    let target = null;

    // 1. Priority: Last Placed Puck
    if (player.lastPuckIndex !== null && vertexOwners.get(player.lastPuckIndex) === player.id) {
        target = vertices[player.lastPuckIndex].clone();
    }
    // 2. Fallback: Center of Captured Territory
    else {
        // Collect all captured face centers for this player
        const capturedCenters = [];
        faceOwners.forEach((owner, faceIdx) => {
            if (owner === player.id) {
                const face = faces[faceIdx];
                let center = new THREE.Vector3();
                face.indices.forEach(vIdx => {
                    center.add(vertices[vIdx]);
                });
                center.divideScalar(face.indices.length);
                capturedCenters.push(center);
            }
        });

        if (capturedCenters.length > 0) {
            // Average center
            target = new THREE.Vector3();
            capturedCenters.forEach(c => target.add(c));
            target.divideScalar(capturedCenters.length);
        } else {
            // 3. Fallback: Center of all owned pucks
            const myPucks = [];
            vertexOwners.forEach((owner, vIdx) => {
                if (owner === player.id) {
                    myPucks.push(vertices[vIdx]);
                }
            });

            if (myPucks.length > 0) {
                target = new THREE.Vector3();
                myPucks.forEach(p => target.add(p));
                target.divideScalar(myPucks.length);
            }
        }
    }

    if (target) {
        // Fix: Transform local target to World Space because the gameGroup rotates
        target.applyMatrix4(gameGroup.matrixWorld);

        // Normalize to surface distance (camera orbit radius)
        target.normalize().multiplyScalar(camera.position.length());

        isAnimatingCamera = true;
        cameraTargetPosition = target;
    }
}

function setPointColor(index, r, g, b) {
    const color = new THREE.Color(r, g, b);
    vertexInstancedMesh.setColorAt(index, color);
}

function checkHexagons() {
    // This function is now a wrapper for the Flood Fill Capture Logic
    const connectivity = goldbergMesh.geometry.userData.connectivity;
    if (!connectivity) return;

    const currentPlayerId = gameState.players[gameState.currentPlayerIndex].id;

    // We need to check for capture by the CURRENT player
    // But placing a stone might also complete a capture for the OTHER player (if we fill a gap)
    // However, standard rules usually imply the active player captures.
    // Let's run it for the current player.

    captureTerritory(currentPlayerId);
}

function captureTerritory(playerId) {
    const connectivity = goldbergMesh.geometry.userData.connectivity;
    const faces = connectivity.faces;
    const edgeToFaces = connectivity.edgeToFaces;
    const meshColors = goldbergMesh.geometry.attributes.color;
    const playerColor = gameState.players[playerId].color;

    // 1. Build Adjacency Graph for this specific player's walls
    // Two faces are connected if they share an edge that is NOT a "Wall"
    // A "Wall" is an edge where BOTH vertices are owned by playerId

    const visited = new Set();
    const components = [];

    for (let i = 0; i < faces.length; i++) {
        if (visited.has(i)) continue;

        // Start BFS for a new component
        const component = [];
        const queue = [i];
        visited.add(i);

        while (queue.length > 0) {
            const currentFaceIdx = queue.shift();
            component.push(currentFaceIdx);

            const currentFace = faces[currentFaceIdx];

            // Check neighbors via edges
            // face.indices are vertices. We need edges.
            // We can reconstruct edges from indices: 0-1, 1-2, etc.
            const indices = currentFace.indices;
            for (let j = 0; j < indices.length; j++) {
                const v1 = indices[j];
                const v2 = indices[(j + 1) % indices.length];

                // Check if this edge is a Wall
                const owner1 = vertexOwners.get(v1);
                const owner2 = vertexOwners.get(v2);
                const isWall = (owner1 === playerId && owner2 === playerId);

                if (!isWall) {
                    // Not a wall, so we can cross to the neighbor face
                    const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
                    const neighbors = edgeToFaces[key];

                    if (neighbors) {
                        for (const neighborIdx of neighbors) {
                            if (neighborIdx !== currentFaceIdx && !visited.has(neighborIdx)) {
                                visited.add(neighborIdx);
                                queue.push(neighborIdx);
                            }
                        }
                    }
                }
            }
        }
        components.push(component);
    }

    // 2. Identify Captured Components
    // A component is captured if it is "small" (e.g., < 50% of total faces)
    // This assumes the "outside" is the largest component.

    const totalFaces = faces.length;

    components.forEach(component => {
        // If component is small enough, it's enclosed
        if (component.length < totalFaces / 2) {
            // Capture all faces in this component
            component.forEach(faceIdx => {
                const currentOwner = faceOwners.get(faceIdx);

                if (currentOwner !== playerId) {
                    // It's a capture (either new or stealing)

                    // If it was owned by someone else, decrement their score
                    if (currentOwner !== undefined) {
                        gameState.scores[currentOwner]--;
                    }

                    // Increment current player's score
                    gameState.scores[playerId]++;

                    // Update ownership
                    faceOwners.set(faceIdx, playerId);

                    // Update color
                    const face = faces[faceIdx];
                    const range = face.bufferRange;
                    for (let k = 0; k < range.count; k++) {
                        meshColors.setXYZ(range.start + k, playerColor.r, playerColor.g, playerColor.b);
                    }

                    // ALSO capture the vertices (pucks) inside/on this face
                    face.indices.forEach(vIdx => {
                        const vOwner = vertexOwners.get(vIdx);
                        if (vOwner !== playerId) {
                            vertexOwners.set(vIdx, playerId);
                            setPointColor(vIdx, playerColor.r, playerColor.g, playerColor.b);
                            setPuckScale(vIdx, 1); // Ensure visible
                        }
                    });

                    // Check Mystery Box (AFTER capturing vertices, so Bomb can remove them if triggered)
                    if (face.type === 'pentagon' && mysteryBoxData.has(faceIdx)) {
                        const instanceId = mysteryBoxData.get(faceIdx);
                        if (instanceId !== false) { // If not already collected
                            // Collect Box
                            openMysteryBox(playerId, faceIdx, instanceId);
                            mysteryBoxData.set(faceIdx, false); // Mark as collected/gone
                        }
                    }
                }
            });

            // Check Win Condition (Threshold)
            const winThreshold = Math.floor(totalFaces / gameState.players.length) + 1;
            if (gameState.scores[playerId] >= winThreshold) {
                gameOver(playerId);
                return;
            }
        }
    });

    // Check Win Condition (All Pucks Claimed)
    const totalVertices = goldbergMesh.geometry.userData.connectivity.vertices.length;
    if (vertexOwners.size === totalVertices) {
        // Game Over - Check Scores
        let maxScore = -1;
        let winners = [];

        gameState.scores.forEach((score, idx) => {
            if (score > maxScore) {
                maxScore = score;
                winners = [idx];
            } else if (score === maxScore) {
                winners.push(idx);
            }
        });

        if (winners.length === 1) {
            gameOver(winners[0]);
        } else {
            gameOver(-1, winners); // Tie
        }
    }

    meshColors.needsUpdate = true;
    vertexInstancedMesh.instanceColor.needsUpdate = true;
    updateTurnUI();
}

function gameOver(winnerId, tiePlayers = []) {
    // Create Game Over Screen
    let screen = document.getElementById('game-over-screen');
    if (!screen) {
        screen = document.createElement('div');
        screen.id = 'game-over-screen';
        screen.style.position = 'absolute';
        screen.style.top = '0';
        screen.style.left = '0';
        screen.style.width = '100%';
        screen.style.height = '100%';
        screen.style.background = 'rgba(0,0,0,0.9)';
        screen.style.display = 'flex';
        screen.style.flexDirection = 'column';
        screen.style.alignItems = 'center';
        screen.style.justifyContent = 'center';
        screen.style.zIndex = '3000';
        screen.style.fontFamily = "'Press Start 2P', cursive";
        screen.style.color = 'white';
        document.body.appendChild(screen);
    }

    let content = '';

    if (winnerId !== -1) {
        const winner = gameState.players[winnerId];
        content = `
            <h1 style="color: #${winner.color.getHexString()}; text-shadow: 4px 4px 0px black; font-size: 48px; text-align: center;">
                ${winner.name} WINS!
            </h1>
            <div style="margin-top: 20px; font-size: 24px;">
                Score: ${gameState.scores[winnerId]}
            </div>
        `;
    } else {
        // Tie
        const names = tiePlayers.map(id => gameState.players[id].name).join(' & ');
        content = `
            <h1 style="color: #ffffff; text-shadow: 4px 4px 0px black; font-size: 48px; text-align: center;">
                IT'S A TIE!
            </h1>
            <div style="margin-top: 20px; font-size: 24px; color: #cccccc;">
                ${names}
            </div>
            <div style="margin-top: 10px; font-size: 24px;">
                Score: ${gameState.scores[tiePlayers[0]]}
            </div>
        `;
    }

    screen.innerHTML = `
        ${content}
        <button id="restart-btn" style="
            margin-top: 50px;
            padding: 20px 40px;
            font-size: 24px;
            font-family: 'Press Start 2P', cursive;
            background: #ff0000;
            color: white;
            border: 4px solid white;
            cursor: pointer;
            box-shadow: 6px 6px 0px black;
        ">PLAY AGAIN</button>
    `;

    document.getElementById('restart-btn').addEventListener('click', () => {
        location.reload();
    });
}

function openMysteryBox(playerId, faceIdx, instanceId) {
    // Hide the box
    const dummy = new THREE.Object3D();
    dummy.scale.set(0, 0, 0);
    mysteryBoxMesh.setMatrixAt(instanceId, dummy.matrix);
    mysteryBoxMesh.instanceMatrix.needsUpdate = true;

    // Get Position for UI/FX
    const connectivity = goldbergMesh.geometry.userData.connectivity;
    const face = connectivity.faces[faceIdx];
    let centroid = new THREE.Vector3();
    face.indices.forEach(vIdx => {
        centroid.add(connectivity.vertices[vIdx]);
    });
    centroid.divideScalar(face.indices.length);

    // Random Reward
    const rand = Math.random();
    let message = "";
    let color = "#FFD700"; // Gold
    let isBomb = false;

    if (rand < 0.25) {
        gameState.movesInTurn -= 1;
        message = "+1 MOVE!";
    } else if (rand < 0.50) {
        gameState.movesInTurn -= 2;
        message = "+2 MOVES!";
    } else if (rand < 0.75) {
        gameState.movesInTurn -= 3;
        message = "+3 MOVES!";
    } else {
        // BOMB!
        isBomb = true;
        color = "#FF0000"; // Red
        message = "BOMB!";

        // Set Delay for Turn Switch
        gameState.animationDelay = 5000; // 5 seconds

        // 1. Remove Pucks (Visuals: Fly away) & Identify Affected Faces
        const affectedFaces = new Set();
        // Always include the bomb's own face
        affectedFaces.add(faceIdx);

        face.indices.forEach(vIdx => {
            if (vertexOwners.has(vIdx)) {
                vertexOwners.delete(vIdx);
                // Reset logical owner immediately

                // Find all faces connected to this vertex
                // Since we don't have a direct vertex->face map, we iterate (perf is fine here)
                connectivity.faces.forEach((f, fIdx) => {
                    if (f.indices.includes(vIdx)) {
                        affectedFaces.add(fIdx);
                    }
                });

                // Create Flying Debris
                createFlyingPuck(vIdx, connectivity.vertices[vIdx]);

                // Hide original puck
                setPuckScale(vIdx, 0);

                // Fix: Reset color to neutral (Gray) so it doesn't show old owner's color on hover
                setPointColor(vIdx, 0.533, 0.533, 0.533); // 0x888888 approx
            }
        });
        vertexInstancedMesh.instanceColor.needsUpdate = true;

        // 2. Reset Land (Unclaim Affected Faces)
        const meshColors = goldbergMesh.geometry.attributes.color;

        affectedFaces.forEach(fIdx => {
            if (faceOwners.has(fIdx)) {
                const ownerId = faceOwners.get(fIdx);
                faceOwners.delete(fIdx);

                // Decrement Score
                if (gameState.scores[ownerId] > 0) {
                    gameState.scores[ownerId]--;
                }

                // Reset Color
                const f = connectivity.faces[fIdx];
                const range = f.bufferRange;
                let baseColor;

                if (f.type === 'pentagon') {
                    baseColor = new THREE.Color(0xc2b280); // Sand
                } else {
                    baseColor = new THREE.Color(0x006994); // Ocean Blue
                }

                for (let k = 0; k < range.count; k++) {
                    meshColors.setXYZ(range.start + k, baseColor.r, baseColor.g, baseColor.b);
                }
            }
        });
        meshColors.needsUpdate = true;

        // 3. Explosion FX (Mushroom Cloud)
        createMushroomCloud(centroid);
    }

    // Floating Text (Projected to Screen)
    showFloatingText(message, color, centroid);

    updateTurnUI();
}

function createFlyingPuck(vIdx, position) {
    const geometry = new THREE.CylinderGeometry(0.15, 0.15, 0.1, 16);
    const material = new THREE.MeshStandardMaterial({
        color: 0x333333,
        emissive: 0x110000
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);

    // Orient to normal (approx)
    mesh.lookAt(new THREE.Vector3(0, 0, 0));

    gameGroup.add(mesh);

    // Animate
    const startTime = Date.now();
    const duration = 1500; // 1.5 seconds
    const direction = position.clone().normalize();
    const randomOffset = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.5);
    direction.add(randomOffset).normalize();

    function animatePuck() {
        const elapsed = Date.now() - startTime;
        const progress = elapsed / duration;

        if (progress >= 1) {
            scene.remove(mesh);
            geometry.dispose();
            material.dispose();
            return;
        }

        // Move outwards - 10x Slower
        mesh.position.add(direction.clone().multiplyScalar(0.02));
        // Rotate randomly
        mesh.rotation.x += 0.1;
        mesh.rotation.z += 0.1;
        // Fade
        material.opacity = 1 - progress;
        material.transparent = true;

        requestAnimationFrame(animatePuck);
    }
    animatePuck();
}

function createMushroomCloud(position) {
    // Stem
    const stemGeo = new THREE.CylinderGeometry(0.2, 0.1, 1, 8);
    const stemMat = new THREE.MeshBasicMaterial({ color: 0xff4400, transparent: true, opacity: 0.8 });
    const stem = new THREE.Mesh(stemGeo, stemMat);

    // Cap
    const capGeo = new THREE.SphereGeometry(0.6, 16, 16);
    const capMat = new THREE.MeshBasicMaterial({ color: 0xff2200, transparent: true, opacity: 0.8 });
    const cap = new THREE.Mesh(capGeo, capMat);

    // Group
    const cloud = new THREE.Group();
    cloud.add(stem);
    cloud.add(cap);

    // Orient
    const normal = position.clone().normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);
    cloud.quaternion.copy(quaternion);
    cloud.position.copy(position);

    // Initial positions relative to group
    stem.position.set(0, 0.5, 0);
    cap.position.set(0, 1.0, 0);

    gameGroup.add(cloud);

    // Animate
    const startTime = Date.now();
    const duration = 1500; // 1.5 seconds

    function animateCloud() {
        const elapsed = Date.now() - startTime;
        const progress = elapsed / duration;

        if (progress >= 1) {
            scene.remove(cloud);
            stemGeo.dispose();
            stemMat.dispose();
            capGeo.dispose();
            capMat.dispose();
            return;
        }

        // Expand and Rise
        // Max 300% scale (1 + 2)
        const scale = 1 + progress * 2;
        cloud.scale.set(scale, scale, scale);

        // Rise (move along normal) - Strictly 10x Slower (Original was 0.005)
        cloud.position.add(normal.clone().multiplyScalar(0.0005));

        // Change Color to Smoke
        if (progress > 0.5) {
            stemMat.color.setHex(0x555555);
            capMat.color.setHex(0x333333);
        }

        // Fade
        stemMat.opacity = 1 - progress;
        capMat.opacity = 1 - progress;

        requestAnimationFrame(animateCloud);
    }
    animateCloud();
}

function showFloatingText(text, color, position) {
    const div = document.createElement('div');
    div.innerText = text;
    div.style.position = 'absolute';
    div.style.color = color;
    div.style.fontFamily = "'Press Start 2P', cursive";
    div.style.fontSize = '24px';
    div.style.textShadow = '2px 2px 0px black';
    div.style.pointerEvents = 'none';
    div.style.whiteSpace = 'nowrap';
    div.style.zIndex = '2000';
    document.body.appendChild(div);

    // Update position loop
    const startTime = Date.now();
    const duration = 2000;

    function updatePos() {
        const elapsed = Date.now() - startTime;
        if (elapsed >= duration) {
            div.remove();
            return;
        }

        // Project 3D to 2D
        const vector = position.clone();
        vector.project(camera);

        const x = (vector.x * .5 + .5) * window.innerWidth;
        const y = (-(vector.y * .5) + .5) * window.innerHeight;

        // Float up
        const floatOffset = (elapsed / duration) * 50;

        div.style.left = `${x}px`;
        div.style.top = `${y - floatOffset}px`;
        div.style.transform = 'translate(-50%, -50%)';
        div.style.opacity = 1 - (elapsed / duration);

        requestAnimationFrame(updatePos);
    }
    updatePos();
}

function setPuckScale(index, scale) {
    const connectivity = goldbergMesh.geometry.userData.connectivity;
    if (!connectivity) return;
    const v = connectivity.vertices[index];

    const dummy = new THREE.Object3D();
    const normal = v.clone().normalize();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);

    dummy.position.copy(v);
    dummy.quaternion.copy(quaternion);
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();

    vertexInstancedMesh.setMatrixAt(index, dummy.matrix);
    vertexInstancedMesh.instanceMatrix.needsUpdate = true;
}

let hoveredVertex = null;

function updateHover() {
    if (!goldbergMesh) return;

    raycaster.setFromCamera(mouse, camera);

    // Raycast against the LAND (sphere), not the pucks
    const intersects = raycaster.intersectObject(goldbergMesh);

    if (intersects.length > 0) {
        // Fix: Convert world point to local point because the mesh (gameGroup) is rotating!
        // The vertices are stored in local space.
        const point = intersects[0].point.clone();
        goldbergMesh.worldToLocal(point);

        // Find closest vertex
        const connectivity = goldbergMesh.geometry.userData.connectivity;
        const vertices = connectivity.vertices;

        let minDist = Infinity;
        let closestIdx = -1;

        // Simple iteration is fast enough for < 1000 points
        for (let i = 0; i < vertices.length; i++) {
            const d = point.distanceToSquared(vertices[i]);
            if (d < minDist) {
                minDist = d;
                closestIdx = i;
            }
        }

        if (closestIdx !== -1 && minDist < 1.0) {
            if (hoveredVertex !== closestIdx) {
                // Un-hover previous
                if (hoveredVertex !== null && !vertexOwners.has(hoveredVertex)) {
                    setPuckScale(hoveredVertex, 0); // Hide
                }

                hoveredVertex = closestIdx;

                // Hover new
                if (!vertexOwners.has(hoveredVertex)) {
                    setPuckScale(hoveredVertex, 1); // Show
                }
            }
        } else {
            // Too far
            if (hoveredVertex !== null) {
                if (!vertexOwners.has(hoveredVertex)) {
                    setPuckScale(hoveredVertex, 0);
                }
                hoveredVertex = null;
            }
        }
    } else {
        // No intersection
        if (hoveredVertex !== null) {
            if (!vertexOwners.has(hoveredVertex)) {
                setPuckScale(hoveredVertex, 0);
            }
            hoveredVertex = null;
        }
    }
}

function showTurnBanner(text, color) {
    let banner = document.getElementById('turn-banner');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'turn-banner';
        banner.style.position = 'absolute';
        banner.style.top = '15%'; // Move to top
        banner.style.left = '50%';
        banner.style.transform = 'translate(-50%, -50%)';
        banner.style.fontSize = '40px'; // Slightly smaller for pixel font
        banner.style.fontWeight = 'bold';
        banner.style.fontFamily = "'Press Start 2P', cursive"; // Retro Font
        banner.style.color = 'white';
        banner.style.textShadow = '4px 4px 0px black'; // Hard shadow
        banner.style.pointerEvents = 'none';
        banner.style.opacity = '0';
        banner.style.transition = 'opacity 0.5s';
        banner.style.zIndex = '1000';
        banner.style.textAlign = 'center';
        document.body.appendChild(banner);
    }

    banner.innerText = text;
    banner.style.color = `#${color.getHexString()}`;
    banner.style.opacity = '1';

    // Hide after 1.2 seconds
    setTimeout(() => {
        banner.style.opacity = '0';
    }, 1200);
}

function updateTurnUI() {
    let ui = document.getElementById('game-ui');
    if (!ui) {
        ui = document.createElement('div');
        ui.id = 'game-ui';
        document.body.appendChild(ui);
    }

    if (!gameState || !gameState.players) return;

    const currentPlayer = gameState.players[gameState.currentPlayerIndex];

    // Calculate Win Threshold
    let winThreshold = 0;
    if (typeof goldbergMesh !== 'undefined' && goldbergMesh && goldbergMesh.geometry) {
        const connectivity = goldbergMesh.geometry.userData.connectivity;
        const totalFaces = connectivity ? connectivity.faces.length : 0;
        winThreshold = Math.floor(totalFaces / gameState.players.length) + 1;
    }

    let scoresHtml = '';
    gameState.players.forEach((p, idx) => {
        scoresHtml += `<div style="color:#${p.color.getHexString()}">${p.name}: ${gameState.scores[idx]}</div>`;
    });

    ui.innerHTML = `
        <div>Turn: <span style="color:#${currentPlayer.color.getHexString()}">${currentPlayer.name}</span></div>
        <div>Moves: ${gameState.movesInTurn} / ${gameState.maxMovesPerTurn}</div>
        <div style="margin-top: 10px; color: #ffcc00;">To Win: ${winThreshold} Tiles</div>
        <br>
        <div>Scores:</div>
        ${scoresHtml}
    `;
}

function createControlsUI() {
    let controls = document.getElementById('controls-ui');
    if (!controls) {
        controls = document.createElement('div');
        controls.id = 'controls-ui';
        document.body.appendChild(controls);
    }

    // Mute Button
    const muteBtn = document.createElement('button');
    muteBtn.innerText = 'MUTE';

    muteBtn.addEventListener('click', () => {
        const isMuted = audioController.toggleMute();
        muteBtn.innerText = isMuted ? 'UNMUTE' : 'MUTE';
        muteBtn.style.color = isMuted ? '#ff5555' : 'white';
    });

    controls.appendChild(muteBtn);
}

// Setup Screen Logic
const setupScreen = document.getElementById('setup-screen');
const colorContainer = document.getElementById('color-container');
const startBtn = document.getElementById('start-btn');

const defaultColors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00'];
let numPlayers = 2;

function updateColorPickers() {
    colorContainer.innerHTML = '';

    // Render Players
    for (let i = 0; i < numPlayers; i++) {
        const wrapper = document.createElement('div');
        wrapper.className = 'color-picker-wrapper';

        const label = document.createElement('span');
        label.innerText = `P${i + 1}`;
        label.style.fontSize = '12px';

        const input = document.createElement('input');
        input.type = 'color';
        input.value = defaultColors[i] || '#ffffff';
        input.id = `color-p${i}`;

        wrapper.appendChild(label);
        wrapper.appendChild(input);
        colorContainer.appendChild(wrapper);
    }

    // Add [+] Button
    if (numPlayers < 4) {
        const addBtn = document.createElement('button');
        addBtn.className = 'icon-btn';
        addBtn.innerText = '+';
        addBtn.title = "Add Player";
        addBtn.onclick = () => {
            numPlayers++;
            updateColorPickers();
        };
        colorContainer.appendChild(addBtn);
    }

    // Add [-] Button (if > 2)
    if (numPlayers > 2) {
        const removeBtn = document.createElement('button');
        removeBtn.className = 'icon-btn';
        removeBtn.innerText = '-';
        removeBtn.title = "Remove Player";
        removeBtn.onclick = () => {
            numPlayers--;
            updateColorPickers();
        };
        colorContainer.appendChild(removeBtn);
    }
}

updateColorPickers(); // Init

startBtn.addEventListener('click', startGame);

function startGame() {
    const mapSize = document.getElementById('map-size').value;
    const movesPerTurn = parseInt(document.getElementById('moves-per-turn').value);
    const musicUrl = document.getElementById('music-select').value;

    const playerCount = numPlayers; // Use numPlayers directly
    const players = [];
    for (let i = 0; i < playerCount; i++) {
        const colorHex = document.getElementById(`color-p${i}`).value;
        players.push({
            id: i,
            name: `Player ${i + 1}`,
            color: new THREE.Color(colorHex),
            lastPuckIndex: null
        });
    }

    // Update Params
    params.mapSize = mapSize;
    params.playerCount = playerCount;

    // Hide Screen
    setupScreen.style.display = 'none';

    // Start Game
    initGame(players, movesPerTurn, musicUrl);
}

function initGame(players, movesPerTurn, musicUrl) {
    // Initialize Game State
    gameState = {
        players: players,
        currentPlayerIndex: 0,
        movesInTurn: 0,
        maxMovesPerTurn: parseInt(document.getElementById('moves-per-turn').value) || 5,
        scores: new Array(players.length).fill(0), // Changed playerCount to players.length for consistency
        pucksPlacedInTurn: new Set(),
        animationDelay: 0,
        isInputLocked: false // New: Lock input during turn switch
    };
    isAutoRotating = true;
    if (interactionTimeout) clearTimeout(interactionTimeout);

    createGeometry();

    // Start Music
    if (musicUrl) {
        audioController.load(musicUrl).then(() => {
            audioController.init().then(() => {
                audioController.play();
            });
        });
    } else {
        audioController.stop();
    }

    createControlsUI();

    // Startup Banner Sequence
    showTurnBanner("The Game of Land", new THREE.Color(0xffffff));

    // Validate Graph Connectivity
    const connectivity = goldbergMesh.geometry.userData.connectivity;
    const faces = connectivity.faces;
    const edgeToFaces = connectivity.edgeToFaces;
    let disconnectedFaces = 0;

    for (let i = 0; i < faces.length; i++) {
        const face = faces[i];
        const indices = face.indices;
        let neighborCount = 0;

        for (let j = 0; j < indices.length; j++) {
            const v1 = indices[j];
            const v2 = indices[(j + 1) % indices.length];
            const key = v1 < v2 ? `${v1}_${v2}` : `${v2}_${v1}`;
            if (edgeToFaces[key] && edgeToFaces[key].length > 0) {
                neighborCount++;
            }
        }

        const expected = face.type === 'pentagon' ? 5 : 6;
        if (neighborCount < expected) {
            console.warn(`Face ${i} (${face.type}) has only ${neighborCount} neighbors! Expected ${expected}.`);
            disconnectedFaces++;
        }
    }

    if (disconnectedFaces > 0) {
        console.error(`Found ${disconnectedFaces} faces with missing neighbors! Graph is disconnected.`);
    } else {
        console.log("Graph connectivity verified: All faces have correct neighbor counts.");
    }

    setTimeout(() => {
        const firstPlayer = gameState.players[gameState.currentPlayerIndex];
        showTurnBanner(`${firstPlayer.name}'s Turn`, firstPlayer.color);
    }, 2500);
}

// Resize Handler
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Auto-Rotation State
let isAutoRotating = true;
let interactionTimeout;

function onInteractionStart() {
    isAutoRotating = false;
    // Fix: Cancel any active camera animation so user can take control
    isAnimatingCamera = false;
    cameraTargetPosition = null;

    if (interactionTimeout) clearTimeout(interactionTimeout);
}

function onInteractionEnd() {
    // Resume auto-rotation after 5 seconds of inactivity
    interactionTimeout = setTimeout(() => {
        isAutoRotating = true;
    }, 5000);
}

window.addEventListener('mousedown', onInteractionStart);
window.addEventListener('mouseup', onInteractionEnd);
window.addEventListener('touchstart', onInteractionStart);
window.addEventListener('touchend', onInteractionEnd);

// Starfield
let starfield;
function createStarfield() {
    const starCount = 2000;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(starCount * 3);
    const sizes = new Float32Array(starCount);
    const shifts = new Float32Array(starCount); // Random time offset for twinkling

    for (let i = 0; i < starCount; i++) {
        // Random position in a large sphere
        const r = 400 + Math.random() * 400; // Distance 400-800
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);

        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
        positions[i * 3 + 2] = r * Math.cos(phi);

        sizes[i] = Math.random() * 2.0 + 0.5; // Size 0.5 - 2.5
        shifts[i] = Math.random() * 100;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('shift', new THREE.BufferAttribute(shifts, 1));

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTime: { value: 0 },
            uColor: { value: new THREE.Color(0xffffff) }
        },
        vertexShader: `
            attribute float size;
            attribute float shift;
            varying float vShift;
            void main() {
                vShift = shift;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = size * (300.0 / -mvPosition.z);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            uniform float uTime;
            uniform vec3 uColor;
            varying float vShift;
            void main() {
                // Circular particle
                vec2 coord = gl_PointCoord - vec2(0.5);
                if(length(coord) > 0.5) discard;

                // Twinkle
                float brightness = 0.5 + 0.5 * sin(uTime * 2.0 + vShift);
                gl_FragColor = vec4(uColor, brightness);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
    });

    starfield = new THREE.Points(geometry, material);
    scene.add(starfield);
}

createStarfield();

// Game Group (for rotation)
const gameGroup = new THREE.Group();
scene.add(gameGroup);

// ... (existing code) ...

// Animation Loop
function animate() {
    requestAnimationFrame(animate);

    // Update Starfield
    if (starfield && starfield.material.uniforms) {
        starfield.material.uniforms.uTime.value = performance.now() / 1000;
    }

    if (isAnimatingCamera && cameraTargetPosition) {
        // Spherical interpolation: Lerp then Normalize
        const currentDist = camera.position.length();
        camera.position.lerp(cameraTargetPosition, 0.05);
        camera.position.normalize().multiplyScalar(currentDist);

        camera.lookAt(0, 0, 0);

        if (camera.position.distanceTo(cameraTargetPosition) < 0.1) {
            isAnimatingCamera = false;
            cameraTargetPosition = null;
        }
        controls.update();
    } else {
        controls.update();

        // Auto-Rotation
        if (isAutoRotating) {
            // Rotate the GAME GROUP, not the camera
            // This ensures the background (stars) stays static relative to the camera's orbit
            // but the sphere spins.
            gameGroup.rotation.y += 0.001;
        }
    }

    renderer.render(scene, camera);
}

animate();
