'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Map from 'react-map-gl/maplibre';
import { Canvas, coordsToVector3 } from 'react-three-map/maplibre';
import { useGLTF, useCursor } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

const INITIAL_VIEW_STATE = {
  longitude: -122.4194,
  latitude: 37.7749,
  zoom: 15,
  pitch: 60,
  bearing: -17.6,
};

const MAPTILER_KEY = process.env.NEXT_PUBLIC_MAPTILER_KEY;
const MAP_STYLE =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ||
  (MAPTILER_KEY
    ? `https://api.maptiler.com/maps/satellite/style.json?key=${MAPTILER_KEY}`
    : undefined);

function SelectableModel({ url, selected, onSelect, onInteractionStart, onInteractionEnd, initialPosition }) {
  const gltf = useGLTF(url);
  const groupRef = useRef();
  const modelRef = useRef();

  // Get Three.js context for raycasting
  const { camera, gl } = useThree();

  const [position, setPosition] = useState(initialPosition || [0, 0, 0]);
  const [rotationY, setRotationY] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [boundingBox, setBoundingBox] = useState(null);

  const draggingRef = useRef(false);
  const dragOffsetRef = useRef(new THREE.Vector3());
  const rotatingRef = useRef(false);
  const rotateStartAngleRef = useRef(0);
  const rotateInitialRef = useRef(0);

  // Ground plane for raycasting during drag (y = 0)
  const groundPlane = useMemo(
    () => new THREE.Plane(new THREE.Vector3(0, 1, 0), 0),
    []
  );
  const scene = useMemo(() => {
    if (!gltf?.scene) return null;
    return gltf.scene.clone();
  }, [gltf]);

  // Compute bounding box when scene loads
  useEffect(() => {
    if (scene) {
      const box = new THREE.Box3().setFromObject(scene);
      setBoundingBox(box);
    }
  }, [scene]);

  const startInteraction = () => {
    if (onInteractionStart) onInteractionStart();
  };

  const endInteraction = () => {
    if (onInteractionEnd) onInteractionEnd();
  };

  useCursor(hovered || draggingRef.current, 'grabbing', hovered ? 'pointer' : 'auto');

  const handleClick = (event) => {
    event.stopPropagation();
    if (onSelect) onSelect();
  };

  const handlePointerDown = (event) => {
    event.stopPropagation();
    if (onSelect) onSelect();

    draggingRef.current = true;
    startInteraction();
    const pointer = event.point.clone();
    const current = new THREE.Vector3(...position);
    dragOffsetRef.current.copy(current).sub(pointer.setY(current.y));

    // Capture pointer for reliable drag
    if (event.target?.setPointerCapture) {
      event.target.setPointerCapture(event.pointerId);
    }
  };

  const handlePointerMove = (event) => {
    if (!draggingRef.current) return;
    event.stopPropagation();

    const intersectionPoint = new THREE.Vector3();
    const hit = event.ray.intersectPlane(groundPlane, intersectionPoint);

    if (hit) {
      const newPos = intersectionPoint.add(dragOffsetRef.current);
      setPosition([newPos.x, 0, newPos.z]);
    }
  };

  const handlePointerUp = (event) => {
    if (!draggingRef.current) return;

    // Release pointer capture
    if (event?.target?.releasePointerCapture && event.pointerId !== undefined) {
      try {
        event.target.releasePointerCapture(event.pointerId);
      } catch (e) {
        // Ignore if pointer was already released
      }
    }

    draggingRef.current = false;
    endInteraction();
  };

  const handleRingPointerDown = (event) => {
    event.stopPropagation();
    if (onSelect) onSelect();

    rotatingRef.current = true;
    startInteraction();

    const center = new THREE.Vector3(...position);
    const p = event.point.clone();
    const dx = p.x - center.x;
    const dz = p.z - center.z;
    rotateStartAngleRef.current = Math.atan2(dx, dz);
    rotateInitialRef.current = rotationY;

    // Capture pointer for reliable rotation
    if (event.target?.setPointerCapture) {
      event.target.setPointerCapture(event.pointerId);
    }
  };

  const handleRingPointerMove = (event) => {
    if (!rotatingRef.current) return;
    event.stopPropagation();

    const center = new THREE.Vector3(...position);
    const p = event.point.clone();
    const dx = p.x - center.x;
    const dz = p.z - center.z;
    const angle = Math.atan2(dx, dz);
    const delta = angle - rotateStartAngleRef.current;

    setRotationY(rotateInitialRef.current + delta);
  };

  const handleRingPointerUp = (event) => {
    if (!rotatingRef.current) return;

    // Release pointer capture
    if (event?.target?.releasePointerCapture && event.pointerId !== undefined) {
      try {
        event.target.releasePointerCapture(event.pointerId);
      } catch (e) {
        // Ignore if pointer was already released
      }
    }

    rotatingRef.current = false;
    endInteraction();
  };

  if (!scene) return null;

  // Calculate wireframe box dimensions from bounding box
  const boxSize = boundingBox ? new THREE.Vector3() : null;
  const boxCenter = boundingBox ? new THREE.Vector3() : null;
  if (boundingBox) {
    boundingBox.getSize(boxSize);
    boundingBox.getCenter(boxCenter);
  }

  // Calculate ring radius based on bounding box (2x wider)
  const ringInnerRadius = boundingBox
    ? Math.max(boxSize.x, boxSize.z) * 1.4
    : 3.0;
  const ringOuterRadius = ringInnerRadius * 1.3;

  return (
    <group
      ref={groupRef}
      position={position}
      rotation={[0, rotationY, 0]}
    >
      {/* The actual model - clickable */}
      <primitive
        ref={modelRef}
        object={scene}
        onClick={handleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
        onPointerOut={(e) => { e.stopPropagation(); setHovered(false); }}
      />

      {/* Selection wireframe box */}
      {selected && boundingBox && boxSize && boxCenter && (
        <lineSegments position={[boxCenter.x, boxCenter.y, boxCenter.z]}>
          <edgesGeometry args={[new THREE.BoxGeometry(boxSize.x * 1.05, boxSize.y * 1.05, boxSize.z * 1.05)]} />
          <lineBasicMaterial color="#00ff00" linewidth={2} />
        </lineSegments>
      )}

      {/* Selection ring for rotation */}
      {selected && (
        <mesh
          position={[0, 0.1, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          onPointerDown={handleRingPointerDown}
          onPointerMove={handleRingPointerMove}
          onPointerUp={handleRingPointerUp}
        >
          <ringGeometry args={[ringInnerRadius, ringOuterRadius, 64]} />
          <meshBasicMaterial color="#00ff00" transparent opacity={0.8} side={THREE.DoubleSide} depthTest={false} />
        </mesh>
      )}
    </group>
  );
}

export default function HomePage() {
  const [mapRef, setMapRef] = useState(null);
  const [modelUrl, setModelUrl] = useState(null);
  const [modelInitialPosition, setModelInitialPosition] = useState([0, 0, 0]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isInteractingWithModel, setIsInteractingWithModel] = useState(false);
  const [isModelSelected, setIsModelSelected] = useState(false);
  const [overlayImageUrl, setOverlayImageUrl] = useState(null);
  const [isGeneratingOverlay, setIsGeneratingOverlay] = useState(false);
  const [nanoBananaRemaining, setNanoBananaRemaining] = useState(null);
  const [nanoBananaLimit, setNanoBananaLimit] = useState(null);

  const handleMapLoad = (event) => {
    const map = event.target;
    setMapRef(map);
    // You can add MapLibre sources/layers here if needed.
  };

  useEffect(() => {
    return () => {
      if (modelUrl) {
        URL.revokeObjectURL(modelUrl);
      }
    };
  }, [modelUrl]);

  // Fetch initial Nano Banana limit/remaining for this browser
  useEffect(() => {
    let cancelled = false;

    const fetchLimits = async () => {
      try {
        const res = await fetch('/api/nano-banana');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        if (typeof data.limit === 'number') {
          setNanoBananaLimit(data.limit);
        }
        if (typeof data.remaining === 'number') {
          setNanoBananaRemaining(data.remaining);
        }
      } catch {
        // ignore errors here; button will still work, just without counts
      }
    };

    fetchLimits();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleDragOver = (event) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    if (!isDragOver) {
      setIsDragOver(true);
    }
  };

  const handleDragLeave = (event) => {
    event.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (event) => {
    event.preventDefault();
    setIsDragOver(false);

    const files = event.dataTransfer.files;
    if (!files || files.length === 0) return;

    const file = files[0];
    const name = file.name.toLowerCase();

    if (!name.endsWith('.glb')) {
      // Ignore non-GLB files for now.
      return;
    }

    // Calculate drop position based on where the file was dropped
    // Convert the drop screen coordinate -> map lng/lat -> local meters
    let dropPosition = [0, 0, 0];
    if (mapRef) {
      let map = null;
      if (typeof mapRef.getCanvas === 'function') {
        map = mapRef;
      } else if (typeof mapRef.getMap === 'function') {
        const inner = mapRef.getMap();
        if (inner && typeof inner.getCanvas === 'function') {
          map = inner;
        }
      }

      if (map && typeof map.getCanvas === 'function' && typeof map.unproject === 'function') {
        const canvas = map.getCanvas();
        const rect = canvas.getBoundingClientRect();
        const clientX = event.clientX ?? (event.nativeEvent?.clientX ?? 0);
        const clientY = event.clientY ?? (event.nativeEvent?.clientY ?? 0);
        const xPixel = clientX - rect.left;
        const yPixel = clientY - rect.top;

        const lngLat = map.unproject([xPixel, yPixel]);

        const [x, , z] = coordsToVector3(
          { latitude: lngLat.lat, longitude: lngLat.lng, altitude: 0 },
          {
            latitude: INITIAL_VIEW_STATE.latitude,
            longitude: INITIAL_VIEW_STATE.longitude,
            altitude: 0,
          }
        );

        dropPosition = [x, 0, z];
        console.log('[handleDrop] Dropping model at pointer:', {
          lngLat,
          dropPosition,
        });
      }
    }
    setModelInitialPosition(dropPosition);

    const url = URL.createObjectURL(file);
    setModelUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return url;
    });
  };

  // Capture exactly what MapLibre + react-three-map render
  const captureCompositeImage = () => {
    if (!mapRef) return null;

    // Normalise to the underlying MapLibre map instance
    let map = null;
    if (typeof mapRef.getCanvas === 'function') {
      map = mapRef;
    } else if (typeof mapRef.getMap === 'function') {
      const inner = mapRef.getMap();
      if (inner && typeof inner.getCanvas === 'function') {
        map = inner;
      }
    }

    if (!map) {
      console.warn('captureCompositeImage: map instance not found');
      return null;
    }

    const canvas = map.getCanvas();
    if (!canvas) {
      console.warn('captureCompositeImage: map canvas not found');
      return null;
    }

    try {
      const dataUrl = canvas.toDataURL('image/png');
      console.log('[captureCompositeImage] Captured map canvas', {
        width: canvas.width,
        height: canvas.height,
      });
      return dataUrl;
    } catch (err) {
      console.error('[captureCompositeImage] Failed to read canvas', err);
      return null;
    }
  };

  const handleNanoBananaClick = async () => {
    if (isGeneratingOverlay) return;

    const imageData = captureCompositeImage();
    if (!imageData) {
      console.warn('Nano Banana: failed to capture composite image');
      return;
    }

    try {
      setIsGeneratingOverlay(true);

      const response = await fetch('/api/nano-banana', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ imageData }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Nano Banana API error', errorText);
        try {
          const parsed = JSON.parse(errorText);
          if (typeof parsed.remaining === 'number') {
            setNanoBananaRemaining(parsed.remaining);
          }
          if (typeof parsed.limit === 'number') {
            setNanoBananaLimit(parsed.limit);
          }
        } catch {
          // ignore JSON parse errors
        }
        return;
      }

      const data = await response.json();

      if (typeof data.remaining === 'number') {
        setNanoBananaRemaining(data.remaining);
      }
      if (typeof data.limit === 'number') {
        setNanoBananaLimit(data.limit);
      }

      if (data.imageUrl) {
        setOverlayImageUrl(data.imageUrl);
      }
    } catch (error) {
      console.error('Failed to call Nano Banana API', error);
    } finally {
      setIsGeneratingOverlay(false);
    }
  };

  const handleMapMove = () => {
    if (overlayImageUrl) {
      setOverlayImageUrl(null);
    }
  };

  return (
    <main
      className="main-container"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {MAP_STYLE && (
        <Map
          initialViewState={INITIAL_VIEW_STATE}
          mapStyle={MAP_STYLE}
          style={{ width: '100%', height: '100%' }}
          canvasContextAttributes={{ preserveDrawingBuffer: true }}
          dragPan={!isInteractingWithModel}
          dragRotate={!isInteractingWithModel}
          scrollZoom={!isInteractingWithModel}
          onLoad={handleMapLoad}
          onMove={handleMapMove}
        >
          <Canvas
            latitude={INITIAL_VIEW_STATE.latitude}
            longitude={INITIAL_VIEW_STATE.longitude}
            altitude={0}
            onPointerMissed={() => setIsModelSelected(false)}
            gl={{ preserveDrawingBuffer: true }}
          >
            <ambientLight intensity={0.6} />
            <hemisphereLight args={['#ffffff', '#60666C']} position={[1, 4.5, 3]} />
            {modelUrl && (
              <Suspense fallback={null}>
                <SelectableModel
                  url={modelUrl}
                  key={modelUrl}
                  initialPosition={modelInitialPosition}
                  selected={isModelSelected}
                  onSelect={() => setIsModelSelected(true)}
                  onInteractionStart={() => setIsInteractingWithModel(true)}
                  onInteractionEnd={() => setIsInteractingWithModel(false)}
                />
              </Suspense>
            )}
          </Canvas>
        </Map>
      )}
      {!MAP_STYLE && (
        <div style={{ padding: 16, position: 'absolute', top: 0, left: 0 }}>
          Set <code>NEXT_PUBLIC_MAPTILER_KEY</code> or <code>NEXT_PUBLIC_MAP_STYLE_URL</code> in{' '}
          <code>.env.local</code> to load a high-resolution satellite basemap.
        </div>
      )}
      <div
        style={{
          position: 'absolute',
          top: 16,
          left: 16,
          padding: '8px 12px',
          background: 'rgba(0,0,0,0.6)',
          color: '#fff',
          borderRadius: 4,
          fontSize: 12,
          pointerEvents: 'none',
          zIndex: 10,
        }}
      >
        {modelUrl
          ? 'Drop another .glb file to replace the model.'
          : 'Drop a .glb file anywhere on the map to load it.'}
      </div>
      {isDragOver && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            border: '2px dashed #fff',
            borderRadius: 8,
            pointerEvents: 'none',
          }}
        />
      )}
      {/* Nano Banana overlay image */}
      {overlayImageUrl && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 5,
            pointerEvents: 'none',
          }}
        >
          <img
            src={overlayImageUrl}
            alt="AI render"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              display: 'block',
            }}
          />
        </div>
      )}

      {/* Nano Banana trigger button and status */}
      {MAP_STYLE && (
        <div
          style={{
            position: 'absolute',
            bottom: 20,
            right: 20,
            zIndex: 11,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 6,
          }}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            {/* Debug: Download screenshot button */}
            <button
              type="button"
              onClick={() => {
                const imageData = captureCompositeImage();
                if (!imageData) {
                  alert('Failed to capture screenshot');
                  return;
                }
                const link = document.createElement('a');
                link.download = `screenshot-${Date.now()}.png`;
                link.href = imageData;
                link.click();
              }}
              disabled={!mapRef}
              style={{
                padding: '8px 14px',
                borderRadius: 6,
                border: '1px solid rgba(255,255,255,0.4)',
                background: 'rgba(100,100,100,0.9)',
                color: '#e0f2fe',
                fontSize: 13,
                fontWeight: 600,
                cursor: !mapRef ? 'default' : 'pointer',
                pointerEvents: 'auto',
                backdropFilter: 'blur(4px)',
              }}
            >
              📷 Download Screenshot
            </button>
            <button
              type="button"
              onClick={handleNanoBananaClick}
              disabled={!mapRef || isGeneratingOverlay}
              style={{
                padding: '8px 14px',
                borderRadius: 6,
                border: '1px solid rgba(255,255,255,0.4)',
                background: isGeneratingOverlay
                  ? 'rgba(15,118,110,0.9)'
                  : 'rgba(8,47,73,0.9)',
                color: '#e0f2fe',
                fontSize: 13,
                fontWeight: 600,
                cursor: !mapRef || isGeneratingOverlay ? 'default' : 'pointer',
                pointerEvents: 'auto',
                backdropFilter: 'blur(4px)',
              }}
            >
              {isGeneratingOverlay ? 'Rendering…' : 'Render current view with AI'}
            </button>
          </div>
          {nanoBananaLimit != null && (
            <div
              style={{
                padding: '4px 8px',
                borderRadius: 4,
                background: 'rgba(0,0,0,0.5)',
                color: '#e5e7eb',
                fontSize: 11,
              }}
            >
              {nanoBananaRemaining != null
                ? `${nanoBananaRemaining}/${nanoBananaLimit} AI renders left`
                : `Up to ${nanoBananaLimit} AI renders per browser`}
            </div>
          )}
        </div>
      )}
    </main>
  );
}
