import { useEffect, useRef } from "react";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import * as THREE from "three";
import earthColorUrl from "./assets/earth_color.jpg";
import earthSpecularUrl from "./assets/earth_specular.jpg";
import earthCloudsUrl from "./assets/earth_clouds.png";
import "./GlobeIntro.css";

const EARTH_RADIUS = 1;
const ZOOM_DURATION_SECONDS = 2.4;
// Crossfade to the real map starts before the zoom animation is
// mathematically "done" — by then the (low-res, whole-planet) Earth
// texture is far too close to read as anything but a blur, so hiding that
// under a fade is what sells the illusion rather than the raw zoom math.
const FADE_START_T = 0.62;

// Matches three.js's own SphereGeometry vertex formula exactly (verified
// against node_modules/three/src/geometries/SphereGeometry.js) so a given
// lat/lng lands on the same point the equirectangular texture actually
// shows for that coordinate, not just approximately close.
function latLngToVector3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const v = (90 - lat) / 180;
  const u = (lng + 180) / 360;
  const theta = v * Math.PI;
  const phi = u * Math.PI * 2;
  const ringRadius = radius * Math.sin(theta);
  const x = -ringRadius * Math.cos(phi);
  const z = ringRadius * Math.sin(phi);
  const y = radius * Math.cos(theta);
  return new THREE.Vector3(x, y, z);
}

const ATMOSPHERE_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ATMOSPHERE_FRAGMENT = /* glsl */ `
  uniform vec3 glowColor;
  varying vec3 vNormal;
  void main() {
    // Soft feathered rim rather than a hard ring: a steeper falloff power
    // and a lower ceiling on the dot-product baseline keep the glow thin
    // and concentrated right at the limb, fading to fully transparent
    // toward the center of the visible disc instead of tinting it blue.
    float rim = clamp(1.0 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 0.0, 1.0);
    float intensity = pow(rim, 3.0);
    gl_FragColor = vec4(glowColor, intensity * 0.22);
  }
`;

function Earth({ idle }: { idle: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const cloudsRef = useRef<THREE.Mesh>(null);
  const [colorMap, specularMap, cloudsMap] = useLoader(THREE.TextureLoader, [
    earthColorUrl,
    earthSpecularUrl,
    earthCloudsUrl,
  ]);

  useFrame((_, delta) => {
    if (idle && groupRef.current) {
      groupRef.current.rotation.y += delta * 0.045;
    }
    if (cloudsRef.current) {
      cloudsRef.current.rotation.y += delta * 0.01;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh>
        <sphereGeometry args={[EARTH_RADIUS, 64, 64]} />
        <meshPhongMaterial map={colorMap} specularMap={specularMap} specular={new THREE.Color("#333333")} shininess={7} />
      </mesh>
      <mesh ref={cloudsRef}>
        <sphereGeometry args={[EARTH_RADIUS * 1.008, 64, 64]} />
        <meshLambertMaterial map={cloudsMap} transparent opacity={0.5} depthWrite={false} />
      </mesh>
      <mesh scale={1.03}>
        <sphereGeometry args={[EARTH_RADIUS, 48, 48]} />
        <shaderMaterial
          transparent
          side={THREE.BackSide}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
          uniforms={{ glowColor: { value: new THREE.Color("#5aa9ff") } }}
          vertexShader={ATMOSPHERE_VERTEX}
          fragmentShader={ATMOSPHERE_FRAGMENT}
        />
      </mesh>
    </group>
  );
}

// Owns the camera fly-in. Idle: slow orbit-ish drift showing the whole
// planet. Once `zoomTarget` is set: eases the camera from wherever it was
// toward just above that lat/lng's surface point, calling `onFadeStart`
// partway through (see FADE_START_T) and `onComplete` at the end so the
// parent can crossfade to the real map underneath.
function CameraRig({
  zoomTarget,
  onFadeStart,
  onComplete,
}: {
  zoomTarget: [number, number] | null;
  onFadeStart: () => void;
  onComplete: () => void;
}) {
  const { camera } = useThree();
  const startPos = useRef(new THREE.Vector3());
  const startTime = useRef(0);
  const fadeStarted = useRef(false);
  const completed = useRef(false);
  // Which target the in-flight animation belongs to — used to detect a
  // *new* target from inside useFrame itself (see below), rather than via
  // a separate `useEffect`. R3F's render loop and React's effect
  // scheduling aren't ordered against each other, so an effect keyed on
  // `zoomTarget` can run AFTER the first `useFrame` tick that already sees
  // the new target — that tick would then read the still-zero initial
  // `startTime.current`, compute an enormous elapsed time against
  // `performance.now()`, and jump the whole animation straight to
  // "complete" in one frame. Doing the reset synchronously inside
  // `useFrame`, keyed on this ref, closes that race entirely.
  const activeTarget = useRef<[number, number] | null>(null);

  useEffect(() => {
    camera.position.set(0, 0.15, 3.1);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  useFrame(() => {
    if (!zoomTarget) {
      activeTarget.current = null;
      // Gentle idle drift so the "opening" frame doesn't feel static.
      camera.position.set(
        Math.sin(Date.now() * 0.00008) * 0.25,
        0.15 + Math.cos(Date.now() * 0.00006) * 0.08,
        camera.position.z,
      );
      camera.lookAt(0, 0, 0);
      return;
    }
    if (activeTarget.current !== zoomTarget) {
      activeTarget.current = zoomTarget;
      startPos.current.copy(camera.position);
      startTime.current = performance.now();
      fadeStarted.current = false;
      completed.current = false;
    }
    if (completed.current) return;

    const elapsedSeconds = (performance.now() - startTime.current) / 1000;
    const t = Math.min(1, elapsedSeconds / ZOOM_DURATION_SECONDS);
    const eased = 1 - Math.pow(1 - t, 3);

    const [lng, lat] = zoomTarget;
    const surfacePoint = latLngToVector3(lat, lng, EARTH_RADIUS);
    const targetCameraPos = surfacePoint.clone().multiplyScalar(1.35 - eased * 0.33);

    camera.position.lerpVectors(startPos.current, targetCameraPos, eased);
    camera.lookAt(surfacePoint);

    if (t >= FADE_START_T && !fadeStarted.current) {
      fadeStarted.current = true;
      onFadeStart();
    }
    if (t >= 1 && !completed.current) {
      completed.current = true;
      onComplete();
    }
  });

  return null;
}

export default function GlobeIntro({
  zoomTarget,
  fading,
  onFadeStart,
  onComplete,
}: {
  zoomTarget: [number, number] | null;
  fading: boolean;
  onFadeStart: () => void;
  onComplete: () => void;
}) {
  return (
    <div className={"globe-intro-wrapper" + (fading ? " is-fading" : "")}>
      <div className="globe-intro">
        <Canvas gl={{ antialias: true }} dpr={[1, 2]}>
          <color attach="background" args={["#000000"]} />
          <ambientLight intensity={0.35} />
          <directionalLight position={[5, 2, 5]} intensity={1.6} />
          <Stars radius={80} depth={40} count={4000} factor={3} saturation={0} fade speed={0.4} />
          <Earth idle={!zoomTarget} />
          <CameraRig zoomTarget={zoomTarget} onFadeStart={onFadeStart} onComplete={onComplete} />
        </Canvas>

        {!zoomTarget && (
          <div className="globe-intro-hint">
            <span className="globe-intro-sub">Select a city to begin</span>
          </div>
        )}
      </div>
    </div>
  );
}
