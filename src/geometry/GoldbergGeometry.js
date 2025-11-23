import * as THREE from 'three';

export class GoldbergGeometry extends THREE.BufferGeometry {
    constructor(radius = 1, detail = 0) {
        super();
        this.type = 'GoldbergGeometry';

        this.parameters = {
            radius: radius,
            detail: detail
        };

        const generated = this.generate(radius, detail);
        this.copy(generated);
        this.userData = generated.userData;
    }

    generate(radius, detail) {
        // 1. Create the base Geodesic Sphere (Icosahedron with subdivision)
        const geodesicGeo = new THREE.IcosahedronGeometry(radius, detail);

        let connectivityData = null;

        // Merge vertices to ensure connectivity info is correct
        // (IcosahedronGeometry usually comes with indexed geometry, but let's be safe)
        const mergedGeo = this.mergeVertices(geodesicGeo);
        const posAttribute = mergedGeo.attributes.position;
        const indexAttribute = mergedGeo.index;

        // 2. Build adjacency data: For each vertex, which faces share it?
        const vertexFaces = []; // index -> [faceIndex1, faceIndex2, ...]
        for (let i = 0; i < posAttribute.count; i++) {
            vertexFaces[i] = [];
        }

        const faceCentroids = [];
        const faceCount = indexAttribute.count / 3;

        for (let f = 0; f < faceCount; f++) {
            const a = indexAttribute.getX(f * 3 + 0);
            const b = indexAttribute.getX(f * 3 + 1);
            const c = indexAttribute.getX(f * 3 + 2);

            vertexFaces[a].push(f);
            vertexFaces[b].push(f);
            vertexFaces[c].push(f);

            // Compute centroid of this face
            const vA = new THREE.Vector3().fromBufferAttribute(posAttribute, a);
            const vB = new THREE.Vector3().fromBufferAttribute(posAttribute, b);
            const vC = new THREE.Vector3().fromBufferAttribute(posAttribute, c);

            const centroid = new THREE.Vector3().addVectors(vA, vB).add(vC).divideScalar(3);
            // Project centroid to sphere surface to make it smoother? 
            // For a true dual of a polyhedron, we keep it flat, but for a "planet" we might want to project.
            // Let's keep it simple first (flat faces).
            faceCentroids.push(centroid);
        }

        // 3. Construct the Dual Geometry
        // Each vertex in the original mesh becomes a FACE in the new mesh.
        // The vertices of the new face are the centroids of the adjacent original faces.

        const newVertices = [];
        const newIndices = [];
        const newColors = [];
        const newNormals = []; // We'll compute flat normals per face

        // Colors
        const colorHexagon = new THREE.Color(0x006994); // Ocean Blue
        const colorPentagon = new THREE.Color(0xc2b280); // Sand // White

        let vertexOffset = 0;

        for (let v = 0; v < posAttribute.count; v++) {
            const adjacentFaceIndices = vertexFaces[v];

            if (adjacentFaceIndices.length < 3) continue; // Should not happen on a closed sphere

            // We need to sort the adjacent faces so they form a proper loop (polygon)
            // We can do this by looking at the shared edges between faces, or by sorting angularly around the vertex normal.
            const vertexPos = new THREE.Vector3().fromBufferAttribute(posAttribute, v);

            // Sort adjacent faces by angle around the vertex
            adjacentFaceIndices.sort((fa, fb) => {
                const ca = faceCentroids[fa];
                const cb = faceCentroids[fb];

                // Project centroids onto the plane tangent to the vertex
                // Or simpler: compute angle relative to an arbitrary reference vector perpendicular to vertex normal
                // Let's use a robust way:
                // 1. Create a basis on the tangent plane.
                // Normal = vertexPos.normalized()
                const normal = vertexPos.clone().normalize();

                // Vector from vertex to centroid
                const da = new THREE.Vector3().subVectors(ca, vertexPos).normalize();
                const db = new THREE.Vector3().subVectors(cb, vertexPos).normalize();

                // We need a reference vector. Let's pick the first centroid's direction as reference for others?
                // No, sorting requires a consistent comparison.
                // Standard way:
                // Calculate angles in the tangent plane.
                // Basis vectors:
                let tangent = new THREE.Vector3();
                if (Math.abs(normal.y) < 0.9) {
                    tangent.set(0, 1, 0).cross(normal).normalize();
                } else {
                    tangent.set(1, 0, 0).cross(normal).normalize();
                }
                const bitangent = new THREE.Vector3().crossVectors(normal, tangent);

                const getAngle = (centroid) => {
                    const d = new THREE.Vector3().subVectors(centroid, vertexPos);
                    const x = d.dot(tangent);
                    const y = d.dot(bitangent);
                    return Math.atan2(y, x);
                };

                return getAngle(ca) - getAngle(cb);
            });


            // Now build the face
            // Since Three.js uses triangles, we need to fan-triangulate this polygon.
            // Centroid of the new face (which is roughly the original vertex position)
            // Actually, for a flat-shaded look, we just add vertices for each            
            const isPentagon = adjacentFaceIndices.length === 5;
            const color = isPentagon ? colorPentagon : colorHexagon;

            const faceVerts = adjacentFaceIndices.map(idx => faceCentroids[idx]);

            // Store connectivity data
            // We need to know which "Game Vertices" (faceCentroids indices) belong to this "Game Face" (v)
            // adjacentFaceIndices contains exactly that: indices into faceCentroids
            if (!connectivityData) {
                connectivityData = {
                    vertices: faceCentroids, // The "Game Vertices"
                    faces: [], // The "Game Faces" (Hexagons/Pentagons)
                    edges: new Set(), // To track uniqueness
                    edgeList: [], // Array of [idx1, idx2]
                    edgeToFaces: {} // key -> [faceIdx1, faceIdx2]
                };
            }

            // We need to store the range of indices in the buffer geometry for this face
            // Each face has (faceVerts.length - 2) triangles
            // Each triangle has 3 vertices
            const numTriangles = faceVerts.length - 2;
            const numBufferVerts = numTriangles * 3;

            connectivityData.faces[v] = {
                type: isPentagon ? 'pentagon' : 'hexagon',
                indices: adjacentFaceIndices, // Indices into connectivityData.vertices
                bufferRange: { start: newVertices.length / 3, count: numBufferVerts }
            };

            // Collect edges for the grid
            // adjacentFaceIndices forms a loop: 0-1, 1-2, ..., n-0
            for (let i = 0; i < adjacentFaceIndices.length; i++) {
                const idx1 = adjacentFaceIndices[i];
                const idx2 = adjacentFaceIndices[(i + 1) % adjacentFaceIndices.length];

                // Create a unique key for the edge (smaller index first)
                const key = idx1 < idx2 ? `${idx1}_${idx2}` : `${idx2}_${idx1}`;

                if (!connectivityData.edges.has(key)) {
                    connectivityData.edges.add(key);
                    connectivityData.edgeList.push([idx1, idx2]);
                }

                // Track face adjacency via edges
                if (!connectivityData.edgeToFaces[key]) {
                    connectivityData.edgeToFaces[key] = [];
                }
                connectivityData.edgeToFaces[key].push(v); // 'v' is the current face index
            }

            // Compute face normal
            const faceNormal = vertexPos.clone().normalize(); // Approximate normal is just the original vertex normal

            for (let i = 1; i < faceVerts.length - 1; i++) {
                const v0 = faceVerts[0];
                const v1 = faceVerts[i];
                const v2 = faceVerts[i + 1];

                newVertices.push(v0.x, v0.y, v0.z);
                newVertices.push(v1.x, v1.y, v1.z);
                newVertices.push(v2.x, v2.y, v2.z);

                newNormals.push(faceNormal.x, faceNormal.y, faceNormal.z);
                newNormals.push(faceNormal.x, faceNormal.y, faceNormal.z);
                newNormals.push(faceNormal.x, faceNormal.y, faceNormal.z);

                newColors.push(color.r, color.g, color.b);
                newColors.push(color.r, color.g, color.b);
                newColors.push(color.r, color.g, color.b);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(newVertices, 3));
        geometry.setAttribute('normal', new THREE.Float32BufferAttribute(newNormals, 3));
        geometry.setAttribute('color', new THREE.Float32BufferAttribute(newColors, 3));

        geometry.userData.connectivity = connectivityData;

        return geometry;
    }

    mergeVertices(geometry, tolerance = 1e-4) {
        // Simple vertex merger
        const posAttribute = geometry.attributes.position;
        const vertexCount = posAttribute.count;
        const points = [];
        const indexMap = new Map(); // oldIndex -> newIndex
        const uniquePoints = [];

        // Helper to create a key for the map
        const precisionPoints = 4; // 4 decimal places
        const precision = Math.pow(10, precisionPoints);
        const getKey = (x, y, z) => {
            return `${Math.round(x * precision)}_${Math.round(y * precision)}_${Math.round(z * precision)}`;
        };

        let uniqueCount = 0;

        for (let i = 0; i < vertexCount; i++) {
            const x = posAttribute.getX(i);
            const y = posAttribute.getY(i);
            const z = posAttribute.getZ(i);

            const key = getKey(x, y, z);

            if (indexMap.has(key)) {
                // Already have this vertex
            } else {
                indexMap.set(key, uniqueCount);
                uniquePoints.push(x, y, z);
                uniqueCount++;
            }
        }

        // Now rebuild the index buffer
        const oldIndex = geometry.index;
        const newIndices = [];

        // Map old vertex indices to new unique indices
        // We need a way to look up the new index for a given old index.
        // Since we iterated sequentially, we can just look up the position of the old index again.

        // Optimization: Precompute the mapping from old index to new index
        const oldToNewIndex = new Int32Array(vertexCount);
        for (let i = 0; i < vertexCount; i++) {
            const x = posAttribute.getX(i);
            const y = posAttribute.getY(i);
            const z = posAttribute.getZ(i);
            const key = getKey(x, y, z);
            oldToNewIndex[i] = indexMap.get(key);
        }

        if (oldIndex) {
            for (let i = 0; i < oldIndex.count; i++) {
                const oldIdx = oldIndex.getX(i);
                newIndices.push(oldToNewIndex[oldIdx]);
            }
        } else {
            // Non-indexed geometry
            for (let i = 0; i < vertexCount; i++) {
                newIndices.push(oldToNewIndex[i]);
            }
        }

        const newGeo = new THREE.BufferGeometry();
        newGeo.setAttribute('position', new THREE.Float32BufferAttribute(uniquePoints, 3));
        newGeo.setIndex(newIndices);

        return newGeo;
    }
}
