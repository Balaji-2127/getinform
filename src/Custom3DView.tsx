import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Text, Sky } from "@react-three/drei";
import "./Custom3DView.css";

// A procedural stand-in for what a real modeled flagship community would
// look like — hand-built glTF towers from CAD/architectural plans, not
// this box geometry. It exists to show the *shape* of that option, not to
// be mistaken for real modeling.

type TowerDef = {
  name: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  floors: number;
  color: string;
};

const FLOOR_HEIGHT = 0.9;

const TOWERS: TowerDef[] = [
  { name: "Tower A", x: -6, z: 3, width: 3, depth: 3, floors: 20, color: "#6366f1" },
  { name: "Tower B", x: 0, z: 4.5, width: 3, depth: 3, floors: 18, color: "#4f46e5" },
  { name: "Tower C", x: 6, z: 3, width: 2.8, depth: 2.8, floors: 15, color: "#4338ca" },
  { name: "Tower D", x: -6, z: -3.5, width: 2.6, depth: 2.6, floors: 12, color: "#3730a3" },
  { name: "Tower E", x: 6, z: -3.5, width: 2.6, depth: 2.6, floors: 12, color: "#312e81" },
];

const CLUBHOUSE = { x: 0, z: -5, width: 4.5, depth: 2.5, floors: 3, color: "#d97706" };

function Tower({ def }: { def: TowerDef }) {
  const height = def.floors * FLOOR_HEIGHT;
  return (
    <group position={[def.x, 0, def.z]}>
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[def.width, height, def.depth]} />
        <meshStandardMaterial color={def.color} roughness={0.6} metalness={0.05} />
      </mesh>
      <Text
        position={[0, height + 0.6, 0]}
        fontSize={0.5}
        color="#1f2937"
        anchorX="center"
        anchorY="bottom"
      >
        {`${def.name} · G+${def.floors - 1}`}
      </Text>
    </group>
  );
}

function Clubhouse() {
  const height = CLUBHOUSE.floors * FLOOR_HEIGHT;
  return (
    <group position={[CLUBHOUSE.x, 0, CLUBHOUSE.z]}>
      <mesh position={[0, height / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[CLUBHOUSE.width, height, CLUBHOUSE.depth]} />
        <meshStandardMaterial color={CLUBHOUSE.color} roughness={0.6} />
      </mesh>
      <Text position={[0, height + 0.6, 0]} fontSize={0.5} color="#1f2937" anchorX="center" anchorY="bottom">
        Clubhouse
      </Text>
    </group>
  );
}

function CompoundGround() {
  return (
    <>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[24, 20]} />
        <meshStandardMaterial color="#e7e5e4" />
      </mesh>
      {/* internal road ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[6.5, 7.2, 4, 1, Math.PI / 4]} />
        <meshStandardMaterial color="#9ca3af" />
      </mesh>
    </>
  );
}

export default function Custom3DView() {
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      <Canvas shadows camera={{ position: [16, 14, 20], fov: 45 }}>
        <Suspense fallback={null}>
          <Sky sunPosition={[50, 30, 20]} />
          <ambientLight intensity={0.55} />
          <directionalLight
            position={[20, 25, 10]}
            intensity={1.1}
            castShadow
            shadow-mapSize-width={2048}
            shadow-mapSize-height={2048}
          />
          <CompoundGround />
          {TOWERS.map((t) => (
            <Tower key={t.name} def={t} />
          ))}
          <Clubhouse />
          <OrbitControls
            target={[0, 4, 0]}
            minDistance={8}
            maxDistance={45}
            maxPolarAngle={Math.PI / 2.1}
          />
        </Suspense>
      </Canvas>

      <div className="custom3d-caption">
        Procedural preview — a fictional flagship community. Real use of this option means
        replacing these boxes with actual glTF models from CAD/architectural plans, geo-anchored
        at the real site. Drag to orbit, scroll to zoom.
      </div>
    </div>
  );
}
